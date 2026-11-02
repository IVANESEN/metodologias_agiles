import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createDatabase, initializeDatabase } from './database.mjs';
import { createServer, saveContract, validateContract } from './app.mjs';
import { createUser } from './auth.mjs';
import { guardarEntrega } from './entregas.mjs';
import { createMemoryDispatchAdapter, enviarDespacho } from './despacho.mjs';
import { PNG } from './test-fotografias.mjs';

test('H01/H09: permisos, historial inmutable, despacho real programado y reintento simulado', async t => {
  const db = await createDatabase({ connectionString: '', dataDir: 'memory://', production: false });
  await initializeDatabase(db);
  const adapter = createMemoryDispatchAdapter({ failFirst: true });
  const server = createServer({ database: db, requireAuth: true, secureCookies: false, dispatchAdapter: adapter, logger: {} });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { body, cookie } = {}) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  const users = {}, cookies = {};
  for (const rol of ['gerente', 'residente']) {
    const input = { nombre: `Prueba ${rol}`, correo: `${rol}@despacho.example`, clave: 'Clave pruebas despacho 2026', rol };
    users[rol] = await createUser(db, input);
    const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal(response.status, 200);
    cookies[rol] = response.headers.get('set-cookie').split(';')[0];
  }
  const contract = await saveContract(db, validateContract({ maquinaria_ids: [1, 2], cliente: 'Cliente de despacho', ciudad: 'Santa Ana',
    fecha_inicio: '2040-01-10', fecha_fin: '2040-01-12', operador: 'Operador de prueba', seguro: 'TODO_RIESGO', forma_pago: 'TRANSFERENCIA' }));
  const path = `/api/contratos/${contract.id}/despacho`;

  await t.test('despacho exige sesión, permiso y programación; residente puede consultar', async () => {
    assert.equal((await request(path, { body: {} })).status, 401);
    assert.equal((await request(path, { cookie: cookies.residente, body: {} })).status, 403);
    assert.equal((await request(path, { cookie: cookies.residente })).status, 200);
    const unscheduled = await request(path, { cookie: cookies.gerente, body: {} });
    assert.equal(unscheduled.status, 409);
    assert.equal(unscheduled.body.error.code, 'DELIVERY_NOT_SCHEDULED');
  });

  const data = { contrato_id: contract.id, fecha_entrega: '2040-01-09', hora_desde: '07:30', hora_hasta: '09:00', transportista: 'Transporte de prueba HU9b' };
  await guardarEntrega(db, data, '2040-01-01');
  let first;
  await t.test('fallo visible, reintento explícito y comprobante del destino simulado', async () => {
    first = await request(path, { cookie: cookies.gerente, body: {} });
    assert.equal(first.body.notificacion.estado, 'FALLIDO');
    assert.equal(first.body.notificacion.intentos, 1);
    assert.match(first.body.notificacion.ultimo_error, /No se confirmó/);
    assert.equal(adapter.received.size, 0);
    await request(path, { cookie: cookies.gerente, body: {} });
    assert.equal(adapter.attempts.length, 1, 'repetir POST sin reintentar no reenvía un fallo');
    const retry = await request(path, { cookie: cookies.gerente, body: { reintentar: true } });
    assert.equal(retry.body.notificacion.estado, 'ENVIADO');
    assert.equal(retry.body.notificacion.id, first.body.notificacion.id);
    assert.equal(retry.body.notificacion.intentos, 2);
    const received = adapter.received.get(first.body.notificacion.id);
    assert.deepEqual({ ...received.order.entrega, actualizado_en: 'fecha' }, { fecha_entrega: data.fecha_entrega,
      hora_desde: '07:30', hora_hasta: '09:00', transportista: data.transportista, actualizado_en: 'fecha' });
    assert.ok(received.order.revision_programacion);
    assert.deepEqual(received.order.carga.map(m => m.maquinaria_id), [1, 2]);
    assert.equal(received.order.contrato.cliente, contract.cliente);
    assert.equal(received.order.contrato.ciudad, 'Santa Ana');
    assert.equal(received.id, retry.body.notificacion.proveedor_id);
    const duplicates = await Promise.all(Array.from({ length: 3 }, () => request(path, { cookie: cookies.gerente, body: { reintentar: true } })));
    assert.ok(duplicates.every(r => r.body.replayed));
    assert.equal(adapter.received.size, 1);
    assert.equal(adapter.attempts.length, 2);
    const history = await request(path, { cookie: cookies.residente });
    assert.equal(history.body.vigente_id, first.body.notificacion.id);
    assert.deepEqual(history.body.intentos.map(i => i.estado), ['FALLIDO', 'ENVIADO']);
    assert.ok(history.body.intentos.every(i => i.usuario_id === users.gerente.id));
  });

  await t.test('reprogramación crea otra orden y conserva el envío previo; falta de canal se registra', async () => {
    await guardarEntrega(db, { ...data, hora_hasta: '10:00' }, '2040-01-01');
    const missing = await enviarDespacho(db, contract.id, {}, users.gerente);
    assert.equal(missing.notificacion.estado, 'FALLIDO');
    assert.match(missing.notificacion.ultimo_error, /Canal de despacho sin configurar/);
    assert.notEqual(missing.notificacion.id, first.body.notificacion.id);
    const retry = await request(path, { cookie: cookies.gerente, body: { reintentar: true } });
    assert.equal(retry.body.notificacion.estado, 'ENVIADO');
    const history = (await request(path, { cookie: cookies.gerente })).body;
    assert.equal(history.notificaciones.length, 2);
    assert.equal(history.intentos.length, 4);
    assert.equal(adapter.received.size, 2);
  });

  await t.test('caída después de recepción externa y antes del commit conserva idempotencia al recuperar', async () => {
    await guardarEntrega(db, { ...data, hora_hasta: '11:00' }, '2040-01-01');
    const failingDb = { transaction: callback => db.transaction(async tx => {
      await callback(tx);
      throw new Error('Fallo inyectado antes del commit');
    }) };
    await assert.rejects(enviarDespacho(failingDb, contract.id, {}, users.gerente, adapter), /Fallo inyectado/);
    assert.equal(adapter.received.size, 3);
    const restored = await enviarDespacho(db, contract.id, {}, users.gerente, adapter);
    assert.equal(restored.notificacion.estado, 'ENVIADO');
    assert.equal(adapter.received.size, 3, 'el mismo contenido no se entrega de nuevo al destino');
  });

  await t.test('volver a una programación anterior genera una orden nueva sin reutilizar su confirmación histórica', async () => {
    await guardarEntrega(db, data, '2040-01-01');
    const restored = await enviarDespacho(db, contract.id, {}, users.gerente, adapter);
    assert.equal(restored.notificacion.estado, 'ENVIADO');
    assert.notEqual(restored.notificacion.id, first.body.notificacion.id);
    assert.notEqual(restored.notificacion.orden.revision_programacion, first.body.notificacion.orden.revision_programacion);
    assert.equal(adapter.received.size, 4);
    const replay = await enviarDespacho(db, contract.id, { reintentar: true }, users.gerente, adapter);
    assert.equal(replay.replayed, true);
    assert.equal(adapter.received.size, 4);
    assert.equal((await request(path, { cookie: cookies.gerente })).body.vigente_id, restored.notificacion.id);
  });

  await t.test('corrección autorizada conserva original, versión, motivo, actor, auditoría y reintentos', async () => {
    const receptionId = randomUUID();
    const damaged = ['data:image/png;base64,QUJDRA=='];
    await db.query(`INSERT INTO recepcion_maquinaria(id,contrato_id,maquinaria_id,horometro,fotos)
      VALUES ($1,$2,1,100,$3::jsonb)`, [receptionId, contract.id, JSON.stringify(damaged)]);
    const route = `/api/recepciones/${receptionId}/correcciones`;
    const input = { id: randomUUID(), version: 0, motivo: 'Reemplazo autorizado de fotografía histórica dañada', fotos: [PNG] };
    assert.equal((await request(route, { body: input })).status, 401);
    assert.equal((await request(route, { cookie: cookies.residente, body: input })).status, 403);
    assert.equal((await request(route, { cookie: cookies.gerente, body: { ...input, fotos: damaged } })).status, 400);
    const corrected = await request(route, { cookie: cookies.gerente, body: input });
    assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
    assert.equal(corrected.body.correccion.version, 1);
    assert.equal(corrected.body.correccion.usuario_id, users.gerente.id);
    assert.equal((await request(`/api/recepciones/${receptionId.toUpperCase()}/correcciones`,
      { cookie: cookies.gerente, body: input })).body.replayed, true);
    const stale = await request(route, { cookie: cookies.gerente, body: { ...input, id: randomUUID() } });
    assert.equal(stale.body.error.code, 'EVIDENCE_VERSION_CONFLICT');
    const valid = await request(route, { cookie: cookies.gerente, body: { ...input, id: randomUUID(), version: 1 } });
    assert.equal(valid.body.error.code, 'VALID_EVIDENCE');
    const history = (await request(route, { cookie: cookies.gerente })).body;
    assert.deepEqual(history.original.fotos, damaged);
    assert.deepEqual(history.correcciones[0].fotos, [PNG]);
    assert.equal(history.correcciones[0].motivo, input.motivo);
    assert.ok(history.correcciones[0].creado_en);
    const effective = await request(`/api/contratos/${contract.id}/recepciones`, { cookie: cookies.residente });
    assert.deepEqual(effective.body.recepciones[0].fotos, [PNG]);
    const audit = await db.query("SELECT usuario_id FROM auditoria WHERE accion='recepcion.corregir' AND entidad_id=$1", [receptionId]);
    assert.deepEqual(audit.rows, [{ usuario_id: users.gerente.id }]);
  });
});
