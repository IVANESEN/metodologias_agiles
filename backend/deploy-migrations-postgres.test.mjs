import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { assertPostgresReady, migratePostgresDatabase } from './postgres-preparation.mjs';

const DBTEST_NAME = 'constructora_migration_test';
const DBTEST_SCHEMA = 'constructora_private';
const DBTEST_URL = process.env.MIGRATION_TEST_DATABASE_URL;
const DBTEST_NEW_TABLES = ['recepcion_correccion', 'despacho_notificacion', 'despacho_intento'];
const DBTEST_HISTORY_TABLES = ['maquinaria', 'usuario', 'sesion', 'token_recuperacion', 'contrato',
  'contrato_maquinaria', 'pago', 'recepcion_maquinaria', 'configuracion', 'pedido', 'pedido_item',
  'pedido_evento', 'auditoria', 'entrega_programada'];

// No fallback to DATABASE_URL or .env. Only this dedicated, local test database
// may be reset. Parse into explicit pg options to exclude URI query overrides.
function dbtestConfig(value) {
  const fail = () => { throw new Error('Configura únicamente la base PostgreSQL local aislada de migraciones.'); };
  let uri;
  try { uri = new URL(value); } catch { fail(); }
  if (!['postgres:', 'postgresql:'].includes(uri.protocol) ||
      !['localhost', '127.0.0.1'].includes(uri.hostname) || uri.pathname !== `/${DBTEST_NAME}` ||
      !uri.username || !uri.password || uri.search || uri.hash ||
      (uri.port && (!Number.isInteger(Number(uri.port)) || Number(uri.port) < 1 || Number(uri.port) > 65_535))) fail();
  let user, password;
  try { user = decodeURIComponent(uri.username); password = decodeURIComponent(uri.password); } catch { fail(); }
  return { host: uri.hostname, port: Number(uri.port || 5432), database: DBTEST_NAME,
    user, password, ssl: false, max: 4, connectionTimeoutMillis: 5_000,
    application_name: DBTEST_NAME };
}

// The fixture uses real PostgreSQL over local plaintext transport. TLS metadata
// below is deliberately simulated to exercise the migration's SQL/transactions,
// not evidence of Supabase TLS, certificate, project or Data API configuration.
async function dbtestQuery(connection, sql, params = []) {
  try { return await connection.query(sql, params); }
  catch { throw new Error('Falló una operación del PostgreSQL aislado de pruebas.'); }
}

function dbtestAdapter(client, { failAfterDdl = false, stats = { ddl: 0, injected: false },
  beforeLock, lockStarted, lockAcquired } = {}) {
  const wrap = () => ({
    schema: DBTEST_SCHEMA,
    requiresDataApiReview: false,
    async query(sql, params) {
      const advisory = /pg_advisory_xact_lock\s*\(/i.test(sql);
      if (advisory) await beforeLock?.();
      const pending = dbtestQuery(client, sql, params);
      if (advisory) lockStarted?.();
      const result = await pending;
      if (advisory) await lockAcquired?.();
      return result;
    },
    async exec(sql) {
      const result = await dbtestQuery(client, sql);
      if (/\b(?:CREATE|ALTER|DROP|REVOKE|GRANT)\s/i.test(sql)) stats.ddl += 1;
      if (failAfterDdl && /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+recepcion_correccion\b/i.test(sql)) {
        stats.injected = true;
        throw new Error('Fallo controlado de prueba después del DDL y antes del commit.');
      }
      return result;
    },
  });
  return {
    ...wrap(),
    async verifyConnection() {
      await dbtestQuery(client, 'SELECT 1');
      return { provider: 'postgresql', databaseSchema: DBTEST_SCHEMA,
        tls: { encrypted: true, authorized: true, protocol: 'TLSv1.3' } };
    },
    async transaction(callback) {
      await dbtestQuery(client, 'BEGIN ISOLATION LEVEL READ COMMITTED');
      try {
        const result = await callback(wrap());
        await dbtestQuery(client, 'COMMIT');
        return result;
      } catch (error) {
        await dbtestQuery(client, 'ROLLBACK');
        throw error;
      }
    },
  };
}

async function dbtestConfirmTarget(client) {
  const { rows } = await dbtestQuery(client, 'SELECT current_database() AS name');
  assert.equal(rows[0].name, DBTEST_NAME, 'El fixture solo puede modificar su base de prueba dedicada.');
}

async function dbtestWait(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('No se coordinó la concurrencia del fixture local.')), 5_000);
    })]);
  } finally { clearTimeout(timer); }
}

async function dbtestReset(client, previousSql) {
  await dbtestConfirmTarget(client);
  await dbtestQuery(client, 'DROP SCHEMA IF EXISTS constructora_private CASCADE');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const { rows } = await dbtestQuery(client, 'SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
    if (!rows.length) await dbtestQuery(client, `CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOINHERIT`);
  }
  await dbtestQuery(client, `CREATE SCHEMA constructora_private;
    SET search_path = constructora_private, pg_catalog;
    ${previousSql}
    ALTER TABLE usuario DROP CONSTRAINT usuario_rol_check;
    ALTER TABLE usuario ADD CONSTRAINT usuario_rol_check CHECK (rol IN ('residente', 'gerente'));
    INSERT INTO maquinaria (id,nombre,tipo,descripcion,tarifa_diaria,disponible)
      VALUES (101,'Máquina histórica','Excavadora','Catálogo propio del fixture',100,true);
    INSERT INTO usuario (id,correo,nombre,clave_hash,rol)
      VALUES ('00000000-0000-4000-8000-000000000001','historia@example.test','Ana Pérez','hash-local','gerente');
    INSERT INTO sesion (id,usuario_id,token_hash,expira_en)
      VALUES ('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','sesion-local','2030-01-01');
    INSERT INTO token_recuperacion (id,usuario_id,token_hash,expira_en)
      VALUES ('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001','token-local','2030-01-01');
    INSERT INTO contrato (id,maquinaria_id,maquinaria_nombre,cliente,fecha_inicio,fecha_fin,dias,tarifa_diaria,total)
      VALUES ('00000000-0000-4000-8000-000000000002',101,'Máquina histórica','José Muñoz','2026-01-01','2026-01-02',2,100,200);
    INSERT INTO contrato_maquinaria (contrato_id,maquinaria_id,maquinaria_nombre,tarifa_diaria)
      VALUES ('00000000-0000-4000-8000-000000000002',101,'Máquina histórica',100);
    INSERT INTO pago (id,contrato_id,monto)
      VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002',75.25);
    INSERT INTO recepcion_maquinaria (id,contrato_id,maquinaria_id,horometro,fotos)
      VALUES ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000002',101,321,'["evidencia-historica"]');
    INSERT INTO pedido (id,numero,cliente_id,tipo,estado,ciudad,direccion,metodo_pago,subtotal,total,tasas)
      VALUES ('00000000-0000-4000-8000-000000000007',1,'00000000-0000-4000-8000-000000000001',
        'RENTA','COMPLETADO','Santa Tecla','Dirección histórica','EFECTIVO',200,200,'{}');
    INSERT INTO entrega_programada (contrato_id,fecha_entrega,hora_desde,hora_hasta,transportista)
      VALUES ('00000000-0000-4000-8000-000000000002','2026-01-01','08:00','10:00','Transporte histórico');
    REVOKE ALL ON SCHEMA constructora_private FROM PUBLIC, anon, authenticated, service_role;
    REVOKE ALL ON ALL TABLES IN SCHEMA constructora_private FROM PUBLIC, anon, authenticated, service_role;`);
  for (const name of DBTEST_HISTORY_TABLES) {
    await dbtestQuery(client, `ALTER TABLE constructora_private.${name} ENABLE ROW LEVEL SECURITY`);
  }
  const { rows } = await dbtestQuery(client,
    "SELECT tablename FROM pg_tables WHERE schemaname = 'constructora_private'");
  assert.equal(rows.length, 14);
}

async function dbtestSnapshot(client) {
  const result = {};
  for (const name of DBTEST_HISTORY_TABLES) {
    result[name] = (await dbtestQuery(client, `SELECT * FROM constructora_private.${name} ORDER BY 1`)).rows;
  }
  return result;
}

test('Migración de despliegue en PostgreSQL real aislado', {
  skip: !DBTEST_URL && 'No se configuró MIGRATION_TEST_DATABASE_URL; solo CI crea el PostgreSQL aislado.',
  timeout: 90_000,
}, async (t) => {
  const config = dbtestConfig(DBTEST_URL);
  const pool = new pg.Pool(config);
  let idleFailure = false;
  pool.on('error', () => { idleFailure = true; });
  const clients = [];
  t.after(async () => {
    try {
      if (clients.length) {
        await dbtestConfirmTarget(clients[0]);
        await dbtestQuery(clients[0], 'DROP SCHEMA IF EXISTS constructora_private CASCADE');
      }
    } finally {
      for (const client of clients) client.release();
      await pool.end();
    }
  });
  try {
    clients.push(await pool.connect());
    clients.push(await pool.connect());
  } catch { throw new Error('No se pudo abrir el PostgreSQL local aislado para esta prueba.'); }
  const [first, second] = clients;
  await Promise.all(clients.map(dbtestConfirmTarget));
  assert.notEqual(first.processID, second.processID, 'La concurrencia requiere dos conexiones PostgreSQL reales.');
  const schemaSql = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8');
  const boundary = schemaSql.indexOf('-- H01:');
  assert.ok(boundary > 0, 'El fixture necesita identificar el esquema anterior de 14 tablas.');
  const previousSql = schemaSql.slice(0, boundary).replace(", 'FINALIZADO', 'DEVUELTO'", '');

  await t.test('un fallo tras DDL revierte tablas y restricciones sin cambiar la historia', async () => {
    await dbtestReset(first, previousSql);
    const original = await dbtestSnapshot(first);
    const beforeChecks = (await dbtestQuery(first, `SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE connamespace='constructora_private'::regnamespace ORDER BY conname`)).rows;
    const stats = { ddl: 0, injected: false };
    await assert.rejects(migratePostgresDatabase(dbtestAdapter(first, { failAfterDdl: true, stats })));
    assert.equal(stats.injected, true, 'La prueba debe fallar después de ejecutar el SQL real.');
    assert.deepEqual(await dbtestSnapshot(second), original);
    for (const name of DBTEST_NEW_TABLES) {
      const { rows } = await dbtestQuery(second, 'SELECT to_regclass($1) AS name', [`${DBTEST_SCHEMA}.${name}`]);
      assert.equal(rows[0].name, null);
    }
    const afterChecks = (await dbtestQuery(second, `SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint WHERE connamespace='constructora_private'::regnamespace ORDER BY conname`)).rows;
    assert.deepEqual(afterChecks, beforeChecks);
  });

  await t.test('dos conexiones migran una vez y el reinicio omite DDL preservando datos y RLS', async () => {
    // Retry the same database left intact by the rolled-back attempt above.
    const original = await dbtestSnapshot(first);
    const firstLocked = Promise.withResolvers();
    const secondQueued = Promise.withResolvers();
    // Hold the first transaction until the other connection has requested the
    // same advisory lock. No sleeps or auxiliary objects in the private schema.
    const outcomes = await Promise.allSettled([
      migratePostgresDatabase(dbtestAdapter(first, { lockAcquired: async () => {
        firstLocked.resolve();
        await dbtestWait(secondQueued.promise);
      } })),
      migratePostgresDatabase(dbtestAdapter(second, {
        beforeLock: () => dbtestWait(firstLocked.promise),
        lockStarted: () => secondQueued.resolve(),
      })),
    ]);
    for (const outcome of outcomes) assert.equal(outcome.status, 'fulfilled',
      'Ambas migraciones concurrentes deben terminar sin errores.');
    const results = outcomes.map(outcome => outcome.value);
    assert.deepEqual(results.map(result => result.applied).sort(), [false, true]);
    for (const result of results) assert.equal(result.migration, '20261101_reajustes');
    assert.deepEqual(results.find(result => result.applied).createdTables, DBTEST_NEW_TABLES);
    assert.deepEqual(results.find(result => !result.applied).createdTables, []);
    assert.deepEqual(await dbtestSnapshot(first), original);
    const ready = await assertPostgresReady(dbtestAdapter(first));
    assert.equal(ready.appTables.length, 17);
    assert.ok(ready.appTables.every(table => table.rlsEnabled && !table.apiPrivileges.length));
    const stats = { ddl: 0, injected: false };
    const repeated = await migratePostgresDatabase(dbtestAdapter(first, { stats }));
    assert.deepEqual(repeated, { migration: '20261101_reajustes', applied: false, createdTables: [] });
    assert.equal(stats.ddl, 0, 'Un esquema listo no debe volver a adquirir bloqueos DDL.');
    assert.deepEqual(await dbtestSnapshot(first), original);
  });
  assert.equal(idleFailure, false, 'El PostgreSQL de prueba no debe perder conexiones inactivas.');
});
