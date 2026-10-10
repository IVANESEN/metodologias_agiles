import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createDatabase, initializeDatabase } from './database.mjs';
import { createServer } from './app.mjs';
import { normalizeSignature } from '../frontend/firma-datos.mjs';

const firma = { ancho: 600, alto: 240, trazos: [[[30, 160], [80, 60], [60, 180], [150, 120]], [[160, 120], [240, 90], [300, 120]]] };
const otraFirma = { ...firma, trazos: [[[50, 50], [100, 100]]] };
const contrato = {
  maquinaria_ids: [1, 2], cliente: 'Cliente firma HU7', ciudad: 'Santa Ana',
  fecha_inicio: '2033-02-10', fecha_fin: '2033-02-12', operador: 'Operador asignado',
  seguro: 'TODO_RIESGO', forma_pago: 'TRANSFERENCIA',
};

test('HU7: firma simulada vinculada permanentemente al contrato', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'contrato-firma-'));
  const dataDir = join(folder, 'pg');
  let database, server, base;
  async function start() {
    database = await createDatabase({ connectionString: '', dataDir, production: false });
    await initializeDatabase(database);
    server = createServer({ database, logger: {} });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await database?.close();
    database = null;
  }
  t.after(async () => { await stop(); await rm(folder, { recursive: true, force: true }); });
  await start();
  async function request(path, body, options = {}) {
    const response = await fetch(base + path, body === undefined ? options : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...options,
    });
    return { status: response.status, body: await response.json(), response };
  }
  const created = await request('/api/contratos', contrato);
  assert.equal(created.status, 201);
  const id = created.body.id;
  const route = `/api/contratos/${id}/firma`;
  let saved;

  await t.test('un contrato nuevo conserva reservas y empieza sin firma', async () => {
    assert.equal(created.body.firma, null);
    assert.equal(created.body.firmado_en, null);
    assert.equal(created.body.maquinarias.length, 2);
  });
  await t.test('rechaza lienzo vacío, clic sin trazo y puntos idénticos en el servidor', async () => {
    for (const value of [undefined, null, {}, { ...firma, trazos: [] },
      { ...firma, trazos: [[[50, 50]]] }, { ...firma, trazos: [[[50, 50], [50, 50]]] }]) {
      const result = await request(route, { firma: value });
      assert.equal(result.status, 400);
      assert.equal(result.body.error.code, 'VALIDATION_ERROR');
      assert.ok(result.body.error.fields.firma);
    }
    assert.equal((await request(`/api/contratos/${id}`)).body.firma, null);
  });
  await t.test('rechaza coordenadas, dimensiones y cantidades inválidas', async () => {
    for (const value of [
      { ...firma, ancho: 0 }, { ...firma, alto: 999 }, { ...firma, trazos: 'imagen' },
      { ...firma, trazos: [[[0, 0], [601, 20]]] }, { ...firma, trazos: [[[0, 0], [20, -1]]] },
      { ...firma, trazos: [[[0, 0], ['20', 30]]] }, { ...firma, trazos: [[[0, 0], [null, 30]]] },
      { ...firma, trazos: Array(101).fill([[0, 0], [10, 10]]) },
      { ...firma, trazos: [Array(4001).fill([10, 10])] },
    ]) assert.equal((await request(route, { firma: value })).status, 400);
    assert.throws(() => normalizeSignature({ ...firma, trazos: [[[0, 0], [NaN, 5]]] }));
  });
  await t.test('rechaza JSON incorrecto, tipo de contenido y exceso de tamaño', async () => {
    assert.equal((await request(route, {}, { body: '{' })).status, 400);
    assert.equal((await request(route, {}, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await request(route, { extra: 'x'.repeat(132000) })).status, 413);
  });
  await t.test('controla ID inexistente, ID inválido y métodos no permitidos', async () => {
    assert.equal((await request(`/api/contratos/${randomUUID()}/firma`, { firma })).status, 404);
    assert.equal((await request('/api/contratos/incorrecto/firma', { firma })).status, 400);
    for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await request(route, undefined, { method })).status, 405);
  });
  await t.test('guarda los trazos y la fecha del servidor vinculados al ID', async () => {
    const result = await request(route, { firma, firmado_en: '1900-01-01' });
    assert.equal(result.status, 200);
    saved = result.body;
    assert.equal(saved.contrato_id, id);
    assert.deepEqual(saved.firma, firma);
    assert.ok(Number.isFinite(Date.parse(saved.firmado_en)));
    assert.notEqual(saved.firmado_en.slice(0, 10), '1900-01-01');
    const stored = (await request(`/api/contratos/${id}`)).body;
    assert.deepEqual(stored.firma, firma);
    assert.equal(stored.firmado_en, saved.firmado_en);
    for (const field of ['cliente', 'ciudad', 'fecha_inicio', 'fecha_fin', 'total', 'maquinarias', 'estado']) {
      assert.deepEqual(stored[field], created.body[field]);
    }
  });
  await t.test('reintentar la misma firma es idempotente y otra no puede reemplazarla', async () => {
    assert.deepEqual((await request(route, { firma })).body, saved);
    const changed = await request(route, { firma: otraFirma });
    assert.equal(changed.status, 409);
    assert.equal(changed.body.error.code, 'CONTRACT_ALREADY_SIGNED');
    assert.deepEqual((await request(`/api/contratos/${id}`)).body.firma, firma);
  });
  await t.test('dos firmas simultáneas dejan un solo ganador para otro contrato', async () => {
    const other = await request('/api/contratos', { ...contrato, fecha_inicio: '2033-02-20', fecha_fin: '2033-02-22' });
    assert.equal(other.status, 201);
    const otherRoute = `/api/contratos/${other.body.id}/firma`;
    const results = await Promise.all([request(otherRoute, { firma }), request(otherRoute, { firma: otraFirma })]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const winner = results.find(result => result.status === 200).body;
    assert.deepEqual((await request(`/api/contratos/${other.body.id}`)).body.firma, winner.firma);
    assert.deepEqual((await request(`/api/contratos/${id}`)).body.firma, firma);
  });
  await t.test('la migración puede repetirse y la firma sobrevive al reinicio', async () => {
    await initializeDatabase(database);
    await stop();
    await start();
    const stored = (await request(`/api/contratos/${id}`)).body;
    assert.deepEqual(stored.firma, firma);
    assert.equal(stored.firmado_en, saved.firmado_en);
    assert.deepEqual((await request(route, { firma })).body, saved);
  });
  await t.test('el PDF recuperado incluye la firma, cliente y fecha persistidos', async () => {
    const response = await fetch(`${base}/api/contratos/${id}/pdf`);
    assert.equal(response.status, 200);
    const task = getDocument({ data: new Uint8Array(await response.arrayBuffer()), standardFontDataUrl: resolve('node_modules/pdfjs-dist/standard_fonts') + '/' });
    const pdf = await task.promise;
    let text = '';
    for (let number = 1; number <= pdf.numPages; number++) {
      text += (await (await pdf.getPage(number)).getTextContent()).items.map(item => item.str).join(' ') + ' ';
    }
    await task.destroy();
    assert.ok(text.includes('Firma simulada del cliente'));
    assert.ok(text.includes(contrato.cliente));
    assert.ok(text.includes(new Date(saved.firmado_en).toISOString()));
    assert.ok(text.includes(id));
  });
});
