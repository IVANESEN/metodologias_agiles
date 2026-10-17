import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDatabase, initializeDatabase } from './database.mjs';
import { createServer } from './app.mjs';
import { createUser } from './auth.mjs';

test('HU1a: autenticación HTTP, cookies, rutas protegidas y cierre de sesión', async t => {
  const database = await createDatabase({ connectionString: '', dataDir: 'memory://', production: false });
  await initializeDatabase(database);
  const input = { correo: 'login@equipo.example', nombre: 'Usuario Login', clave: 'Clave de prueba segura 2026' };
  const user = await createUser(database, input);
  const server = createServer({ database, requireAuth: true, logger: {}, secureCookies: true });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(r => server.close(r)); await database.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  let cookie;
  await t.test('health y archivos públicos accesibles; API y página principal protegidas', async () => {
    assert.equal((await fetch(base + '/api/health')).status, 200);
    assert.equal((await fetch(base + '/login.html')).status, 200);
    assert.equal((await fetch(base + '/api/maquinaria')).status, 401);
    assert.equal((await fetch(base + '/app.js')).status, 401);
    for (const path of ['/', '/index.html']) {
      const result = await fetch(base + path, { redirect: 'manual' });
      assert.equal(result.status, 302); assert.equal(result.headers.get('location'), '/login.html');
    }
  });
  await t.test('errores de credenciales indistinguibles para cuenta inexistente e inactiva', async () => {
    const errors = [];
    for (const body of [{ ...input, clave: 'Errónea' }, { ...input, correo: 'nadie@equipo.example' }]) {
      const result = await post('/api/auth/login', body); assert.equal(result.status, 401); errors.push(await result.json());
    }
    await database.query('UPDATE usuario SET activo=FALSE WHERE id=$1', [user.id]);
    const inactive = await post('/api/auth/login', input); assert.equal(inactive.status, 401); errors.push(await inactive.json());
    assert.deepEqual(errors[0], errors[1]); assert.deepEqual(errors[0], errors[2]);
    await database.query('UPDATE usuario SET activo=TRUE WHERE id=$1', [user.id]);
    const missing = await post('/api/auth/login', { correo: input.correo });
    assert.equal(missing.status, 400); assert.ok((await missing.json()).error.fields.clave);
  });
  await t.test('login entrega cookie segura y solo guarda su hash; no se cachean datos privados', async () => {
    const result = await post('/api/auth/login', input); assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), user);
    const header = result.headers.get('set-cookie');
    for (const attribute of ['HttpOnly', 'SameSite=Strict', 'Max-Age=28800', 'Secure']) assert.ok(header.includes(attribute));
    cookie = header.split(';')[0];
    const session = (await database.query('SELECT token_hash FROM sesion')).rows[0];
    assert.ok(!cookie.includes(session.token_hash)); assert.match(session.token_hash, /^[a-f0-9]{64}$/);
    assert.equal((await fetch(base + '/api/maquinaria', { headers: { Cookie: cookie } })).status, 200);
    const home = await fetch(base + '/', { headers: { Cookie: cookie } });
    assert.equal(home.status, 200); assert.equal(home.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(base + '/api/auth/sesion', { headers: { Cookie: cookie } })).status, 200);
  });
  await t.test('no acepta mutaciones desde otro origen', async () => {
    const result = await post('/api/auth/logout', {}, { Cookie: cookie, Origin: 'https://otro.example' });
    assert.equal(result.status, 403);
    assert.equal((await fetch(base + '/api/auth/sesion', { headers: { Cookie: cookie } })).status, 200);
  });
  await t.test('logout invalida la cookie anterior y una sesión vencida no da acceso', async () => {
    const result = await post('/api/auth/logout', {}, { Cookie: cookie });
    assert.equal(result.status, 200); assert.match(result.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await fetch(base + '/api/auth/sesion', { headers: { Cookie: cookie } })).status, 401);
    const again = await post('/api/auth/login', input); cookie = again.headers.get('set-cookie').split(';')[0];
    await database.exec("UPDATE sesion SET expira_en=CURRENT_TIMESTAMP - INTERVAL '1 second'");
    assert.equal((await fetch(base + '/api/maquinaria', { headers: { Cookie: cookie } })).status, 401);
  });
});
