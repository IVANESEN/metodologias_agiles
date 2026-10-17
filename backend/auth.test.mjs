import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, initializeDatabase } from './database.mjs';
import { hashPassword, verifyPassword, createUser } from './auth.mjs';

test('HU1a: scrypt usa sal aleatoria, verifica claves y rechaza hashes malformados', async () => {
  const clave = 'Clave de prueba segura 2026';
  const [one, two] = await Promise.all([hashPassword(clave), hashPassword(clave)]);
  assert.notEqual(one, two);
  assert.ok(!one.includes(clave));
  assert.equal(await verifyPassword(clave, one), true);
  assert.equal(await verifyPassword('Incorrecta', one), false);
  for (const malformed of ['', 'scrypt$1$8$2$x$x', null]) assert.equal(await verifyPassword(clave, malformed), false);
  await assert.rejects(hashPassword('corta'), { code: 'VALIDATION_ERROR' });
});
test('HU1a: usuarios normalizan correo y rechazan duplicados sin guardar clave en claro', async t => {
  const database = await createDatabase({ connectionString: '', dataDir: 'memory://', production: false });
  t.after(() => database.close()); await initializeDatabase(database);
  const input = { correo: 'TEST@EQUIPO.EXAMPLE', nombre: 'Usuario de pruebas', clave: 'Clave de prueba segura 2026' };
  const user = await createUser(database, input);
  assert.equal(user.correo, 'test@equipo.example');
  assert.equal(user.rol, 'residente'); assert.equal(user.clave_hash, undefined);
  const record = (await database.query('SELECT clave_hash FROM usuario WHERE id=$1', [user.id])).rows[0];
  assert.notEqual(record.clave_hash, input.clave);
  await assert.rejects(createUser(database, input), { code: '23505' });
});
