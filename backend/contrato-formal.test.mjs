import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createDatabase, initializeDatabase } from './database.mjs';
import { createServer } from './app.mjs';

const completo = {
  maquinaria_id: 1, cliente: 'Constructora Prueba S.A. de C.V.', ciudad: 'Santa Ana',
  fecha_inicio: '2031-03-01', fecha_fin: '2031-03-05',
  operador: 'Carlos Ernesto Pérez', operador_documento: '01234567-8',
  seguro: 'RESPONSABILIDAD_CIVIL', forma_pago: 'CREDITO_30_DIAS',
  condiciones_especiales: 'Entrega en el portón norte de la obra.',
};

test('formalización del contrato: guardar, bloquear campos faltantes y recuperar por ID', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'contrato-formal-'));
  const database = await createDatabase({ connectionString: '', dataDir: join(folder, 'pg'), production: false });
  await initializeDatabase(database);
  const server = createServer({ database, logger: {} });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await database.close();
    await rm(folder, { recursive: true, force: true });
  });
  const post = async (body) => {
    const response = await fetch(`${base}/api/contratos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { response, body: await response.json() };
  };
  const total = async () => (await database.query('SELECT COUNT(*)::integer AS n FROM contrato')).rows[0].n;

  await t.test('bloquea el guardado y señala cada campo obligatorio faltante', async () => {
    for (const campo of ['cliente', 'operador', 'seguro', 'forma_pago', 'fecha_inicio']) {
      const { [campo]: _omitido, ...incompleto } = completo;
      const result = await post(incompleto);
      assert.equal(result.response.status, 400, campo);
      assert.equal(result.body.error.code, 'VALIDATION_ERROR');
      assert.ok(result.body.error.fields[campo], `debe señalar ${campo}`);
    }
    const vacio = await post({ ...completo, operador: '   ', seguro: '' });
    assert.deepEqual(Object.keys(vacio.body.error.fields).sort(), ['operador', 'seguro']);
    assert.equal((await post({ ...completo, seguro: 'INVENTADO' })).response.status, 400);
    assert.equal((await post({ ...completo, operador_documento: '123' })).response.status, 400);
    assert.equal(await total(), 0);
  });

  let creado;
  await t.test('guarda cliente, máquina, fechas, operador y condiciones', async () => {
    const result = await post(completo);
    assert.equal(result.response.status, 201);
    creado = result.body;
    assert.equal(creado.operador, 'Carlos Ernesto Pérez');
    assert.equal(creado.operador_documento, '01234567-8');
    assert.equal(creado.seguro, 'RESPONSABILIDAD_CIVIL');
    assert.equal(creado.forma_pago, 'CREDITO_30_DIAS');
    assert.equal(creado.condiciones_especiales, completo.condiciones_especiales);
    assert.equal(creado.total, 450 * 5);
  });

  await t.test('recupera los datos íntegros del contrato mediante su ID', async () => {
    const read = await fetch(`${base}/api/contratos/${creado.id}`);
    assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), creado);
  });

  await t.test('el documento incluye las cláusulas con los datos del contrato', async () => {
    const response = await fetch(`${base}/api/contratos/${creado.id}/documento`);
    assert.equal(response.status, 200);
    const documento = await response.json();
    assert.equal(documento.numero, creado.id);
    assert.ok(documento.clausulas.length >= 10);
    const texto = documento.clausulas.map((c) => c.texto).join('\n');
    for (const dato of ['Constructora Prueba', 'Santa Ana', 'Carlos Ernesto Pérez', '01234567-8',
      '1 de marzo de 2031', 'portón norte', 'Código Civil', 'San Salvador']) {
      assert.ok(texto.includes(dato), `falta: ${dato}`);
    }
    assert.equal((await fetch(`${base}/api/contratos/no-es-uuid/documento`)).status, 400);
    assert.equal((await fetch(`${base}/api/contratos/00000000-0000-4000-8000-000000000000/documento`)).status, 404);
  });
});
