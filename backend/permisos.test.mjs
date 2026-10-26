import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { createDatabase, initializeDatabase } from './database.mjs';
import { createServer } from './app.mjs';
import { createUser, hashToken, guardPermission } from './auth.mjs';
import { createMemoryMailer } from './mailer.mjs';
import { permisosParaRol } from './permisos.mjs';

const compartidos = [
  'maquinaria.consultar', 'contratos.crear', 'contratos.consultar',
  'contratos.documento', 'contratos.pdf', 'contratos.firmar', 'alertas.consultar',
  'recepciones.crear', 'recepciones.consultar', 'entregas.consultar',
];
const exclusivos = ['cobros.consultar', 'pagos.registrar', 'entregas.programar', 'gastos.aprobar',
  'contratos.modificaciones.autorizar'];
const ordenar = valores => [...valores].sort();
const firma = { ancho: 600, alto: 240, trazos: [[[30, 160], [80, 60], [150, 120]]] };
const entrada = {
  maquinaria_ids: [1], cliente: 'Cliente permisos HU2', ciudad: 'Santa Ana',
  fecha_inicio: '2037-03-01', fecha_fin: '2037-03-02', operador: 'Operador HU2',
  seguro: 'TODO_RIESGO', forma_pago: 'TRANSFERENCIA',
};

test('HU2: matriz explícita para los dos roles y denegación de roles desconocidos', () => {
  assert.deepEqual(ordenar(permisosParaRol('residente')), ordenar(compartidos));
  assert.deepEqual(ordenar(permisosParaRol('gerente')), ordenar([...compartidos, ...exclusivos]));
  for (const rol of [undefined, null, '', 'administrador', 'GERENTE', '__proto__']) {
    assert.deepEqual(permisosParaRol(rol), []);
  }
  assert.doesNotThrow(() => guardPermission({ user: { rol: 'gerente' } }, 'pagos.registrar'));
  for (const permiso of [undefined, null, '', 'operacion.nueva', '__proto__']) {
    assert.throws(() => guardPermission({ user: { rol: 'gerente' } }, permiso),
      { status: 403, code: 'FORBIDDEN' });
  }
  assert.throws(() => guardPermission({ user: { rol: 'administrador' } }, 'pagos.registrar'),
    { status: 403, code: 'FORBIDDEN' });
  assert.throws(() => guardPermission({}, 'pagos.registrar'),
    { status: 401, code: 'UNAUTHENTICATED' });
});

test('HU2: autorización HTTP con sesiones reales y base local temporal', async t => {
  // Explicit options keep this suite independent of any remote DATABASE_URL/.env.
  const database = await createDatabase({ connectionString: '', dataDir: 'memory://', production: false });
  await initializeDatabase(database);
  const consultas = [];
  let transacciones = 0;
  const observado = {
    ...database,
    query(sql, params) { consultas.push(sql); return database.query(sql, params); },
    transaction(callback) {
      transacciones++;
      return database.transaction(tx => callback({
        ...tx,
        query(sql, params) { consultas.push(sql); return tx.query(sql, params); },
      }));
    },
  };
  const mailer = createMemoryMailer();
  const server = createServer({ database: observado, requireAuth: true, secureCookies: true,
    appUrl: 'https://constructora.example', mailer, logger: {} });
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await database.close();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function solicitar(path, { cookie, body, headers = {}, ...opciones } = {}) {
    const response = await fetch(base + path, {
      ...opciones,
      ...(body !== undefined ? { method: opciones.method || 'POST', body: JSON.stringify(body) } : {}),
      headers: { ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    });
    const contenido = response.headers.get('content-type') || '';
    return { response, status: response.status,
      body: contenido.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  }
  function sinConsultasDeNegocio() {
    assert.equal(transacciones, 0, 'la denegación debe ocurrir antes de abrir una transacción de negocio');
    assert.deepEqual(consultas.filter(sql => /\b(?:maquinaria|contrato|contrato_maquinaria|recepcion_maquinaria|entrega_programada|pago)\b/i.test(sql)), [],
      'la denegación debe ocurrir antes de consultar o modificar datos de negocio');
  }
  function limpiarObservacion() { consultas.length = 0; transacciones = 0; }
  function sinCache(result) { assert.equal(result.response.headers.get('cache-control'), 'no-store'); }
  const usuarios = {};
  const cookies = {};
  const contratos = {};
  for (const rol of ['residente', 'gerente']) {
    const datos = { correo: `${rol}@permisos.example`, nombre: `Usuario ${rol}`,
      clave: 'Clave de prueba permisos 2026', rol };
    usuarios[rol] = await createUser(database, datos);
    const login = await solicitar('/api/auth/login', { body: datos });
    assert.equal(login.status, 200);
    assert.deepEqual(login.body, usuarios[rol]);
    const cookie = login.response.headers.get('set-cookie');
    for (const atributo of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Max-Age=28800']) assert.ok(cookie.includes(atributo));
    cookies[rol] = cookie.split(';')[0];
    sinCache(login);
  }

  await t.test('sesión publica la matriz del servidor sin exponer secretos', async () => {
    for (const rol of ['residente', 'gerente']) {
      const result = await solicitar('/api/auth/sesion', { cookie: cookies[rol] });
      assert.equal(result.status, 200);
      const { permisos, ...usuario } = result.body;
      assert.deepEqual(usuario, usuarios[rol]);
      assert.deepEqual(ordenar(permisos), ordenar(rol === 'gerente' ? [...compartidos, ...exclusivos] : compartidos));
      assert.equal(result.body.clave_hash, undefined);
      assert.equal(result.body.token_hash, undefined);
      sinCache(result);
    }
  });

  for (const [indice, rol] of ['residente', 'gerente'].entries()) {
    await t.test(`${rol}: catálogo, reservas, contratos, recepción, documento, PDF, firma y alertas`, async () => {
      const cookie = cookies[rol];
      const catalogo = await solicitar('/api/maquinaria', { cookie });
      assert.equal(catalogo.status, 200);
      assert.ok(catalogo.body.length > 0);
      const creado = await solicitar('/api/contratos', { cookie, body: { ...entrada,
        fecha_inicio: `2037-03-${indice ? '10' : '01'}`, fecha_fin: `2037-03-${indice ? '11' : '02'}` } });
      assert.equal(creado.status, 201);
      const id = creado.body.id;
      contratos[rol] = id;
      assert.equal(creado.response.headers.get('location'), `/api/contratos/${id}`);
      const recepcion = await solicitar('/api/recepciones', { cookie, body: {
        id: randomUUID(), contrato_id: id, maquinaria_id: 1, horometro: 500 + indice,
        fotos: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5ZkAAAAASUVORK5CYII='],
      } });
      assert.equal(recepcion.status, 201);
      assert.equal(recepcion.body.contrato_id, id);
      for (const path of [`/api/contratos/${id}`, `/api/contratos/${id}/documento`,
        `/api/contratos/${id}/recepciones`, '/api/reservas/ocupadas?maquinaria_id=1',
        '/api/contratos/por-vencer?dias=7']) {
        const result = await solicitar(path, { cookie });
        assert.equal(result.status, 200, path);
        sinCache(result);
      }
      const firmado = await solicitar(`/api/contratos/${id}/firma`, { cookie, body: { firma } });
      assert.equal(firmado.status, 200);
      assert.deepEqual(firmado.body.firma, firma);
      const pdf = await solicitar(`/api/contratos/${id}/pdf`, { cookie });
      assert.equal(pdf.status, 200);
      assert.equal(pdf.response.headers.get('content-type'), 'application/pdf');
      assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
      sinCache(pdf);
      const home = await solicitar('/', { cookie });
      assert.equal(home.status, 200);
      sinCache(home);
    });
  }

  await t.test('residente: llamadas directas y roles falsificados reciben 403 antes de leer negocio o validar datos', async () => {
    const id = contratos.residente;
    const antes = await database.query('SELECT * FROM pago ORDER BY id');
    const contratoAntes = await database.query('SELECT * FROM contrato WHERE id=$1', [id]);
    const casos = [
      ['/api/cobros', {}],
      ['/api/cobros?rol=gerente&permiso=cobros.consultar', { headers: { 'X-Rol': 'gerente', 'X-Role': 'gerente' } }],
      [`/api/contratos/${id}/pagos`, { body: { id: randomUUID(), monto: '10.00' } }],
      [`/api/contratos/${id}/pagos?rol=gerente`, { body: { monto: '10.00', rol: 'gerente', permisos: exclusivos },
        headers: { 'X-User-Role': 'gerente', 'X-Rol': 'gerente' } }],
      ['/api/contratos/uuid-invalido/pagos', { body: { monto: '10.00', rol: 'gerente' } }],
      ['/api/entregas', { body: { contrato_id: id, fecha_entrega: '2037-03-01', hora_desde: '08:00',
        hora_hasta: '10:00', transportista: 'Transportes HU9a', rol: 'gerente' }, headers: { 'X-Rol': 'gerente' } }],
    ];
    for (const [path, opciones] of casos) {
      limpiarObservacion();
      const result = await solicitar(path, { cookie: cookies.residente, ...opciones });
      assert.equal(result.status, 403, path);
      assert.match(result.body.error.message, /permiso/i);
      assert.equal(typeof result.body.error.code, 'string');
      sinCache(result);
      sinConsultasDeNegocio();
    }
    for (const [tipo, body] of [['application/json', '{'], ['text/plain', 'rol=gerente&monto=10']]) {
      limpiarObservacion();
      const response = await fetch(`${base}/api/contratos/${id}/pagos`, { method: 'POST',
        headers: { Cookie: cookies.residente, 'Content-Type': tipo, 'X-Rol': 'gerente' }, body });
      assert.equal(response.status, 403);
      assert.match((await response.json()).error.message, /permiso/i);
      sinConsultasDeNegocio();
    }
    assert.deepEqual(await database.query('SELECT * FROM pago ORDER BY id'), antes);
    assert.deepEqual(await database.query('SELECT * FROM contrato WHERE id=$1', [id]), contratoAntes);
    const sesion = await solicitar('/api/auth/sesion?rol=gerente', {
      cookie: cookies.residente, headers: { 'X-Rol': 'gerente' },
    });
    assert.equal(sesion.status, 200);
    assert.equal(sesion.body.rol, 'residente');
    assert.ok(!sesion.body.permisos.includes('pagos.registrar'));
  });

  await t.test('gerente consulta cobros y registra un pago sin perder controles de origen', async () => {
    const id = contratos.residente;
    const cobros = await solicitar('/api/cobros', { cookie: cookies.gerente });
    assert.equal(cobros.status, 200);
    assert.ok(cobros.body.some(cuenta => cuenta.id === id));
    const externo = await solicitar(`/api/contratos/${id}/pagos`, { cookie: cookies.gerente,
      body: { monto: '10.00' }, headers: { Origin: 'https://otro.example' } });
    assert.equal(externo.status, 403);
    assert.equal(externo.body.error.code, 'INVALID_ORIGIN');
    assert.equal((await database.query('SELECT count(*)::integer AS total FROM pago')).rows[0].total, 0);
    const pago = await solicitar(`/api/contratos/${id}/pagos`, { cookie: cookies.gerente,
      body: { id: randomUUID(), monto: '10.00' }, headers: { Origin: 'https://constructora.example' } });
    assert.equal(pago.status, 201);
    assert.equal(pago.body.pago.monto, 10);
    assert.equal(pago.body.contrato.total_pagado, 10);
    sinCache(pago);
  });

  await t.test('el rol se obtiene de nuevo de la base de datos en cada petición y sesión', async () => {
    try {
      await database.query("UPDATE usuario SET rol='gerente' WHERE id=$1", [usuarios.residente.id]);
      const ascendido = await solicitar('/api/auth/sesion', { cookie: cookies.residente });
      assert.equal(ascendido.body.rol, 'gerente');
      assert.ok(ascendido.body.permisos.includes('cobros.consultar'));
      assert.equal((await solicitar('/api/cobros', { cookie: cookies.residente })).status, 200);
      await database.query("UPDATE usuario SET rol='residente' WHERE id=$1", [usuarios.residente.id]);
      const restaurado = await solicitar('/api/auth/sesion', { cookie: cookies.residente });
      assert.equal(restaurado.body.rol, 'residente');
      assert.ok(!restaurado.body.permisos.includes('cobros.consultar'));
      assert.equal((await solicitar('/api/cobros', { cookie: cookies.residente })).status, 403);
    } finally {
      await database.query("UPDATE usuario SET rol='residente' WHERE id=$1", [usuarios.residente.id]);
    }
  });

  await t.test('sesión ausente, inexistente, vencida o usuario inactivo recibe 401, antes de negocio', async () => {
    const token = randomBytes(32).toString('base64url');
    await database.query(`INSERT INTO sesion (id,usuario_id,token_hash,expira_en)
      VALUES ($1,$2,$3,CURRENT_TIMESTAMP - INTERVAL '1 second')`,
    [randomUUID(), usuarios.residente.id, hashToken(token)]);
    for (const cookie of [undefined, `sesion=${randomBytes(32).toString('base64url')}`, `sesion=${token}`]) {
      for (const path of ['/api/maquinaria', '/api/cobros', '/api/auth/sesion']) {
        limpiarObservacion();
        const result = await solicitar(path, { cookie });
        assert.equal(result.status, 401);
        assert.equal(result.body.error.code, 'UNAUTHENTICATED');
        sinCache(result);
        sinConsultasDeNegocio();
      }
      const pago = await solicitar(`/api/contratos/${contratos.residente}/pagos`, { cookie, body: { monto: 1 } });
      assert.equal(pago.status, 401);
    }
    try {
      await database.query('UPDATE usuario SET activo=FALSE WHERE id=$1', [usuarios.residente.id]);
      for (const path of ['/api/maquinaria', '/api/cobros', '/api/auth/sesion']) {
        limpiarObservacion();
        assert.equal((await solicitar(path, { cookie: cookies.residente })).status, 401);
        sinConsultasDeNegocio();
      }
    } finally {
      await database.query('UPDATE usuario SET activo=TRUE WHERE id=$1', [usuarios.residente.id]);
    }
  });

  await t.test('rutas concretas mantienen 404/405 y no habilitan módulos ausentes ni variantes', async () => {
    const id = contratos.residente;
    const desconocidas = ['/api/desconocida', '/api/gastos', '/api/gastos/aprobar',
      `/api/contratos/${id}/modificaciones`, `/api/contratos/${id}/autorizar`,
      `/api/contratos/${id}/pagos/extra`, `/api/contratos/${id}/pagos/`,
      `/api/contratos/${id}/%70agos`, '/api/cobros/', '/api//cobros', '/api/%63obros',
      '/api/entregas/', `/api/contratos/${id}/entregas`, `/api/contratos/${id}/entrega/`];
    const metodosErroneos = [
      ['/api/cobros', 'POST'], ['/api/maquinaria', 'POST'], ['/api/reservas/ocupadas', 'POST'],
      ['/api/contratos', 'GET'], ['/api/contratos/por-vencer', 'POST'], ['/api/recepciones', 'GET'],
      [`/api/contratos/${id}/pagos`, 'GET'], [`/api/contratos/${id}/firma`, 'PUT'],
      [`/api/contratos/${id}/documento`, 'POST'], [`/api/contratos/${id}/pdf`, 'POST'],
      [`/api/contratos/${id}/recepciones`, 'POST'], [`/api/contratos/${id}`, 'DELETE'],
      ['/api/entregas', 'GET'], [`/api/contratos/${id}/entrega`, 'POST'],
    ];
    for (const rol of ['residente', 'gerente']) {
      for (const path of desconocidas) {
        for (const method of ['GET', 'POST']) {
          limpiarObservacion();
          assert.equal((await solicitar(path, { cookie: cookies[rol], method })).status, 404, `${rol} ${method} ${path}`);
          sinConsultasDeNegocio();
        }
      }
      for (const [path, method] of metodosErroneos) {
        limpiarObservacion();
        assert.equal((await solicitar(path, { cookie: cookies[rol], method })).status, 405, `${rol} ${method} ${path}`);
        sinConsultasDeNegocio();
      }
    }
  });

  await t.test('health, login, recuperación y cierre siguen públicos; los errores no se cachean', async () => {
    const health = await solicitar('/api/health');
    assert.equal(health.status, 200);
    sinCache(health);
    for (const page of ['/login.html', '/recuperar.html', '/restablecer.html', '/auth-form.js', '/styles.css']) {
      assert.equal((await solicitar(page)).status, 200, page);
    }
    const loginInvalido = await solicitar('/api/auth/login', { body: {} });
    assert.equal(loginInvalido.status, 400);
    sinCache(loginInvalido);
    const recuperar = await solicitar('/api/auth/recuperar', { body: { correo: usuarios.residente.correo } });
    assert.equal(recuperar.status, 202);
    assert.equal(mailer.outbox.length, 1);
    sinCache(recuperar);
    const restablecer = await solicitar('/api/auth/restablecer', { body: { token: 'invalido', clave: 'Clave nueva 2026' } });
    assert.equal(restablecer.status, 400);
    const logout = await solicitar('/api/auth/logout', { cookie: cookies.residente, body: {} });
    assert.equal(logout.status, 200);
    assert.match(logout.response.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await solicitar('/api/auth/sesion', { cookie: cookies.residente })).status, 401);
    assert.equal((await solicitar('/api/auth/logout', { body: {} })).status, 200);
  });
});
