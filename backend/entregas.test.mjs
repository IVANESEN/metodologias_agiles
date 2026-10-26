import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDatabase, initializeDatabase } from './database.mjs';
import { createServer } from './app.mjs';
import { createUser } from './auth.mjs';
import { createMemoryMailer } from './mailer.mjs';
import { hoyElSalvador } from './contratos-por-vencer.mjs';
import { validarEntrega } from './entregas.mjs';

// Las fechas se calculan desde "hoy" en El Salvador. Si la suite corre justo a
// medianoche de El Salvador, la prueba y el servidor podrían ver días distintos.
const hoy = hoyElSalvador();
const dia = (offset) => new Date(Date.parse(`${hoy}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
const NO_EXISTE = '00000000-0000-4000-8000-000000000000';

async function start(t, opciones = {}) {
  // Opciones explícitas: la suite no depende de DATABASE_URL ni de .env.
  const database = await createDatabase({ connectionString: '', dataDir: 'memory://', production: false });
  await initializeDatabase(database);
  const server = createServer({ database, logger: {}, ...opciones });
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await database.close();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { body, cookie, method } = {}) {
    const response = await fetch(base + path, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: { Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const tipo = response.headers.get('content-type') || '';
    return { response, status: response.status,
      body: tipo.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  }
  return { database, request };
}

async function crearContrato(request, { maquinarias = [1], inicio = dia(10), fin = dia(12), cookie } = {}) {
  const result = await request('/api/contratos', { cookie, body: {
    maquinaria_ids: maquinarias, cliente: 'Cliente entrega HU9a', ciudad: 'Santa Ana',
    fecha_inicio: inicio, fecha_fin: fin, operador: 'Operador HU9a', seguro: 'TODO_RIESGO', forma_pago: 'TRANSFERENCIA',
  } });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}

const filas = async (database, contratoId) => (await database.query(
  'SELECT COUNT(*)::integer AS total FROM entrega_programada WHERE contrato_id = $1', [contratoId])).rows[0].total;

test('HU9a API: programa, consulta, reprograma y reintenta sin duplicar la entrega', async t => {
  const { database, request } = await start(t);
  const contrato = await crearContrato(request);
  const sinProgramar = await request(`/api/contratos/${contrato.id}/entrega`);
  assert.equal(sinProgramar.status, 200);
  assert.deepEqual(sinProgramar.body, { estado: 'SIN_PROGRAMAR', entrega: null });
  assert.equal(sinProgramar.response.headers.get('cache-control'), 'no-store');

  const entrada = { contrato_id: contrato.id.toUpperCase(), fecha_entrega: dia(9), hora_desde: '07:30',
    hora_hasta: '09:00', transportista: '  Transportes del Pacífico  ' };
  const creada = await request('/api/entregas', { body: entrada });
  assert.equal(creada.status, 201);
  assert.equal(creada.response.headers.get('location'), `/api/contratos/${contrato.id}/entrega`);
  const { actualizado_en: actualizadoCreacion, ...datos } = creada.body.entrega;
  assert.equal(creada.body.estado, 'PROGRAMADA');
  assert.deepEqual(datos, { contrato_id: contrato.id, fecha_entrega: dia(9), hora_desde: '07:30',
    hora_hasta: '09:00', transportista: 'Transportes del Pacífico' });
  assert.match(actualizadoCreacion, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

  const programada = await request(`/api/contratos/${contrato.id}/entrega`);
  assert.equal(programada.status, 200);
  assert.deepEqual(programada.body, creada.body);

  const reintento = await request('/api/entregas', { body: entrada });
  assert.equal(reintento.status, 200);
  assert.deepEqual(reintento.body, creada.body, 'un reintento idéntico no cambia actualizado_en');

  const cambio = { ...entrada, fecha_entrega: dia(10), hora_desde: '13:00', hora_hasta: '15:30', transportista: 'Fletes Unidos' };
  const reprogramada = await request('/api/entregas', { body: cambio });
  assert.equal(reprogramada.status, 200);
  assert.equal(reprogramada.body.entrega.transportista, 'Fletes Unidos');
  assert.equal(reprogramada.body.entrega.fecha_entrega, dia(10));
  assert.equal(reprogramada.body.entrega.hora_desde, '13:00');
  assert.ok(reprogramada.body.entrega.actualizado_en >= actualizadoCreacion);
  assert.deepEqual((await request(`/api/contratos/${contrato.id}/entrega`)).body, reprogramada.body);
  assert.equal(await filas(database, contrato.id), 1);

  const stored = await database.query(`SELECT fecha_entrega::text, hora_desde::text, hora_hasta::text, transportista
    FROM entrega_programada WHERE contrato_id = $1`, [contrato.id]);
  assert.deepEqual(stored.rows[0], { fecha_entrega: dia(10), hora_desde: '13:00:00', hora_hasta: '15:30:00',
    transportista: 'Fletes Unidos' });
});

test('HU9a API: un contrato con varias máquinas tiene un solo flete y los límites de fecha se incluyen', async t => {
  const { database, request } = await start(t);
  const contrato = await crearContrato(request, { maquinarias: [1, 2], inicio: dia(3), fin: dia(5) });
  for (const fecha of [hoy, dia(5)]) {
    const result = await request('/api/entregas', { body: { contrato_id: contrato.id, fecha_entrega: fecha,
      hora_desde: '00:00', hora_hasta: '23:59', transportista: 'Grúas El Salvador' } });
    assert.ok([200, 201].includes(result.status), `${fecha}: ${JSON.stringify(result.body)}`);
  }
  assert.equal(await filas(database, contrato.id), 1);
});

test('HU9a API: identificadores inválidos o inexistentes no escriben nada', async t => {
  const { database, request } = await start(t);
  const valido = { fecha_entrega: dia(1), hora_desde: '08:00', hora_hasta: '10:00', transportista: 'Transportes' };
  const invalido = await request('/api/contratos/no-es-uuid/entrega');
  assert.equal(invalido.status, 400);
  assert.equal(invalido.body.error.code, 'INVALID_ID');
  const ausente = await request(`/api/contratos/${NO_EXISTE}/entrega`);
  assert.equal(ausente.status, 404);
  assert.equal(ausente.body.error.code, 'CONTRACT_NOT_FOUND');
  const postAusente = await request('/api/entregas', { body: { ...valido, contrato_id: NO_EXISTE } });
  assert.equal(postAusente.status, 404);
  assert.equal(postAusente.body.error.code, 'CONTRACT_NOT_FOUND');
  const postInvalido = await request('/api/entregas', { body: { ...valido, contrato_id: 'no-es-uuid' } });
  assert.equal(postInvalido.status, 400);
  assert.equal(postInvalido.body.error.code, 'VALIDATION_ERROR');
  assert.ok(postInvalido.body.error.fields.contrato_id);
  assert.equal((await database.query('SELECT COUNT(*)::integer AS total FROM entrega_programada')).rows[0].total, 0);
});

test('HU9a API: bloquea el guardado si falta transportista o ventana horaria, o si las fechas no corresponden', async t => {
  const { database, request } = await start(t);
  const contrato = await crearContrato(request, { inicio: dia(2), fin: dia(6) });
  const vencido = await crearContrato(request, { maquinarias: [2], inicio: dia(-10), fin: dia(-1) });
  const valido = { contrato_id: contrato.id, fecha_entrega: dia(2), hora_desde: '08:00', hora_hasta: '10:00',
    transportista: 'Transportes del Sur' };
  const casos = [
    ['transportista', { transportista: undefined }], ['transportista', { transportista: '' }],
    ['transportista', { transportista: '    ' }], ['transportista', { transportista: ' x ' }],
    ['transportista', { transportista: 'x'.repeat(161) }], ['transportista', { transportista: 42 }],
    ['hora_desde', { hora_desde: undefined }], ['hora_desde', { hora_desde: '' }],
    ['hora_hasta', { hora_hasta: undefined }], ['hora_hasta', { hora_hasta: null }],
    ['hora_desde', { hora_desde: '8:00' }], ['hora_desde', { hora_desde: '24:00' }],
    ['hora_hasta', { hora_hasta: '10:60' }], ['hora_hasta', { hora_hasta: '10:00:00' }],
    ['hora_hasta', { hora_hasta: '08:00' }], ['hora_hasta', { hora_hasta: '07:59' }],
    ['fecha_entrega', { fecha_entrega: undefined }], ['fecha_entrega', { fecha_entrega: '2031-02-30' }],
    ['fecha_entrega', { fecha_entrega: '15/10/2031' }], ['fecha_entrega', { fecha_entrega: dia(-1) }],
    ['fecha_entrega', { fecha_entrega: dia(7) }],
    ['fecha_entrega', { contrato_id: vencido.id, fecha_entrega: hoy }],
  ];
  for (const [campo, cambio] of casos) {
    const result = await request('/api/entregas', { body: { ...valido, ...cambio } });
    assert.equal(result.status, 400, `${campo} ${JSON.stringify(cambio)}`);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    assert.ok(result.body.error.fields[campo], `falta fields.${campo} para ${JSON.stringify(cambio)}`);
    assert.doesNotMatch(JSON.stringify(result.body), /SELECT|INSERT|entrega_programada|constraint/i);
  }
  const vencidoResult = await request('/api/entregas', { body: { ...valido, contrato_id: vencido.id, fecha_entrega: hoy } });
  assert.match(vencidoResult.body.error.fields.fecha_entrega, /terminó/);
  const tarde = await request('/api/entregas', { body: { ...valido, fecha_entrega: dia(7) } });
  assert.match(tarde.body.error.fields.fecha_entrega, new RegExp(dia(6)));
  for (const cuerpo of [[], null, 'texto']) {
    const result = await request('/api/entregas', { body: cuerpo });
    assert.equal(result.status, 400);
    assert.deepEqual(Object.keys(result.body.error.fields).sort(),
      ['contrato_id', 'fecha_entrega', 'hora_desde', 'hora_hasta', 'transportista']);
  }
  assert.equal((await database.query('SELECT COUNT(*)::integer AS total FROM entrega_programada')).rows[0].total, 0);
  // Un contrato vencido conserva y muestra una programación existente.
  await database.query(`INSERT INTO entrega_programada (contrato_id, fecha_entrega, hora_desde, hora_hasta, transportista)
    VALUES ($1, $2, '08:00', '09:00', 'Transporte histórico')`, [vencido.id, dia(-5)]);
  const historica = await request(`/api/contratos/${vencido.id}/entrega`);
  assert.equal(historica.body.estado, 'PROGRAMADA');
  assert.equal(historica.body.entrega.fecha_entrega, dia(-5));
});

test('HU9a validación pura: normaliza y reporta todos los campos a la vez', () => {
  assert.deepEqual(validarEntrega({ contrato_id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', fecha_entrega: '2031-03-10',
    hora_desde: '06:00', hora_hasta: '06:01', transportista: '  Fletes  ' }, '2031-03-10'), { datos: {
    contrato_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', fecha_entrega: '2031-03-10', hora_desde: '06:00',
    hora_hasta: '06:01', transportista: 'Fletes' } });
  const { fields } = validarEntrega({}, '2031-03-10');
  assert.deepEqual(Object.keys(fields).sort(), ['contrato_id', 'fecha_entrega', 'hora_desde', 'hora_hasta', 'transportista']);
  assert.equal(validarEntrega({ contrato_id: NO_EXISTE, fecha_entrega: '2031-03-10', hora_desde: '08:00',
    hora_hasta: '10:00', transportista: 'x'.repeat(160) }, '2031-03-10').datos.transportista.length, 160);
});

test('HU9a base: las restricciones de schema.sql son la última barrera', async t => {
  const { database, request } = await start(t);
  const contrato = await crearContrato(request);
  const insertar = (contratoId, desde, hasta, transportista) => database.query(`INSERT INTO entrega_programada
    (contrato_id, fecha_entrega, hora_desde, hora_hasta, transportista) VALUES ($1, $2, $3, $4, $5)`,
  [contratoId, dia(10), desde, hasta, transportista]);
  for (const [desde, hasta, transportista] of [['09:00', '09:00', 'Fletes'], ['09:00', '08:00', 'Fletes'],
    ['08:00', '09:00', '  '], ['08:00', '09:00', 'x']]) {
    await assert.rejects(insertar(contrato.id, desde, hasta, transportista), { code: '23514' });
  }
  await assert.rejects(insertar(contrato.id, null, '09:00', 'Fletes'), { code: '23502' });
  await assert.rejects(insertar(contrato.id, '08:00', '09:00', null), { code: '23502' });
  await assert.rejects(insertar(NO_EXISTE, '08:00', '09:00', 'Fletes'), { code: '23503' });
  await insertar(contrato.id, '08:00', '09:00', 'Fletes');
  await assert.rejects(insertar(contrato.id, '10:00', '11:00', 'Otro'), { code: '23505' });
  await assert.rejects(database.query('DELETE FROM contrato WHERE id = $1', [contrato.id]), { code: '23001' });
});

test('HU9a permisos: sin sesión 401; residente consulta pero no programa; gerente hace ambas', async t => {
  const mailer = createMemoryMailer();
  const { database, request } = await start(t, { requireAuth: true, secureCookies: true,
    appUrl: 'https://constructora.example', mailer });
  const cookies = {};
  for (const rol of ['residente', 'gerente']) {
    const datos = { correo: `${rol}@entregas.example`, nombre: `Usuario ${rol}`, clave: 'Clave de prueba HU9a 2026', rol };
    await createUser(database, datos);
    const login = await request('/api/auth/login', { body: datos });
    assert.equal(login.status, 200);
    cookies[rol] = login.response.headers.get('set-cookie').split(';')[0];
  }
  const contrato = await crearContrato(request, { cookie: cookies.gerente });
  const entrada = { contrato_id: contrato.id, fecha_entrega: dia(9), hora_desde: '08:00', hora_hasta: '10:00',
    transportista: 'Transportes HU9a' };

  for (const [path, body] of [[`/api/contratos/${contrato.id}/entrega`, undefined], ['/api/entregas', entrada]]) {
    const anonimo = await request(path, { body });
    assert.equal(anonimo.status, 401, path);
    assert.equal(anonimo.body.error.code, 'UNAUTHENTICATED');
  }

  const consultaResidente = await request(`/api/contratos/${contrato.id}/entrega`, { cookie: cookies.residente });
  assert.equal(consultaResidente.status, 200);
  assert.equal(consultaResidente.body.estado, 'SIN_PROGRAMAR');
  const programaResidente = await request('/api/entregas', { cookie: cookies.residente, body: entrada });
  assert.equal(programaResidente.status, 403);
  assert.equal(programaResidente.body.error.code, 'FORBIDDEN');
  assert.equal(await filas(database, contrato.id), 0);

  const programaGerente = await request('/api/entregas', { cookie: cookies.gerente, body: entrada });
  assert.equal(programaGerente.status, 201);
  const consultaGerente = await request(`/api/contratos/${contrato.id}/entrega`, { cookie: cookies.gerente });
  assert.equal(consultaGerente.status, 200);
  assert.equal(consultaGerente.body.estado, 'PROGRAMADA');
  const consultaPosterior = await request(`/api/contratos/${contrato.id}/entrega`, { cookie: cookies.residente });
  assert.deepEqual(consultaPosterior.body, consultaGerente.body);
});

test('HU9a regresión: programar la entrega no cambia el contrato, su documento ni su PDF', async t => {
  const { database, request } = await start(t);
  const contrato = await crearContrato(request, { maquinarias: [1, 2] });
  const leer = async () => ({
    contrato: (await request(`/api/contratos/${contrato.id}`)).body,
    documento: (await request(`/api/contratos/${contrato.id}/documento`)).body,
    fila: (await database.query('SELECT * FROM contrato WHERE id = $1', [contrato.id])).rows,
    detalle: (await database.query('SELECT * FROM contrato_maquinaria WHERE contrato_id = $1 ORDER BY maquinaria_id',
      [contrato.id])).rows,
  });
  const antes = await leer();
  const pdfAntes = await request(`/api/contratos/${contrato.id}/pdf`);
  const programada = await request('/api/entregas', { body: { contrato_id: contrato.id, fecha_entrega: dia(9),
    hora_desde: '08:00', hora_hasta: '10:00', transportista: 'Transportes HU9a' } });
  assert.equal(programada.status, 201);
  const despues = await leer();
  assert.deepEqual(despues, antes);
  assert.equal(Object.hasOwn(despues.contrato, 'entrega'), false);
  assert.equal(JSON.stringify(despues.documento).includes('Transportes HU9a'), false);
  const pdfDespues = await request(`/api/contratos/${contrato.id}/pdf`);
  // Los bytes del PDF incluyen su fecha de creación; se comparan estado, tipo y tamaño.
  for (const pdf of [pdfAntes, pdfDespues]) {
    assert.equal(pdf.status, 200);
    assert.equal(pdf.response.headers.get('content-type'), 'application/pdf');
  }
  assert.ok(Math.abs(pdfDespues.body.length - pdfAntes.body.length) < 64);
});
