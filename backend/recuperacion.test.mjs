import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDatabase, initializeDatabase } from './database.mjs';
import { createServer } from './app.mjs';
import { createUser } from './auth.mjs';
import { createMemoryMailer, createMailer } from './mailer.mjs';

test('HU1b: correo simulado nunca divulga enlaces ni afirma entrega en producción', async () => {
  const messages = [];
  const mailer = createMailer({ production: true, logger: { info: value => messages.push(value) } });
  assert.equal(mailer.available, false);
  await assert.rejects(mailer.send({ text: 'secreto de prueba' }));
  assert.deepEqual(messages, []);
});

test('HU1b: recuperación HTTP, consumo atómico y revocación de sesiones', async t => {
  const database = await createDatabase({ connectionString: '', dataDir: 'memory://', production: false });
  await initializeDatabase(database);
  const input = { correo: 'recuperar@equipo.example', nombre: 'Usuario Recuperación', clave: 'Clave anterior de prueba 2026' };
  const user = await createUser(database, input);
  const mailer = createMemoryMailer();
  let activeDatabase = database;
  const proxy = { ...database, transaction: callback => activeDatabase.transaction(callback) };
  const server = createServer({ database: proxy, requireAuth: true, mailer, appUrl: 'https://equipo.example', secureCookies: true, logger: {} });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await database.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const recovery = correo => post('/api/auth/recuperar', { correo });
  const reset = (token, clave = 'Clave nueva de prueba 2026') => post('/api/auth/restablecer', { token, clave });
  const latestToken = () => new URL(mailer.outbox.at(-1).text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
  let token;
  let oldCookie;
  await t.test('respuesta genérica idéntica para usuario válido, inexistente e inactivo', async () => {
    const absent = await recovery('ausente@equipo.example'); assert.equal(absent.status, 202);
    const expected = await absent.json(); assert.equal(mailer.outbox.length, 0);
    await database.query('UPDATE usuario SET activo=FALSE WHERE id=$1', [user.id]);
    const inactive = await recovery(input.correo); assert.equal(inactive.status, 202); assert.deepEqual(await inactive.json(), expected);
    assert.equal(mailer.outbox.length, 0);
    await database.query('UPDATE usuario SET activo=TRUE WHERE id=$1', [user.id]);
    const active = await recovery(input.correo); assert.equal(active.status, 202); assert.deepEqual(await active.json(), expected);
    assert.equal(mailer.outbox.length, 1); token = latestToken();
    assert.ok(mailer.outbox[0].text.includes('https://equipo.example/restablecer.html?token='));
    assert.equal(mailer.outbox[0].to, input.correo);
    const saved = (await database.query('SELECT token_hash,extract(epoch from expira_en-creado_en)::integer AS ttl FROM token_recuperacion')).rows[0];
    assert.notEqual(saved.token_hash, token); assert.match(saved.token_hash, /^[a-f0-9]{64}$/); assert.equal(saved.ttl, 1800);
    assert.equal((await recovery('malformado')).status, 400);
  });
  await t.test('páginas de recuperación son públicas y la clave inválida no consume el token', async () => {
    for (const page of ['/recuperar.html', '/restablecer.html', '/auth-form.js']) assert.equal((await fetch(base + page)).status, 200);
    const result = await reset(token, 'corta'); assert.equal(result.status, 400); assert.ok((await result.json()).error.fields.clave);
    assert.equal((await database.query('SELECT usado_en FROM token_recuperacion')).rows[0].usado_en, null);
    const login = await post('/api/auth/login', input); oldCookie = login.headers.get('set-cookie').split(';')[0];
  });
  await t.test('nuevo enlace invalida el anterior y un token vencido se rechaza', async () => {
    const previous = token; await recovery(input.correo); token = latestToken(); assert.notEqual(token, previous);
    assert.equal((await reset(previous)).status, 400);
    await database.exec("UPDATE token_recuperacion SET expira_en=CURRENT_TIMESTAMP - INTERVAL '1 second'");
    const expired = await reset(token); assert.equal(expired.status, 400); assert.equal((await expired.json()).error.code, 'INVALID_TOKEN');
    await recovery(input.correo); token = latestToken();
  });
  await t.test('dos restablecimientos simultáneos solo permiten un éxito; se revocan sesiones', async () => {
    const results = await Promise.all([reset(token), reset(token)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
    assert.equal((await reset(token)).status, 400);
    assert.equal((await post('/api/auth/login', input)).status, 401);
    assert.equal((await post('/api/auth/login', { ...input, clave: 'Clave nueva de prueba 2026' })).status, 200);
    assert.equal((await fetch(base + '/api/auth/sesion', { headers: { Cookie: oldCookie } })).status, 401);
  });
  await t.test('fallar la escritura de contraseña revierte consumo del token y revocación', async () => {
    await recovery(input.correo); const retryToken = latestToken();
    activeDatabase = { ...database, transaction: callback => database.transaction(tx => callback({ ...tx,
      query: (sql, params) => { if (sql.startsWith('UPDATE usuario SET clave_hash')) throw new Error('fallo simulado'); return tx.query(sql, params); },
    })) };
    assert.equal((await reset(retryToken)).status, 500);
    activeDatabase = database;
    assert.equal((await reset(retryToken)).status, 200);
  });
  await t.test('producción sin proveedor responde igual para cualquier correo y no crea tokens', async () => {
    const production = createServer({ database, mailer: createMailer({ production: true }), requireAuth: true, logger: {}, secureCookies: true });
    production.listen(0, '127.0.0.1'); await once(production, 'listening');
    try {
      const answers = [];
      for (const correo of [input.correo, 'ausente@equipo.example']) {
        const result = await fetch(`http://127.0.0.1:${production.address().port}/api/auth/recuperar`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo }),
        });
        assert.equal(result.status, 503); answers.push(await result.json());
      }
      assert.deepEqual(answers[0], answers[1]);
    } finally { await new Promise(resolve => production.close(resolve)); }
  });
});
