import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { assertPostgresReady, initializePostgresDatabase } from './postgres-preparation.mjs';

const schemaSql = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8');
const seedsSql = await readFile(new URL('../database/seeds.sql', import.meta.url), 'utf8');
// Esquema anterior a los reajustes: 14 tablas y seis estados de pedido.
const previousSql = schemaSql.slice(0, schemaSql.indexOf('-- H01:'))
  .replace(", 'FINALIZADO', 'DEVUELTO'", '');

function adapter(embedded, { failAfterExpansion = false } = {}) {
  const wrap = (connection) => ({ schema: 'constructora_private', requiresDataApiReview: false,
    query: (sql, params) => connection.query(sql, params),
    exec: (sql) => {
      if (failAfterExpansion && sql.includes('ALTER DEFAULT PRIVILEGES')) throw new Error('INJECTED_MIGRATION_FAILURE');
      return connection.exec(sql);
    } });
  return { ...wrap(embedded),
    verifyConnection: async () => ({ tls: { encrypted: true, authorized: true, protocol: 'TLSv1.3' } }),
    transaction: (callback) => embedded.transaction((tx) => callback(wrap(tx))) };
}

async function previousDatabase(embedded) {
  await embedded.exec(`CREATE SCHEMA constructora_private;
    SET search_path = constructora_private, pg_catalog;
    ${previousSql}
    ${seedsSql}
    ALTER TABLE usuario DROP CONSTRAINT usuario_rol_check;
    ALTER TABLE usuario ADD CONSTRAINT usuario_rol_check CHECK (rol IN ('residente', 'gerente'));
    INSERT INTO usuario (id,correo,nombre,clave_hash,rol)
      VALUES ('00000000-0000-4000-8000-000000000001','prueba@example.test','Ana Pérez','hash-local','gerente');
    INSERT INTO contrato (id,maquinaria_id,maquinaria_nombre,cliente,fecha_inicio,fecha_fin,dias,tarifa_diaria,total)
      VALUES ('00000000-0000-4000-8000-000000000002',1,'Máquina histórica','José Muñoz','2026-01-01','2026-01-02',2,100,200);
    INSERT INTO contrato_maquinaria (contrato_id,maquinaria_id,maquinaria_nombre,tarifa_diaria)
      VALUES ('00000000-0000-4000-8000-000000000002',1,'Máquina histórica',100);
    INSERT INTO pago (id,contrato_id,monto)
      VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002',75.25);
    INSERT INTO recepcion_maquinaria (id,contrato_id,maquinaria_id,horometro,fotos)
      VALUES ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002',1,321,'["evidencia-historica"]');`);
  const { rows } = await embedded.query("SELECT tablename FROM pg_tables WHERE schemaname = 'constructora_private'");
  for (const { tablename } of rows) await embedded.exec(`ALTER TABLE constructora_private.${tablename} ENABLE ROW LEVEL SECURITY`);
}

async function snapshot(embedded) {
  const result = {};
  for (const name of ['maquinaria', 'usuario', 'contrato', 'contrato_maquinaria', 'pago', 'recepcion_maquinaria']) {
    // Comparar todas las columnas históricas, sin confundir columnas nuevas con pérdida de datos.
    const query = name === 'pago' ? 'SELECT id,contrato_id,monto,creado_en FROM constructora_private.pago ORDER BY id'
      : name === 'contrato' ? "SELECT to_jsonb(c)-'pedido_id' AS registro FROM constructora_private.contrato c ORDER BY id"
        : `SELECT * FROM constructora_private.${name} ORDER BY 1`;
    result[name] = (await embedded.query(query)).rows;
  }
  return result;
}

test('H05: fallo de expansión revierte, reapertura conserva datos y reintento es idempotente', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'constructora-migration-'));
  let embedded = await PGlite.create(directory);
  t.after(async () => { await embedded.close(); await rm(directory, { recursive: true, force: true }); });
  await previousDatabase(embedded);
  const original = await snapshot(embedded);
  const prepare = { schemaSql, seedsSql: '', existingReviewed: true };
  await assert.rejects(assertPostgresReady(adapter(embedded)), { code: 'DATABASE_SCHEMA_NOT_READY' });
  await assert.rejects(initializePostgresDatabase(adapter(embedded, { failAfterExpansion: true }), prepare),
    /INJECTED_MIGRATION_FAILURE/);
  assert.deepEqual(await snapshot(embedded), original);
  assert.equal((await embedded.query("SELECT to_regclass('constructora_private.recepcion_correccion') AS tabla")).rows[0].tabla, null);
  const roleCheck = (await embedded.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conname='usuario_rol_check' AND connamespace='constructora_private'::regnamespace`)).rows[0].definition;
  assert.ok(!roleCheck.includes('admin'), 'El fallo debe revertir también la ampliación de roles.');
  await embedded.close();
  embedded = await PGlite.create(directory);
  assert.deepEqual(await snapshot(embedded), original);
  const updated = await initializePostgresDatabase(adapter(embedded), prepare);
  assert.deepEqual(updated.createdTables, ['recepcion_correccion', 'despacho_notificacion', 'despacho_intento']);
  assert.deepEqual(await snapshot(embedded), original);
  await assertPostgresReady(adapter(embedded));
  await embedded.close();
  embedded = await PGlite.create(directory);
  await assertPostgresReady(adapter(embedded));
  const repeated = await initializePostgresDatabase(adapter(embedded), prepare);
  assert.deepEqual(repeated.createdTables, []);
  assert.deepEqual(await snapshot(embedded), original);
});

test('H05: migración manual y preparación normal producen esquema compatible sin borrar evidencia', async (t) => {
  const embedded = new PGlite();
  t.after(() => embedded.close());
  await previousDatabase(embedded);
  const original = await snapshot(embedded);
  const migration = await readFile(new URL('../database/migrations/20261101_reajustes.sql', import.meta.url), 'utf8');
  await embedded.exec(migration);
  await assertPostgresReady(adapter(embedded));
  await initializePostgresDatabase(adapter(embedded), { schemaSql, seedsSql: '', existingReviewed: true });
  await assertPostgresReady(adapter(embedded));
  await embedded.exec(migration);
  await assertPostgresReady(adapter(embedded));
  assert.deepEqual(await snapshot(embedded), original);
});
