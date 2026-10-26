import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { initializePostgresDatabase } from './postgres-preparation.mjs';
import { prepararPortal } from './preparar-portal.mjs';

// PostgreSQL simulado con PGlite: misma forma que el adaptador real, TLS simulado.
function adapter(embedded) {
  const wrap = (connection) => ({ query: (sql, params) => connection.query(sql, params), exec: (sql) => connection.exec(sql) });
  return { ...wrap(embedded), provider: 'postgresql', schema: 'constructora_private', requiresDataApiReview: false,
    verifyConnection: async () => ({ provider: 'postgresql', tls: { encrypted: true, authorized: true, protocol: 'TLSv1.3' } }),
    transaction: (callback) => embedded.transaction((tx) => callback(wrap(tx))) };
}

test('db:portal actualiza una base de producción anterior sin perder datos', async (t) => {
  const embedded = new PGlite();
  t.after(() => embedded.close());
  const database = adapter(embedded);
  const [schemaSql, seedsSql] = await Promise.all([
    readFile(new URL('../database/schema.sql', import.meta.url), 'utf8'),
    readFile(new URL('../database/seeds.sql', import.meta.url), 'utf8'),
  ]);
  await initializePostgresDatabase(database, { schemaSql, seedsSql, dataApiReviewed: true });
  await embedded.exec("SELECT set_config('search_path', 'constructora_private, pg_catalog', false)");
  // Estado de la base antes del portal: dos roles, sin tablas nuevas ni tasas, con un contrato real.
  await embedded.exec(`
    DROP TABLE pedido_evento, pedido_item, pedido, configuracion, auditoria;
    ALTER TABLE maquinaria DROP COLUMN estado_publicacion, DROP COLUMN imagenes, DROP COLUMN proveedor_id;
    ALTER TABLE usuario DROP COLUMN empresa, DROP CONSTRAINT usuario_rol_check;
    ALTER TABLE usuario ADD CONSTRAINT usuario_rol_check CHECK (rol IN ('residente','gerente'));
    INSERT INTO contrato (id, maquinaria_id, maquinaria_nombre, cliente, fecha_inicio, fecha_fin, dias, tarifa_diaria, total)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1, 'CAT 336', 'Cliente histórico', '2026-01-10', '2026-01-12', 3, 450, 1350);`);
  await assert.rejects(embedded.query("INSERT INTO usuario (id, correo, nombre, clave_hash, rol) VALUES (gen_random_uuid(), 'x@x.example', 'X', 'h', 'admin')"));

  const logs = [];
  const result = await prepararPortal(database, { demo: true, log: (line) => logs.push(line) });
  assert.equal(result.tables, 13);
  assert.equal(result.demoLoaded, true);
  assert.equal((await embedded.query('SELECT COUNT(*)::int AS n FROM configuracion')).rows[0].n, 7);
  assert.equal((await embedded.query("SELECT rol FROM usuario WHERE correo = '2025-5714@esen.edu.sv'")).rows[0].rol, 'admin');
  assert.equal((await embedded.query("SELECT cliente FROM contrato WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'")).rows[0].cliente, 'Cliente histórico');
  assert.ok((await embedded.query("SELECT COUNT(*)::int AS n FROM pedido")).rows[0].n >= 1);

  // Repetirlo no duplica ni cambia nada.
  await embedded.query("UPDATE configuracion SET valor = 15 WHERE clave = 'iva'");
  const again = await prepararPortal(database, { demo: true, log: () => {} });
  assert.equal(again.demoLoaded, false);
  assert.equal(Number((await embedded.query("SELECT valor FROM configuracion WHERE clave = 'iva'")).rows[0].valor), 15);
  assert.ok(logs.some((line) => line.startsWith('5/5')));
});

test('db:portal no se ejecuta sin una base PostgreSQL configurada', async () => {
  await assert.rejects(prepararPortal({ provider: 'pglite' }), (error) => error.code === 'POSTGRES_REQUIRED');
});
