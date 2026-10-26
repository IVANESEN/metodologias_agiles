import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDatabase, initializeDatabase } from './database.mjs';
import { createServer } from './app.mjs';
import { createUser } from './auth.mjs';
import { hoyElSalvador } from './contratos-por-vencer.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const CLAVE = 'Clave de prueba portal 2026';

function shift(days) {
  const date = new Date(`${hoyElSalvador()}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test('Portal multirrol: escenarios de cliente, proveedor, empleado y administración', async (t) => {
  const database = await createDatabase({ connectionString: '', dataDir: 'memory://', production: false });
  await initializeDatabase(database);
  const server = createServer({ database, requireAuth: true, logger: {}, secureCookies: false });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await database.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(path, { cookie, method = 'GET', body } = {}) {
    const response = await fetch(base + path, {
      method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = response.headers.get('content-type') || '';
    return { status: response.status, body: type.includes('json') ? await response.json() : null, response };
  }
  async function login(correo, clave = CLAVE) {
    const result = await call('/api/auth/login', { method: 'POST', body: { correo, clave } });
    assert.equal(result.status, 200, `login ${correo}`);
    return result.response.headers.get('set-cookie').split(';')[0];
  }

  const cuentas = {};
  for (const rol of ['admin', 'empleado', 'proveedor', 'cliente']) {
    cuentas[rol] = await createUser(database, { correo: `${rol}@portal.example`, nombre: `Cuenta ${rol}`, clave: CLAVE, rol });
  }
  const segundoProveedor = await createUser(database, { correo: 'otro@portal.example', nombre: 'Otro proveedor', clave: CLAVE, rol: 'proveedor' });
  const cookie = {};
  for (const rol of Object.keys(cuentas)) cookie[rol] = await login(`${rol}@portal.example`);

  await t.test('E1 · cada rol recibe solo sus permisos y la página del portal exige sesión', async () => {
    const sinSesion = await fetch(`${base}/app.html`, { redirect: 'manual' });
    assert.equal(sinSesion.status, 302);
    assert.equal(sinSesion.headers.get('location'), '/login.html');
    assert.equal((await fetch(`${base}/assets/img/maquinaria/minicargador.jpg`)).status, 200, 'las fotos de marca son públicas');
    const cliente = await call('/api/auth/sesion', { cookie: cookie.cliente });
    assert.ok(cliente.body.permisos.includes('pedidos.crear'));
    assert.ok(!cliente.body.permisos.includes('usuarios.crear'));
    const admin = await call('/api/auth/sesion', { cookie: cookie.admin });
    for (const permiso of ['configuracion.editar', 'usuarios.administrar', 'cobros.consultar', 'productos.moderar']) {
      assert.ok(admin.body.permisos.includes(permiso), permiso);
    }
    assert.equal((await call('/api/portal/usuarios', { cookie: cookie.cliente })).status, 403);
    assert.equal((await call('/api/portal/configuracion/editar', { cookie: cookie.empleado, method: 'PUT', body: { valores: { iva: 10 } } })).status, 403);
    assert.equal((await call('/api/portal/pedidos/nuevo', { cookie: cookie.proveedor, method: 'POST', body: {} })).status, 403);
  });

  await t.test('E2 · registro público de clientes con contraseña segura y correo único', async () => {
    const debil = await call('/api/auth/registro', { method: 'POST', body: { nombre: 'Nueva Obra', correo: 'nueva@obra.example', clave: 'solotexto' } });
    assert.equal(debil.status, 400);
    assert.ok(debil.body.error.fields.clave);
    const ok = await call('/api/auth/registro', { method: 'POST',
      body: { nombre: 'Nueva Obra', correo: 'Nueva@Obra.example', clave: 'ObraNueva2026', empresa: 'Obra S.A.', rol: 'admin' } });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.rol, 'cliente', 'el registro público nunca crea otro rol');
    const repetido = await call('/api/auth/registro', { method: 'POST', body: { nombre: 'Xavier Obra', correo: 'nueva@obra.example', clave: 'ObraNueva2026' } });
    assert.equal(repetido.status, 409);
    await login('nueva@obra.example', 'ObraNueva2026');
  });

  let productoId;
  await t.test('E3 · el proveedor publica un equipo: queda pendiente y fuera de la tienda', async () => {
    const incompleto = await call('/api/portal/productos/nuevo', { cookie: cookie.proveedor, method: 'POST',
      body: { nombre: 'Ex', accion: 'publicar' } });
    assert.equal(incompleto.status, 400);
    assert.ok(incompleto.body.error.fields.descripcion && incompleto.body.error.fields.imagenes);
    const creado = await call('/api/portal/productos/nuevo', { cookie: cookie.proveedor, method: 'POST', body: {
      nombre: 'Excavadora Komatsu PC210', tipo: 'Excavadora', marca: 'Komatsu', modelo: 'PC210LC-11', anio: 2022,
      descripcion: 'Excavadora de 21 toneladas con cucharón de 1.2 m³, lista para obra civil.', condicion: 'USADO',
      modalidad: 'AMBAS', tarifa_diaria: '300', precio_venta: '135000', stock: 1, ubicacion: 'San Salvador',
      especificaciones: { Potencia: '165 hp' }, imagenes: [PNG], accion: 'publicar',
    } });
    assert.equal(creado.status, 201);
    assert.equal(creado.body.estado_publicacion, 'PENDIENTE');
    assert.match(creado.body.imagenes[0], /^\/api\/portal\/imagenes\/\d+\/0$/);
    productoId = creado.body.id;
    const tienda = await call('/api/portal/catalogo', { cookie: cookie.cliente });
    assert.ok(!tienda.body.productos.some((p) => p.id === productoId));
    const imagen = await fetch(base + creado.body.imagenes[0], { headers: { Cookie: cookie.proveedor } });
    assert.equal(imagen.headers.get('content-type'), 'image/png');
  });

  await t.test('E4 · el empleado modera: rechazo exige motivo y la aprobación publica', async () => {
    const sinMotivo = await call(`/api/portal/productos/${productoId}/moderar`, { cookie: cookie.empleado, method: 'POST', body: { accion: 'rechazar' } });
    assert.equal(sinMotivo.status, 400);
    const aprobado = await call(`/api/portal/productos/${productoId}/moderar`, { cookie: cookie.empleado, method: 'POST', body: { accion: 'aprobar' } });
    assert.equal(aprobado.body.estado_publicacion, 'ACTIVO');
    const tienda = await call('/api/portal/catalogo?modalidad=VENTA', { cookie: cookie.cliente });
    assert.ok(tienda.body.productos.some((p) => p.id === productoId));
    assert.ok(tienda.body.productos.every((p) => ['VENTA', 'AMBAS'].includes(p.modalidad)));
  });

  await t.test('E5 · un proveedor no puede editar ni ver productos de otro proveedor', async () => {
    const otro = await login('otro@portal.example');
    const editar = await call(`/api/portal/productos/${productoId}`, { cookie: otro, method: 'PUT', body: { stock: 9 } });
    assert.equal(editar.status, 403);
    const lista = await call('/api/portal/productos', { cookie: otro });
    assert.deepEqual(lista.body, []);
    assert.ok(segundoProveedor.id);
  });

  await t.test('E6 · la cotización aplica descuento semanal, operador, flete, IVA y depósito', async () => {
    const quote = await call('/api/portal/cotizar', { cookie: cookie.cliente, method: 'POST', body: { items: [
      { maquinaria_id: 1, modalidad: 'RENTA', fecha_inicio: shift(2), fecha_fin: shift(11), con_operador: true },
    ] } });
    assert.equal(quote.status, 200);
    const t1 = quote.body.totales;
    assert.equal(t1.subtotal, 4500);           // 10 días x 450
    assert.equal(t1.descuento, 225);           // 5 % semanal
    assert.equal(t1.operador, 550);            // 10 x 55
    assert.equal(t1.flete, 85);
    assert.equal(t1.iva, 638.3);               // 13 % de 4910
    assert.equal(t1.deposito, 855);            // 20 % de 4275
    assert.equal(t1.total, 6403.3);
    const pasado = await call('/api/portal/cotizar', { cookie: cookie.cliente, method: 'POST',
      body: { items: [{ maquinaria_id: 1, modalidad: 'RENTA', fecha_inicio: shift(-3), fecha_fin: shift(1) }] } });
    assert.equal(pasado.status, 400);
  });

  let pedidoId;
  await t.test('E7 · reserva de renta bloquea fechas en el portal y en los contratos de obra', async () => {
    const body = { items: [{ maquinaria_id: 2, modalidad: 'RENTA', fecha_inicio: shift(20), fecha_fin: shift(24) }],
      ciudad: 'Santa Ana', direccion: 'Colonia El Palmar, lote 4', metodo_pago: 'TRANSFERENCIA' };
    const creado = await call('/api/portal/pedidos/nuevo', { cookie: cookie.cliente, method: 'POST', body });
    assert.equal(creado.status, 201);
    assert.equal(creado.body.estado, 'PENDIENTE');
    assert.match(creado.body.numero_visible, /^PED-\d+$/);
    pedidoId = creado.body.id;
    const doble = await call('/api/portal/pedidos/nuevo', { cookie: cookie.cliente, method: 'POST',
      body: { ...body, items: [{ ...body.items[0], fecha_inicio: shift(22), fecha_fin: shift(30) }] } });
    assert.equal(doble.status, 409);
    const contrato = await call('/api/contratos', { cookie: cookie.empleado, method: 'POST', body: {
      maquinaria_ids: [2], cliente: 'Obra paralela', ciudad: 'Santa Ana', operador: 'Operador', seguro: 'TODO_RIESGO',
      forma_pago: 'EFECTIVO', fecha_inicio: shift(24), fecha_fin: shift(26) } });
    assert.equal(contrato.status, 409);
    const disponible = await call(`/api/maquinaria?fecha_inicio=${shift(21)}&fecha_fin=${shift(21)}`, { cookie: cookie.empleado });
    assert.ok(!disponible.body.some((m) => m.id === 2));
  });

  await t.test('E8 · compra aparta inventario; sin existencias se rechaza y cancelar lo devuelve', async () => {
    const compra = { items: [{ maquinaria_id: productoId, modalidad: 'COMPRA', cantidad: 1 }],
      ciudad: 'San Miguel', direccion: 'Carretera Panamericana km 138', metodo_pago: 'CHEQUE' };
    const creado = await call('/api/portal/pedidos/nuevo', { cookie: cookie.cliente, method: 'POST', body: compra });
    assert.equal(creado.status, 201);
    const agotado = await call('/api/portal/pedidos/nuevo', { cookie: cookie.cliente, method: 'POST', body: compra });
    assert.equal(agotado.status, 409);
    assert.equal(agotado.body.error.code, 'OUT_OF_STOCK');
    const cancelado = await call(`/api/portal/pedidos/${creado.body.id}/cancelar`, { cookie: cookie.cliente, method: 'POST', body: {} });
    assert.equal(cancelado.body.estado, 'CANCELADO');
    const producto = await call(`/api/portal/productos/${productoId}`, { cookie: cookie.proveedor });
    assert.equal(producto.body.stock, 1);
    const otraVez = await call(`/api/portal/pedidos/${creado.body.id}/cancelar`, { cookie: cookie.cliente, method: 'POST', body: {} });
    assert.equal(otraVez.status, 409);
  });

  await t.test('E9 · flujo de estados del pedido con historial visible para el cliente', async () => {
    const saltar = await call(`/api/portal/pedidos/${pedidoId}/estado`, { cookie: cookie.empleado, method: 'POST', body: { estado: 'COMPLETADO' } });
    assert.equal(saltar.status, 409);
    for (const estado of ['APROBADO', 'EN_ENTREGA', 'COMPLETADO']) {
      const result = await call(`/api/portal/pedidos/${pedidoId}/estado`, { cookie: cookie.empleado, method: 'POST', body: { estado } });
      assert.equal(result.body.estado, estado);
    }
    const detalle = await call(`/api/portal/pedidos/${pedidoId}`, { cookie: cookie.cliente });
    assert.deepEqual(detalle.body.eventos.map((e) => e.estado), ['PENDIENTE', 'APROBADO', 'EN_ENTREGA', 'COMPLETADO']);
    assert.equal(detalle.body.cancelable, false);
    const ajeno = await call(`/api/portal/pedidos/${pedidoId}`, { cookie: cookie.proveedor });
    assert.equal(ajeno.status, 404, 'el proveedor no ve pedidos sin sus equipos');
  });

  await t.test('E10 · el empleado crea clientes y proveedores, no administradores, con clave temporal', async () => {
    const admin = await call('/api/portal/usuarios/nuevo', { cookie: cookie.empleado, method: 'POST',
      body: { nombre: 'Intruso', correo: 'intruso@portal.example', rol: 'admin' } });
    assert.equal(admin.status, 400);
    const proveedor = await call('/api/portal/usuarios/nuevo', { cookie: cookie.empleado, method: 'POST',
      body: { nombre: 'Grúas del Pacífico', correo: 'gruas@pacifico.example', rol: 'proveedor', telefono: '2440-1000' } });
    assert.equal(proveedor.status, 201);
    assert.match(proveedor.body.clave_temporal, /^Ici-/);
    const sesion = await login('gruas@pacifico.example', proveedor.body.clave_temporal);
    const nueva = await call(`/api/portal/usuarios/${proveedor.body.usuario.id}/clave`, { cookie: cookie.empleado, method: 'POST', body: {} });
    assert.equal(nueva.status, 200);
    assert.equal((await call('/api/auth/sesion', { cookie: sesion })).status, 401, 'restablecer cierra sus sesiones');
    await login('gruas@pacifico.example', nueva.body.clave_temporal);
    const staff = await call(`/api/portal/usuarios/${cuentas.admin.id}`, { cookie: cookie.empleado, method: 'PUT', body: { nombre: 'X', activo: false } });
    assert.equal(staff.status, 404);
  });

  await t.test('E11 · el administrador cambia tasas dentro de rangos y queda auditado', async () => {
    const fuera = await call('/api/portal/configuracion/editar', { cookie: cookie.admin, method: 'PUT', body: { valores: { iva: 80 } } });
    assert.equal(fuera.status, 400);
    const ok = await call('/api/portal/configuracion/editar', { cookie: cookie.admin, method: 'PUT', body: { valores: { iva: '15', flete_base: 100 } } });
    assert.equal(ok.body.cambios, 2);
    const quote = await call('/api/portal/cotizar', { cookie: cookie.cliente, method: 'POST', body: { items: [
      { maquinaria_id: 1, modalidad: 'RENTA', fecha_inicio: shift(40), fecha_fin: shift(40) }] } });
    assert.equal(quote.body.totales.flete, 100);
    assert.equal(quote.body.totales.iva, 82.5);  // 15 % de 550
    const bitacora = await call('/api/portal/auditoria', { cookie: cookie.admin });
    assert.ok(bitacora.body.some((row) => row.accion === 'configuracion.editar'));
    assert.equal((await call('/api/portal/auditoria', { cookie: cookie.empleado })).status, 403);
  });

  await t.test('E12 · el administrador promueve roles pero no puede desactivarse a sí mismo', async () => {
    const propio = await call(`/api/portal/usuarios/${cuentas.admin.id}`, { cookie: cookie.admin, method: 'PUT',
      body: { nombre: 'Cuenta admin', activo: false } });
    assert.equal(propio.status, 400);
    const promovido = await call(`/api/portal/usuarios/${cuentas.empleado.id}`, { cookie: cookie.admin, method: 'PUT',
      body: { nombre: 'Cuenta empleado', rol: 'gerente' } });
    assert.equal(promovido.body.rol, 'gerente');
    assert.equal((await call('/api/auth/sesion', { cookie: cookie.empleado })).status, 401, 'el cambio de rol cierra sesiones');
  });

  await t.test('E13 · cambio de contraseña exige la actual y conserva la sesión en uso', async () => {
    const mala = await call('/api/portal/perfil/clave', { cookie: cookie.cliente, method: 'POST', body: { actual: 'incorrecta', nueva: 'NuevaClave2026' } });
    assert.equal(mala.status, 400);
    assert.ok(mala.body.error.fields.actual);
    const otra = await login('cliente@portal.example');
    const ok = await call('/api/portal/perfil/clave', { cookie: cookie.cliente, method: 'POST', body: { actual: CLAVE, nueva: 'NuevaClave2026' } });
    assert.equal(ok.status, 200);
    assert.equal((await call('/api/auth/sesion', { cookie: cookie.cliente })).status, 200);
    assert.equal((await call('/api/auth/sesion', { cookie: otra })).status, 401);
    const resumen = await call('/api/portal/resumen', { cookie: cookie.cliente });
    assert.equal(resumen.body.perfil.correo, 'cliente@portal.example');
    assert.ok(resumen.body.kpis.completados >= 1);
  });
});
