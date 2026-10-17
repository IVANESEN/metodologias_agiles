import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, initializeDatabase } from './database.mjs';
import { createServer } from './app.mjs';

const terms = {
  maquinaria_id: 1, cliente: 'Cliente de cobros', ciudad: 'Santa Ana',
  operador: 'Operador de cobros', seguro: 'TODO_RIESGO', forma_pago: 'TRANSFERENCIA',
};

test('cobros: pagos, saldos y pendientes consistentes con persistencia real', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'cobros-'));
  const dataDir = join(folder, 'postgres');
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
    if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await database?.close();
    database = null;
  }
  t.after(async () => {
    await stop();
    await rm(folder, { recursive: true, force: true });
  });
  await start();

  async function request(path, body, options = {}) {
    const response = await fetch(base + path, body === undefined ? options : {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), ...options,
    });
    return { status: response.status, body: await response.json() };
  }
  async function create(day, days = 1) {
    const end = String(day + days - 1).padStart(2, '0');
    const result = await request('/api/contratos', {
      ...terms, fecha_inicio: `2035-01-${String(day).padStart(2, '0')}`, fecha_fin: `2035-01-${end}`,
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body;
  }
  const getContract = id => request(`/api/contratos/${id}`);
  const pay = (id, body, options) => request(`/api/contratos/${id}/pagos`, body, options);
  async function paymentSummary(id) {
    const { rows } = await database.query(
      'SELECT COUNT(*)::integer AS cantidad, COALESCE(SUM(monto), 0)::numeric AS monto FROM pago WHERE contrato_id = $1', [id],
    );
    return { cantidad: rows[0].cantidad, monto: Number(rows[0].monto) };
  }
  function assertAccount(contract, total, paid, balance, state) {
    assert.equal(contract.total, total);
    assert.equal(contract.total_pagado, paid);
    assert.equal(contract.saldo_pendiente, balance);
    assert.equal(contract.estado_pago, state);
    assert.equal(contract.estado, 'CONFIRMADO', 'los pagos conservan el estado operativo del contrato');
  }

  let pending, paid, invalid, concurrent, retry;
  let firstPayment;

  await t.test('devuelve un listado vacío cuando todavía no hay contratos pendientes', async () => {
    const result = await request('/api/cobros');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, []);
  });

  await t.test('lista contratos pendientes y excluye el pagado aunque ambos sigan confirmados', async () => {
    pending = await create(1, 3);
    paid = await create(5);
    await database.query('INSERT INTO pago (id, contrato_id, monto) VALUES ($1, $2, $3)', [randomUUID(), paid.id, paid.total]);

    const result = await request('/api/cobros');
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.map(item => item.id), [pending.id]);
    const account = result.body[0];
    assert.equal(account.cliente, terms.cliente);
    assert.equal(account.fecha_inicio, pending.fecha_inicio);
    assert.equal(account.fecha_fin, pending.fecha_fin);
    assertAccount(account, 1350, 0, 1350, 'PENDIENTE');
    assertAccount((await getContract(paid.id)).body, 450, 450, 0, 'PAGADO');
    const operational = await database.query('SELECT estado FROM contrato ORDER BY fecha_inicio');
    assert.deepEqual(operational.rows.map(item => item.estado), ['CONFIRMADO', 'CONFIRMADO']);
  });

  await t.test('el pago parcial devuelve el nuevo saldo y mantiene el contrato pendiente', async () => {
    const result = await pay(pending.id, { monto: '250.25' });
    assert.equal(result.status, 201);
    assert.equal(result.body.pago.contrato_id, pending.id);
    assert.equal(result.body.pago.monto, 250.25);
    assert.match(result.body.pago.id, /^[0-9a-f-]{36}$/i);
    assert.ok(Number.isFinite(Date.parse(result.body.pago.creado_en)));
    assertAccount(result.body.contrato, 1350, 250.25, 1099.75, 'PENDIENTE');
    const list = await request('/api/cobros');
    assert.deepEqual(list.body.map(item => item.id), [pending.id]);
    assertAccount(list.body[0], 1350, 250.25, 1099.75, 'PENDIENTE');
    assertAccount((await getContract(pending.id)).body, 1350, 250.25, 1099.75, 'PENDIENTE');
    assert.deepEqual(await paymentSummary(pending.id), { cantidad: 1, monto: 250.25 });
  });

  await t.test('el pago completo liquida el saldo y la siguiente consulta excluye el contrato', async () => {
    const result = await pay(pending.id, { monto: 1099.75 });
    assert.equal(result.status, 201);
    assertAccount(result.body.contrato, 1350, 1350, 0, 'PAGADO');
    assertAccount((await getContract(pending.id)).body, 1350, 1350, 0, 'PAGADO');
    assert.deepEqual((await request('/api/cobros')).body, []);
    assert.deepEqual(await paymentSummary(pending.id), { cantidad: 2, monto: 1350 });
    const overpayment = await pay(pending.id, { monto: 0.01 });
    assert.equal(overpayment.status, 409);
    assert.deepEqual(await paymentSummary(pending.id), { cantidad: 2, monto: 1350 });
  });

  await t.test('rechaza montos inválidos y sobrepagos sin modificar datos', async () => {
    invalid = await create(8);
    const before = (await getContract(invalid.id)).body;
    for (const body of [null, [], {}, { monto: 0 }, { monto: -1 }, { monto: 1.001 },
      { monto: '1.001' }, { monto: '' }, { monto: 'abc' }, { monto: '1e2' },
      { monto: true }, { monto: null }, { monto: [] }, { monto: {} },
      { monto: '99999999999999999999999999999999' }, { monto: 1, id: 'incorrecto' },
      { monto: 1, id: 123 }, { monto: 1, id: '' },
    ]) {
      const result = await pay(invalid.id, body);
      assert.equal(result.status, 400, JSON.stringify(body));
      assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    }
    assert.equal((await pay(invalid.id, { monto: 450.01 })).status, 409);
    assert.deepEqual((await getContract(invalid.id)).body, before);
    assert.deepEqual(await paymentSummary(invalid.id), { cantidad: 0, monto: 0 });
  });

  await t.test('valida identificadores, JSON, tipo de contenido y métodos antes de escribir', async () => {
    assert.equal((await pay('incorrecto', { monto: 1 })).status, 400);
    assert.equal((await pay(randomUUID(), { monto: 1 })).status, 404);
    assert.equal((await pay(invalid.id, {}, { body: '{' })).status, 400);
    assert.equal((await pay(invalid.id, { monto: 1 }, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await pay(invalid.id, { monto: 1, extra: 'x'.repeat(20000) })).status, 413);
    assert.equal((await request(`/api/contratos/${invalid.id}/pagos`)).status, 405);
    assert.equal((await request('/api/cobros', {})).status, 405);
    assert.deepEqual(await paymentSummary(invalid.id), { cantidad: 0, monto: 0 });
  });

  await t.test('un fallo real de persistencia revierte el pago y conserva el saldo anterior', async () => {
    const before = (await getContract(invalid.id)).body;
    const beforeList = (await request('/api/cobros')).body;
    await database.exec('ALTER TABLE pago ADD CONSTRAINT cobros_test_error CHECK (monto <> 17.35)');
    try {
      const result = await pay(invalid.id, { monto: '17.35' });
      assert.equal(result.status, 500);
      assert.ok(result.body.error.message);
      assert.deepEqual((await getContract(invalid.id)).body, before);
      assert.deepEqual((await request('/api/cobros')).body, beforeList);
      assert.deepEqual(await paymentSummary(invalid.id), { cantidad: 0, monto: 0 });
    } finally {
      await database.exec('ALTER TABLE pago DROP CONSTRAINT cobros_test_error');
    }
  });

  await t.test('dos pagos simultáneos no pueden cobrar más que el saldo del contrato', async () => {
    concurrent = await create(10);
    const results = await Promise.all([
      pay(concurrent.id, { monto: 300 }), pay(concurrent.id, { monto: '300.00' }),
    ]);
    assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
    assertAccount((await getContract(concurrent.id)).body, 450, 300, 150, 'PENDIENTE');
    assert.deepEqual(await paymentSummary(concurrent.id), { cantidad: 1, monto: 300 });
  });

  await t.test('reintentar el mismo pago reutiliza su ID y no vuelve a cobrar', async () => {
    retry = await create(12);
    const id = randomUUID();
    const result = await pay(retry.id, { id, monto: '100.10' });
    assert.equal(result.status, 201);
    firstPayment = result.body.pago;
    assert.equal(firstPayment.id, id);
    const replay = await pay(retry.id, { id, monto: 100.1 });
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body.pago, firstPayment);
    assertAccount(replay.body.contrato, 450, 100.1, 349.9, 'PENDIENTE');
    assert.deepEqual(await paymentSummary(retry.id), { cantidad: 1, monto: 100.1 });
    assert.equal((await pay(retry.id, { id, monto: '100.11' })).status, 409);
    assert.equal((await pay(invalid.id, { id, monto: '100.10' })).status, 409);
    assert.deepEqual(await paymentSummary(retry.id), { cantidad: 1, monto: 100.1 });
    assert.deepEqual(await paymentSummary(invalid.id), { cantidad: 0, monto: 0 });
  });

  await t.test('reintentos simultáneos con el mismo ID registran un solo pago', async () => {
    const id = randomUUID();
    const results = await Promise.all([
      pay(retry.id, { id, monto: '0.01' }), pay(retry.id, { id, monto: 0.01 }),
    ]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 201]);
    assert.deepEqual(results[0].body.pago, results[1].body.pago);
    assertAccount((await getContract(retry.id)).body, 450, 100.11, 349.89, 'PENDIENTE');
    assert.deepEqual(await paymentSummary(retry.id), { cantidad: 2, monto: 100.11 });
  });

  await t.test('saldos, estados e idempotencia sobreviven a migraciones y reinicios', async () => {
    await initializeDatabase(database);
    await stop();
    await start();
    assertAccount((await getContract(pending.id)).body, 1350, 1350, 0, 'PAGADO');
    assertAccount((await getContract(paid.id)).body, 450, 450, 0, 'PAGADO');
    assertAccount((await getContract(concurrent.id)).body, 450, 300, 150, 'PENDIENTE');
    assertAccount((await getContract(retry.id)).body, 450, 100.11, 349.89, 'PENDIENTE');
    const replay = await pay(retry.id, { id: firstPayment.id, monto: '100.10' });
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body.pago, firstPayment);
    assertAccount(replay.body.contrato, 450, 100.11, 349.89, 'PENDIENTE');
    const list = (await request('/api/cobros')).body;
    assert.deepEqual(new Set(list.map(item => item.id)), new Set([invalid.id, concurrent.id, retry.id]));
    assert.ok(list.every(item => item.saldo_pendiente > 0 && item.estado_pago === 'PENDIENTE'));
  });
});
