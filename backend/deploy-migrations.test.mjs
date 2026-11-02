import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { assertPostgresReady, inspectPostgresDatabase, migratePostgresDatabase,
  PostgresPreparationError } from './postgres-preparation.mjs';
import { migrateDatabase } from './migrate-db.mjs';

test('prestart local sin DATABASE_URL deja la preparación PGlite al servidor', async () => {
  const messages = [];
  assert.deepEqual(await migrateDatabase({ connectionString: '', production: false,
    log: message => messages.push(message) }), { applied: false, skipped: 'pglite' });
  assert.equal(messages.length, 1);
});

test('prestart de producción sin DATABASE_URL rechaza el arranque', async () => {
  await assert.rejects(migrateDatabase({ connectionString: '', production: true, log: () => {} }),
    { code: 'DATABASE_URL_REQUIRED' });
});

const [schemaSql, seedsSql] = await Promise.all([
  readFile(new URL('../database/schema.sql', import.meta.url), 'utf8'),
  readFile(new URL('../database/seeds.sql', import.meta.url), 'utf8'),
]);
const expansionStart = schemaSql.indexOf('-- H01:');
assert.notEqual(expansionStart, -1, 'La fixture debe excluir las tres tablas de la ampliación.');
const previousSql = schemaSql.slice(0, expansionStart).replace(", 'FINALIZADO', 'DEVUELTO'", '');
const oldRoles = ['residente', 'gerente'];
const allRoles = [...oldRoles, 'admin', 'empleado', 'proveedor', 'cliente'];
const oldStates = ['PENDIENTE', 'APROBADO', 'EN_ENTREGA', 'COMPLETADO', 'CANCELADO', 'RECHAZADO'];
const allStates = [...oldStates, 'FINALIZADO', 'DEVUELTO'];
const newTables = ['recepcion_correccion', 'despacho_notificacion', 'despacho_intento'];
const oldTables = ['maquinaria', 'usuario', 'sesion', 'token_recuperacion', 'contrato',
  'contrato_maquinaria', 'pago', 'recepcion_maquinaria', 'configuracion', 'pedido',
  'pedido_item', 'pedido_evento', 'auditoria', 'entrega_programada'];
const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

// SQL is executed by an isolated local PostgreSQL engine. Only the connection's
// TLS evidence is simulated; this file never connects to Supabase or sends mail.
function adapter(embedded, { operations = [], failAfterExpansion = false,
  tls = { encrypted: true, authorized: true, protocol: 'TLSv1.3' } } = {}) {
  let failureArmed = failAfterExpansion;
  const wrap = (connection) => {
    const execute = async (kind, sql, params) => {
      operations.push({ kind, sql });
      const result = await connection[kind](sql, params);
      if (failureArmed && /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(?:"?constructora_private"?\.)?"?recepcion_correccion\b/i.test(sql)) {
        failureArmed = false;
        throw new Error('INJECTED_DEPLOY_MIGRATION_FAILURE');
      }
      return result;
    };
    return { provider: 'postgresql', schema: 'constructora_private', requiresDataApiReview: false,
      query: (sql, params) => execute('query', sql, params),
      exec: (sql) => execute('exec', sql) };
  };
  return { ...wrap(embedded),
    verifyConnection: async () => ({ provider: 'postgresql', targetProjectVerified: true, tls }),
    transaction: (callback) => embedded.transaction((tx) => callback(wrap(tx))) };
}

async function reset(embedded) {
  await embedded.exec('DROP SCHEMA IF EXISTS constructora_private CASCADE;');
  await embedded.query("SELECT set_config('pgrst.db_schemas', '', false)");
}

async function previousDatabase(embedded, { roles = oldRoles, states = oldStates } = {}) {
  await reset(embedded);
  await embedded.exec(`CREATE SCHEMA constructora_private;
    SET search_path = constructora_private, pg_catalog;
    ${previousSql}
    ${seedsSql}
    ALTER TABLE usuario DROP CONSTRAINT usuario_rol_check;
    ALTER TABLE usuario ADD CONSTRAINT usuario_rol_check CHECK (rol IN (${roles.map((role) => `'${role}'`).join(',')}));
    ALTER TABLE pedido DROP CONSTRAINT pedido_estado_check;
    ALTER TABLE pedido ADD CONSTRAINT pedido_estado_check CHECK (estado IN (${states.map((state) => `'${state}'`).join(',')}));`);
  for (const [index, role] of roles.entries()) {
    await embedded.query(`INSERT INTO constructora_private.usuario (id,correo,nombre,clave_hash,rol,empresa)
      VALUES ($1,$2,$3,'hash-historico-de-fixture',$4,'Empresa histórica')`,
    [uuid(100 + index), `cuenta-${index}@example.test`, `Persona histórica ${index}`, role]);
  }
  for (const [index, state] of states.entries()) {
    await embedded.query(`INSERT INTO constructora_private.pedido
      (id,numero,cliente_id,tipo,estado,ciudad,direccion,metodo_pago,subtotal,iva,total,tasas)
      VALUES ($1,$2,$3,'RENTA',$4,'San Salvador','Dirección histórica de obra','EFECTIVO',100,13,113,'{}')`,
    [uuid(300 + index), index + 1, uuid(100), state]);
  }
  await embedded.query(`INSERT INTO constructora_private.sesion (id,usuario_id,token_hash,expira_en)
    VALUES ($1,$2,'digest-historico-sesion','2030-01-01')`, [uuid(201), uuid(100)]);
  await embedded.query(`INSERT INTO constructora_private.token_recuperacion (id,usuario_id,token_hash,expira_en)
    VALUES ($1,$2,'digest-historico-recuperacion','2030-01-01')`, [uuid(202), uuid(100)]);
  await embedded.query(`INSERT INTO constructora_private.contrato
    (id,maquinaria_id,maquinaria_nombre,cliente,fecha_inicio,fecha_fin,dias,tarifa_diaria,total)
    VALUES ($1,1,'Máquina histórica','Cliente histórico','2026-01-01','2026-01-02',2,100,200)`, [uuid(10)]);
  await embedded.query(`INSERT INTO constructora_private.contrato_maquinaria
    (contrato_id,maquinaria_id,maquinaria_nombre,tarifa_diaria) VALUES ($1,1,'Máquina histórica',100)`, [uuid(10)]);
  await embedded.query(`INSERT INTO constructora_private.pago (id,contrato_id,monto)
    VALUES ($1,$2,75.25)`, [uuid(11), uuid(10)]);
  await embedded.query(`INSERT INTO constructora_private.recepcion_maquinaria
    (id,contrato_id,maquinaria_id,horometro,fotos)
    VALUES ($1,$2,1,321,'["evidencia-original","segunda-fotografía"]')`, [uuid(12), uuid(10)]);
  await embedded.query(`INSERT INTO constructora_private.entrega_programada
    (contrato_id,fecha_entrega,hora_desde,hora_hasta,transportista)
    VALUES ($1,'2026-01-01','08:00','10:00','Transportista histórico')`, [uuid(10)]);
  for (const table of oldTables) {
    await embedded.exec(`ALTER TABLE constructora_private.${table} ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON TABLE constructora_private.${table} FROM PUBLIC, anon, authenticated, service_role;`);
  }
}

async function snapshot(embedded) {
  const rows = {};
  for (const table of oldTables) {
    rows[table] = (await embedded.query(`SELECT * FROM constructora_private.${table} ORDER BY 1`)).rows;
  }
  return rows;
}

async function constraints(embedded) {
  return (await embedded.query(`SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE connamespace='constructora_private'::regnamespace AND conname IN ('usuario_rol_check','pedido_estado_check')
    ORDER BY conname`)).rows;
}

function mutations(operations) {
  return operations.filter(({ sql }) => /(?:^|;)\s*(?:CREATE|ALTER|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE)\b/i
    .test(sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\r\n]*/g, '')));
}

async function assertNoExpansion(embedded) {
  for (const table of newTables) {
    assert.equal((await embedded.query('SELECT to_regclass($1) AS relation', [`constructora_private.${table}`])).rows[0].relation, null);
  }
}

test('migración de despliegue: ampliación registrada, privada y atómica sobre SQL real aislado', async (t) => {
  const embedded = new PGlite();
  t.after(() => embedded.close());
  await embedded.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE unknown_reader;');

  await t.test('conserva todas las filas, credenciales, estados, pagos y fotografías históricas', async () => {
    await previousDatabase(embedded);
    const original = await snapshot(embedded);
    const result = await migratePostgresDatabase(adapter(embedded));
    assert.deepEqual(result, { migration: '20261101_reajustes', applied: true, createdTables: newTables });
    assert.deepEqual(await snapshot(embedded), original);
    const inventory = await assertPostgresReady(adapter(embedded));
    assert.equal(inventory.appTables.length, 17);
    for (const table of inventory.appTables.filter(({ name }) => newTables.includes(name))) {
      assert.equal(table.rlsEnabled, true);
      assert.deepEqual(table.policies, []);
      assert.deepEqual(table.apiPrivileges, []);
      assert.ok(table.grants.every(({ grantee }) => grantee === 'current_role'));
      assert.equal(table.rowCount, 0);
    }
    const checks = await constraints(embedded);
    assert.ok(checks.find(({ conname }) => conname === 'usuario_rol_check').definition.includes('admin'));
    assert.ok(checks.find(({ conname }) => conname === 'pedido_estado_check').definition.includes('DEVUELTO'));
  });

  await t.test('segunda ejecución no aplica DDL ni modifica los datos', async () => {
    const original = await snapshot(embedded);
    const originalChecks = await constraints(embedded);
    const operations = [];
    const result = await migratePostgresDatabase(adapter(embedded, { operations }));
    assert.deepEqual(result, { migration: '20261101_reajustes', applied: false, createdTables: [] });
    assert.deepEqual(mutations(operations), []);
    assert.deepEqual(await snapshot(embedded), original);
    assert.deepEqual(await constraints(embedded), originalChecks);
  });

  await t.test('seis roles y ocho estados existentes se conservan sin sustituir cuentas', async () => {
    await previousDatabase(embedded, { roles: allRoles, states: allStates });
    const original = await snapshot(embedded);
    assert.equal((await migratePostgresDatabase(adapter(embedded))).applied, true);
    assert.deepEqual(await snapshot(embedded), original);
    assert.deepEqual((await embedded.query('SELECT rol FROM constructora_private.usuario ORDER BY id')).rows.map(({ rol }) => rol), allRoles);
    await assertPostgresReady(adapter(embedded));
  });

  await t.test('un fallo después del DDL revierte también los CHECK; el reintento completa la ampliación', async () => {
    await previousDatabase(embedded);
    const original = await snapshot(embedded);
    const originalChecks = await constraints(embedded);
    const operations = [];
    await assert.rejects(migratePostgresDatabase(adapter(embedded, { operations, failAfterExpansion: true })),
      { code: 'DATABASE_MIGRATION_FAILED' });
    assert.ok(mutations(operations).some(({ sql }) => sql.includes('CREATE TABLE IF NOT EXISTS recepcion_correccion')),
      'El fallo inyectado debe ocurrir después de ejecutar el DDL de la ampliación.');
    assert.deepEqual(await snapshot(embedded), original);
    assert.deepEqual(await constraints(embedded), originalChecks);
    await assertNoExpansion(embedded);
    assert.equal((await migratePostgresDatabase(adapter(embedded))).applied, true);
    assert.deepEqual(await snapshot(embedded), original);
    await assertPostgresReady(adapter(embedded));
  });

  await t.test('rechaza una base vacía; esta ruta no inicializa proyectos ni carga demostraciones', async () => {
    await reset(embedded);
    const operations = [];
    await assert.rejects(migratePostgresDatabase(adapter(embedded, { operations })), PostgresPreparationError);
    assert.deepEqual(mutations(operations), []);
    assert.equal((await inspectPostgresDatabase(adapter(embedded))).targetSchema.exists, false);
  });

  for (const [name, sql] of [
    ['RLS desactivado', 'ALTER TABLE constructora_private.usuario DISABLE ROW LEVEL SECURITY'],
    ['permiso de un rol desconocido', 'GRANT SELECT ON constructora_private.usuario TO unknown_reader'],
    ['permiso de Data API', 'GRANT SELECT ON constructora_private.pedido TO authenticated'],
    ['tipo de columna incompatible', 'ALTER TABLE constructora_private.maquinaria ALTER COLUMN nombre TYPE TEXT'],
    ['rol ajeno a las dos versiones admitidas', `ALTER TABLE constructora_private.usuario DROP CONSTRAINT usuario_rol_check;
      ALTER TABLE constructora_private.usuario ADD CONSTRAINT usuario_rol_check
        CHECK (rol IN ('residente','gerente','admin','empleado','proveedor','cliente','auditor'))`],
    ['estado ajeno a las dos versiones admitidas', `ALTER TABLE constructora_private.pedido DROP CONSTRAINT pedido_estado_check;
      ALTER TABLE constructora_private.pedido ADD CONSTRAINT pedido_estado_check
        CHECK (estado IN ('PENDIENTE','APROBADO','EN_ENTREGA','COMPLETADO','CANCELADO','RECHAZADO','ARCHIVADO'))`],
  ]) {
    await t.test(`rechaza ${name} sin alterar datos ni reparar permisos automáticamente`, async () => {
      await previousDatabase(embedded, { roles: allRoles });
      await embedded.exec(sql);
      const original = await snapshot(embedded);
      const originalChecks = await constraints(embedded);
      const operations = [];
      await assert.rejects(migratePostgresDatabase(adapter(embedded, { operations })), PostgresPreparationError);
      assert.deepEqual(mutations(operations), []);
      assert.deepEqual(await snapshot(embedded), original);
      assert.deepEqual(await constraints(embedded), originalChecks);
      await assertNoExpansion(embedded);
    });
  }

  await t.test('rechaza una ampliación parcial incompatible sin recrear la tabla existente', async () => {
    await previousDatabase(embedded, { roles: allRoles });
    await embedded.exec('CREATE TABLE constructora_private.recepcion_correccion (id TEXT PRIMARY KEY)');
    const original = await snapshot(embedded);
    const operations = [];
    await assert.rejects(migratePostgresDatabase(adapter(embedded, { operations })), PostgresPreparationError);
    assert.deepEqual(mutations(operations), []);
    assert.deepEqual(await snapshot(embedded), original);
    assert.equal((await embedded.query(`SELECT format_type(atttypid,atttypmod) AS type FROM pg_attribute
      WHERE attrelid='constructora_private.recepcion_correccion'::regclass AND attname='id'`)).rows[0].type, 'text');
  });

  await t.test('rechaza otro esquema sin modificar la base privada', async () => {
    await previousDatabase(embedded, { roles: allRoles });
    const original = await snapshot(embedded);
    const operations = [];
    await assert.rejects(migratePostgresDatabase({ ...adapter(embedded, { operations }), schema: 'public' }), PostgresPreparationError);
    assert.deepEqual(mutations(operations), []);
    assert.deepEqual(await snapshot(embedded), original);
    await assertNoExpansion(embedded);
  });

  await t.test('rechaza TLS inválido antes de ejecutar consultas o migraciones', async () => {
    await previousDatabase(embedded);
    const original = await snapshot(embedded);
    for (const tls of [{ encrypted: true, authorized: false }, { encrypted: false, authorized: false }]) {
      const operations = [];
      await assert.rejects(migratePostgresDatabase(adapter(embedded, { operations, tls })),
        { code: 'DATABASE_TLS_NOT_VERIFIED' });
      assert.deepEqual(operations, []);
    }
    assert.deepEqual(await snapshot(embedded), original);
    await assertNoExpansion(embedded);
  });
});
