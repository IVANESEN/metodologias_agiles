import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDatabase, initializeDatabase } from './database.mjs';
import { createServer } from './app.mjs';
import { createUser } from './auth.mjs';
import { hoyElSalvador } from './contratos-por-vencer.mjs';
import { occupiedRanges, rentalEligibility } from './alquiler-reglas.mjs';

function dateIn(days) {
  const date = new Date(`${hoyElSalvador()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test('H02/H03/H06: elegibilidad, entrega, períodos inclusivos y reservas simultáneas', async (t) => {
  const database = await createDatabase({ connectionString: '', dataDir: 'memory://', production: false });
  await initializeDatabase(database);
  const server = createServer({ database, requireAuth: true, logger: {}, secureCookies: false });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await database.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const password = 'Alquiler Prueba 2026';
  const cookies = {};

  async function call(path, { role = 'empleado', method = 'GET', body } = {}) {
    const response = await fetch(base + path, { method,
      headers: { ...(cookies[role] ? { Cookie: cookies[role] } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), response };
  }
  for (const role of ['empleado', 'cliente']) {
    await createUser(database, { correo: `${role}@alquiler.example`, nombre: `Prueba ${role}`, clave: password, rol: role });
    const login = await call('/api/auth/login', { role: 'sinSesion', method: 'POST', body: { correo: `${role}@alquiler.example`, clave: password } });
    assert.equal(login.status, 200);
    cookies[role] = login.response.headers.get('set-cookie').split(';')[0];
  }

  const item = (id, from, to = from) => ({ maquinaria_id: id, modalidad: 'RENTA', fecha_inicio: dateIn(from), fecha_fin: dateIn(to) });
  const orderBody = (...items) => ({ items, ciudad: 'Santa Ana', direccion: 'Obra de prueba, lote 4', metodo_pago: 'EFECTIVO' });
  const contractBody = (id, from, to = from) => ({ maquinaria_ids: [id], cliente: 'Prueba renta', ciudad: 'Santa Ana',
    fecha_inicio: dateIn(from), fecha_fin: dateIn(to), operador: 'Operador prueba', seguro: 'TODO_RIESGO', forma_pago: 'EFECTIVO' });
  const createOrder = (body) => call('/api/portal/pedidos/nuevo', { role: 'cliente', method: 'POST', body });
  const quote = (...items) => call('/api/portal/cotizar', { role: 'cliente', method: 'POST', body: { items } });
  const contract = (id, from, to = from) => call('/api/contratos', { method: 'POST', body: contractBody(id, from, to) });
  const state = (id, estado) => call(`/api/portal/pedidos/${id}/estado`, { method: 'POST', body: { estado } });

  let delivered;
  await t.test('Completar entrega conserva reserva en cotización, pedido, contrato, catálogos y calendario', async () => {
    const created = await createOrder(orderBody(item(1, 10, 12)));
    assert.equal(created.status, 201);
    delivered = created.body.id;
    for (const next of ['APROBADO', 'EN_ENTREGA', 'COMPLETADO']) {
      assert.equal((await state(delivered, next)).status, 200, next);
    }
    assert.equal((await quote(item(1, 12))).status, 409);
    assert.equal((await createOrder(orderBody(item(1, 12, 14)))).status, 409);
    assert.equal((await contract(1, 12, 14)).status, 409);
    const query = `fecha_inicio=${dateIn(12)}&fecha_fin=${dateIn(12)}`;
    assert.ok(!(await call(`/api/maquinaria?${query}`)).body.some((row) => row.id === 1));
    const catalog = await call(`/api/portal/catalogo?${query}`, { role: 'cliente' });
    assert.ok(!catalog.body.productos.some((row) => row.id === 1));
    const calendar = await call('/api/reservas/ocupadas?maquinaria_id=1');
    assert.ok(calendar.body.some((range) => range.fecha_inicio === dateIn(10) && range.fecha_fin === dateIn(12)));
    const detail = await call('/api/portal/catalogo/1', { role: 'cliente' });
    assert.ok(detail.body.ocupadas.some((range) => range.fecha_fin === dateIn(12)));
    assert.equal((await state(delivered, 'DEVUELTO')).status, 409, 'la devolución no sustituye la finalización');
    assert.equal((await state(delivered, 'FINALIZADO')).body.error.code, 'RENTAL_NOT_FINISHED');
    assert.equal((await state(delivered, 'CANCELADO')).status, 409, 'entregado no puede cancelarse para liberar fechas');
  });

  await t.test('El último día permanece ocupado; días adyacentes y renta de un día respetan los límites', async () => {
    assert.equal((await quote(item(1, 9))).status, 200);
    assert.equal((await quote(item(1, 13))).status, 200);
    assert.equal((await quote(item(1, 10))).status, 409);
    assert.equal((await quote(item(1, 12))).status, 409);
    assert.equal((await createOrder(orderBody(item(1, 50)))).status, 201);
    assert.equal((await contract(1, 50)).status, 409);
    assert.equal((await contract(1, 51)).status, 201);
    assert.equal((await call('/api/portal/catalogo?fecha_inicio=2027-02-30&fecha_fin=2027-03-01', { role: 'cliente' })).status, 400);
    assert.equal((await call(`/api/portal/catalogo?fecha_inicio=${dateIn(15)}`, { role: 'cliente' })).status, 400);
  });

  await t.test('Cancelar una solicitud libera sus fechas; repetir cancelación no cambia el historial', async () => {
    const created = await createOrder(orderBody(item(2, 20, 21)));
    assert.equal(created.status, 201);
    const path = `/api/portal/pedidos/${created.body.id}/cancelar`;
    assert.equal((await call(path, { role: 'cliente', method: 'POST', body: {} })).status, 200);
    assert.equal((await call(path, { role: 'cliente', method: 'POST', body: {} })).status, 409);
    assert.equal((await quote(item(2, 20, 21))).status, 200);
  });

  await t.test('Finalización y devolución se registran por separado y conservan el período histórico', async () => {
    // Fixture con período ya transcurrido para probar el hito sin alterar el reloj
    // ni afirmar que el portal permite nuevas solicitudes en fechas pasadas.
    await database.query(`UPDATE pedido_item SET fecha_inicio = $2::date, fecha_fin = $3::date
      WHERE pedido_id = $1`, [delivered, dateIn(-3), dateIn(0)]);
    assert.equal((await state(delivered, 'FINALIZADO')).body.error.code, 'RENTAL_NOT_FINISHED', 'hoy sigue incluido');
    await database.query('UPDATE pedido_item SET fecha_fin = $2::date WHERE pedido_id = $1', [delivered, dateIn(-1)]);
    const finalized = await state(delivered, 'FINALIZADO');
    assert.equal(finalized.status, 200);
    assert.equal(finalized.body.estado, 'FINALIZADO');
    assert.equal((await contract(1, -1)).status, 409, 'finalizar conserva ocupación histórica');
    const returned = await state(delivered, 'DEVUELTO');
    assert.equal(returned.status, 200);
    assert.deepEqual(returned.body.eventos.map((event) => event.estado),
      ['PENDIENTE', 'APROBADO', 'EN_ENTREGA', 'COMPLETADO', 'FINALIZADO', 'DEVUELTO']);
    assert.ok((await occupiedRanges(database, 1)).some((range) => range.fecha_fin === dateIn(-1)));
    assert.equal((await contract(1, -1)).status, 409, 'devolver no reescribe disponibilidad histórica');
    assert.equal((await state(delivered, 'DEVUELTO')).status, 409);
  });

  await t.test('API directa rechaza venta, publicaciones no activas e inhabilitación sin crear contratos parciales', async () => {
    const cases = [
      ['VENTA', 'ACTIVO', true], ['RENTA', 'BORRADOR', true], ['RENTA', 'PENDIENTE', true],
      ['RENTA', 'RECHAZADO', true], ['RENTA', 'ARCHIVADO', true], ['RENTA', 'ACTIVO', false],
    ];
    const before = Number((await database.query('SELECT COUNT(*) AS n FROM contrato')).rows[0].n);
    for (const [modalidad, publication, enabled] of cases) {
      await database.query('UPDATE maquinaria SET modalidad=$2, estado_publicacion=$3, disponible=$4 WHERE id=$1',
        [2, modalidad, publication, enabled]);
      assert.equal(rentalEligibility({ modalidad, estado_publicacion: publication, disponible: enabled }), false);
      const response = await call('/api/contratos', { method: 'POST', body: { ...contractBody(2, 30), maquinaria_ids: [1, 2] } });
      assert.equal(response.status, 409, `${modalidad}/${publication}/${enabled}`);
      assert.equal((await quote(item(2, 30))).status, 409);
      assert.equal((await createOrder(orderBody(item(2, 30)))).status, 409);
    }
    assert.equal(Number((await database.query('SELECT COUNT(*) AS n FROM contrato')).rows[0].n), before);
    await database.query("UPDATE maquinaria SET modalidad='AMBAS', estado_publicacion='ACTIVO', disponible=TRUE WHERE id=2");
    assert.equal((await contract(2, 30)).status, 201);
  });

  await t.test('Solicitudes simultáneas sólo crean una reserva incluso entre contrato y pedido', async () => {
    for (const [index, writers] of [
      [0, [() => createOrder(orderBody(item(2, 70))), () => createOrder(orderBody(item(2, 70)))]],
      [1, [() => createOrder(orderBody(item(2, 71))), () => contract(2, 71)]],
      [2, [() => contract(2, 72), () => contract(2, 72)]],
    ]) {
      const responses = await Promise.all(writers.map((write) => write()));
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409], `caso ${index}`);
      const reserved = (await occupiedRanges(database, 2)).filter((range) => range.fecha_inicio === dateIn(70 + index));
      assert.equal(reserved.length, 1);
    }
  });
});
