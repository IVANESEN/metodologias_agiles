import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createDatabase, initializeDatabase } from './database.mjs';
import { createServer } from './app.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5ZkAAAAASUVORK5CYII=';
const WEBP = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==';

async function start(t) {
  const database = await createDatabase({ connectionString: '', dataDir: 'memory://', production: false });
  await initializeDatabase(database);
  const server = createServer({ database, logger: {} });
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await database.close();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, body, options = {}) {
    const response = await fetch(base + path, body === undefined ? options : {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body), ...options,
    });
    return { response, body: await response.json() };
  }
  return { database, request };
}

async function createContract(request, machineryIds = [1], day = '2040-01-10') {
  const result = await request('/api/contratos', {
    maquinaria_ids: machineryIds, cliente: 'Cliente recepción HU10', ciudad: 'Santa Ana',
    fecha_inicio: day, fecha_fin: day, operador: 'Operador HU10',
    seguro: 'TODO_RIESGO', forma_pago: 'TRANSFERENCIA',
  });
  assert.equal(result.response.status, 201);
  return result.body;
}

test('HU10 API: registra, persiste, consulta y reintenta una recepción sin duplicarla', async t => {
  const { database, request } = await start(t);
  const contract = await createContract(request);
  const input = { id: randomUUID(), contrato_id: contract.id, maquinaria_id: 1, horometro: 1875, fotos: [PNG, WEBP] };

  const created = await request('/api/recepciones', input);
  assert.equal(created.response.status, 201);
  assert.equal(created.response.headers.get('location'), `/api/contratos/${contract.id}/recepciones`);
  assert.deepEqual({ ...created.body, fecha_recepcion: 'fecha' }, {
    ...input, maquinaria_nombre: 'CAT 336', fecha_recepcion: 'fecha',
  });
  assert.ok(Number.isFinite(new Date(created.body.fecha_recepcion).getTime()));

  const stored = await database.query(
    'SELECT contrato_id, maquinaria_id, horometro, fotos FROM recepcion_maquinaria WHERE id=$1', [input.id],
  );
  assert.deepEqual(stored.rows[0], {
    contrato_id: contract.id, maquinaria_id: 1, horometro: 1875, fotos: [PNG, WEBP],
  });

  const retried = await request('/api/recepciones', input);
  assert.equal(retried.response.status, 200);
  assert.deepEqual(retried.body, created.body);
  assert.equal((await database.query('SELECT COUNT(*)::integer AS count FROM recepcion_maquinaria')).rows[0].count, 1);

  const list = await request(`/api/contratos/${contract.id}/recepciones`);
  assert.equal(list.response.status, 200);
  assert.deepEqual(list.body, { recepciones: [created.body] });

  const duplicate = await request('/api/recepciones', { ...input, id: randomUUID() });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.error.code, 'RECEPTION_ALREADY_EXISTS');
});

test('HU10 API: valida campos, imágenes reales y límites antes de escribir', async t => {
  const { database, request } = await start(t);
  const contract = await createContract(request);
  const base = { id: randomUUID(), contrato_id: contract.id, maquinaria_id: 1, horometro: 0, fotos: [PNG] };
  const large = Buffer.alloc(1_000_001);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(large);
  Buffer.from('IHDR').copy(large, 12);
  const invalid = [
    null, [], {},
    { ...base, id: 'invalido' },
    { ...base, contrato_id: 'invalido' },
    { ...base, maquinaria_id: 0 },
    { ...base, maquinaria_id: '1' },
    { ...base, horometro: -1 },
    { ...base, horometro: 1.5 },
    { ...base, fotos: [] },
    { ...base, fotos: Array(6).fill(PNG) },
    { ...base, fotos: ['data:image/png;base64,QUJDRA=='] },
    { ...base, fotos: ['data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA=='] },
    { ...base, fotos: [`data:image/png;base64,${large.toString('base64')}`] },
  ];
  for (const body of invalid) {
    const result = await request('/api/recepciones', body);
    assert.equal(result.response.status, 400, JSON.stringify(body)?.slice(0, 100));
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    assert.equal(typeof result.body.error.message, 'string');
  }
  assert.equal((await database.query('SELECT COUNT(*)::integer AS count FROM recepcion_maquinaria')).rows[0].count, 0);
});

test('HU10 API: rechaza contrato inexistente, maquinaria ajena y conflictos de identificador', async t => {
  const { database, request } = await start(t);
  const contract = await createContract(request, [1]);
  const input = { id: randomUUID(), contrato_id: contract.id, maquinaria_id: 1, horometro: 90, fotos: [PNG] };

  const outside = await request('/api/recepciones', { ...input, maquinaria_id: 2 });
  assert.equal(outside.response.status, 409);
  assert.equal(outside.body.error.code, 'MACHINERY_NOT_IN_CONTRACT');

  const missing = await request('/api/recepciones', { ...input, contrato_id: randomUUID() });
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.error.code, 'CONTRACT_NOT_FOUND');

  assert.equal((await request('/api/recepciones', input)).response.status, 201);
  const reused = await request('/api/recepciones', { ...input, horometro: 91 });
  assert.equal(reused.response.status, 409);
  assert.equal(reused.body.error.code, 'RECEPTION_ID_CONFLICT');
  assert.equal((await database.query('SELECT COUNT(*)::integer AS count FROM recepcion_maquinaria')).rows[0].count, 1);
});

test('HU10 API: consulta distingue UUID inválido, contrato ausente y contrato sin evidencias', async t => {
  const { request } = await start(t);
  const contract = await createContract(request);
  const invalid = await request('/api/contratos/no-es-uuid/recepciones');
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.error.code, 'INVALID_ID');
  const missing = await request(`/api/contratos/${randomUUID()}/recepciones`);
  assert.equal(missing.response.status, 404);
  assert.equal(missing.body.error.code, 'CONTRACT_NOT_FOUND');
  const empty = await request(`/api/contratos/${contract.id}/recepciones`);
  assert.deepEqual(empty.body, { recepciones: [] });
});
