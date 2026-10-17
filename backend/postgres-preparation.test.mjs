import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { assertPostgresReady, initializePostgresDatabase, inspectPostgresDatabase,
  PostgresPreparationError } from './postgres-preparation.mjs';

const [schemaSql, seedsSql] = await Promise.all([
  readFile(new URL('../database/schema.sql', import.meta.url), 'utf8'),
  readFile(new URL('../database/seeds.sql', import.meta.url), 'utf8'),
]);
const reviewed = { schemaSql, seedsSql, dataApiReviewed: true };

function rejectsCode(promise, code) {
  return assert.rejects(promise, (error) => error instanceof PostgresPreparationError && error.code === code);
}
function assertReadOnly(operations) {
  assert.ok(operations.length > 0);
  assert.ok(operations.every(({ kind, sql }) => kind === 'query' &&
    /^\s*(?:\/\*[\s\S]*?\*\/\s*)?SELECT\b/i.test(sql)));
}

test('preparación y privacidad PostgreSQL: SQL real en PGlite aislado; evidencia TLS simulada', async (t) => {
  const embedded = new PGlite();
  t.after(() => embedded.close());
  await embedded.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE unknown_reader;');
  const operations = [];
  const secret = 'postgresql://private-login:private-password@private-host.example/database';
  const tlsEvidence = { encrypted: true, authorized: true, protocol: 'TLSv1.3' };
  const wrap = (connection) => ({
    schema: 'constructora_private',
    query: (sql, params) => { operations.push({ kind: 'query', sql }); return connection.query(sql, params); },
    exec: (sql) => { operations.push({ kind: 'exec', sql }); return connection.exec(sql); },
  });
  const database = { ...wrap(embedded),
    verifyConnection: async () => ({ provider: 'postgresql', targetProjectVerified: false,
      tls: tlsEvidence, connectionString: secret, username: 'private-login' }),
    transaction: (callback) => embedded.transaction((tx) => callback(wrap(tx))),
  };
  async function reset() {
    await embedded.exec('DROP SCHEMA IF EXISTS constructora_private CASCADE; DROP TABLE IF EXISTS public.maquinaria CASCADE;');
    await embedded.query("SELECT set_config('pgrst.db_schemas', '', false)");
    operations.length = 0;
  }

  await t.test('exige revisión de Data API antes de realizar consultas o cambios', async () => {
    await rejectsCode(initializePostgresDatabase(database, { ...reviewed, dataApiReviewed: false }), 'DATA_API_REVIEW_REQUIRED');
    assert.equal(operations.length, 0);
  });
  await t.test('rechaza un certificado sin verificar antes de inspeccionar o crear tablas', async () => {
    await rejectsCode(initializePostgresDatabase({ ...database,
      verifyConnection: async () => ({ tls: { encrypted: true, authorized: false } }) }, reviewed), 'DATABASE_TLS_NOT_VERIFIED');
    assert.equal(operations.length, 0);
  });
  await t.test('inventario vacío usa únicamente SELECT y no expone identidad de conexión', async () => {
    const inventory = await inspectPostgresDatabase(database);
    assert.deepEqual(inventory.appTables, []);
    assert.equal(inventory.targetSchema.exists, false);
    assert.equal(inventory.dataApiPanelReviewRequired, true);
    assertReadOnly(operations);
    assert.ok(!JSON.stringify(inventory).includes('private-login'));
    operations.length = 0;
  });
  await t.test('ejecuta scripts reales con ON DELETE y ON CONFLICT DO NOTHING; crea tablas privadas incluyendo autenticación', async () => {
    const result = await initializePostgresDatabase(database, reviewed);
    assert.deepEqual(result.createdTables, ['maquinaria', 'contrato', 'contrato_maquinaria', 'pago', 'usuario', 'sesion']);
    assert.equal(result.seeded, true);
    assert.deepEqual(result.tables.map(({ name, rowCount }) => [name, rowCount]), [
      ['contrato', 0], ['contrato_maquinaria', 0], ['maquinaria', 2], ['pago', 0], ['sesion', 0], ['usuario', 0],
    ]);
    assert.equal(result.connection.targetProjectVerified, false);
    assert.ok(!JSON.stringify(result).includes(secret));
    assert.ok(!JSON.stringify(result).includes('private-login'));
  });
  await t.test('pagos conservan importes exactos, identidad única, fecha y contrato protegido', async () => {
    const contractId = '00000000-0000-4000-8000-000000000001';
    const paymentId = '00000000-0000-4000-8000-000000000002';
    await embedded.query(`INSERT INTO constructora_private.contrato
      (id,maquinaria_id,maquinaria_nombre,cliente,fecha_inicio,fecha_fin,dias,tarifa_diaria,total)
      VALUES ($1,1,'Equipo pactado','Cliente de prueba','2027-01-01','2027-01-02',2,999,1998)`, [contractId]);
    const insertPayment = (id, contratoId, monto) => embedded.query(`INSERT INTO constructora_private.pago
      (id, contrato_id, monto) VALUES ($1,$2,$3) RETURNING monto::text, creado_en`, [id, contratoId, monto]);
    const { rows } = await insertPayment(paymentId, contractId, '19.98');
    assert.equal(rows[0].monto, '19.98');
    assert.ok(Number.isFinite(new Date(rows[0].creado_en).getTime()));
    await assert.rejects(insertPayment(paymentId, contractId, '19.98'), { code: '23505' });
    for (const amount of ['0', '-1']) {
      await assert.rejects(insertPayment('00000000-0000-4000-8000-000000000003', contractId, amount), { code: '23514' });
    }
    await assert.rejects(insertPayment('00000000-0000-4000-8000-000000000003', null, '1'), { code: '23502' });
    await assert.rejects(insertPayment('00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000099', '1'), { code: '23503' });
    await assert.rejects(embedded.query('DELETE FROM constructora_private.contrato WHERE id=$1', [contractId]), { code: '23001' });
    assert.equal((await embedded.query(`SELECT COUNT(*)::integer AS count FROM pg_indexes
      WHERE schemaname='constructora_private' AND tablename='pago' AND indexname='pago_contrato_idx'`)).rows[0].count, 1);
  });
  await t.test('metadata usa text[] compatible con el parser real de pg para claves y roles de políticas', async () => {
    // PGlite decodes name[] natively; pg otherwise returns its unparsed text.
    // Use the actual SQL result OIDs and pg's text decoder to cover that gap.
    assert.equal(pg.types.getTypeParser(1003, 'text')('{id}'), '{id}');
    assert.deepEqual(pg.types.getTypeParser(1009, 'text')('{id}'), ['id']);
    const wireArray = (values) => `{${values.map((value) =>
      `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}`;
    const decodedDatabase = { ...database,
      query: async (sql, params) => {
        const result = await database.query(sql, params);
        if (sql.includes('/* app-constraints */') || sql.includes('/* app-policies */')) {
          const expectedArrays = sql.includes('/* app-constraints */')
            ? ['columns', 'referenceColumns'] : ['roles'];
          for (const name of expectedArrays) {
            assert.equal(result.fields.find((field) => field.name === name)?.dataTypeID, 1009,
              `La metadata ${name} debe viajar como text[], no name[].`);
          }
          return { ...result, rows: result.rows.map((row) => ({ ...row,
            ...Object.fromEntries(expectedArrays.map((name) => [name,
              pg.types.getTypeParser(1009, 'text')(wireArray(row[name]))])),
          })) };
        }
        return result;
      },
    };
    const ready = await assertPostgresReady(decodedDatabase);
    assert.ok(ready.appTables.every((table) => table.constraints.every((constraint) =>
      Array.isArray(constraint.columns) && Array.isArray(constraint.referenceColumns))));
    await embedded.exec('CREATE POLICY parser_policy ON constructora_private.maquinaria FOR SELECT TO anon, authenticated USING (false);');
    try {
      const inventory = await inspectPostgresDatabase(decodedDatabase);
      assert.deepEqual(inventory.appTables.find(({ name }) => name === 'maquinaria').policies[0].roles,
        ['anon', 'authenticated']);
    } finally { await embedded.exec('DROP POLICY parser_policy ON constructora_private.maquinaria;'); }
  });
  await t.test('validación de arranque lee tablas y permisos sin aplicar migraciones ni semillas', async () => {
    operations.length = 0;
    const inventory = await assertPostgresReady(database);
    assert.equal(inventory.appTables.length, 6);
    assert.ok(inventory.appTables.every((table) => table.rlsEnabled && table.apiPrivileges.length === 0 && table.policies.length === 0));
    assertReadOnly(operations);
  });
  await t.test('inventario contiene conteos y columnas, nunca nombres de clientes o maquinaria', async () => {
    await embedded.query(`UPDATE constructora_private.maquinaria SET descripcion = $1 WHERE id = 1`, ['Contenido personal privado']);
    operations.length = 0;
    const inventory = await inspectPostgresDatabase(database);
    assert.equal(inventory.appTables.find(({ name }) => name === 'maquinaria').rowCount, 2);
    assert.ok(!JSON.stringify(inventory).includes('Contenido personal privado'));
    assert.ok(!JSON.stringify(inventory).includes('CAT 336'));
    assertReadOnly(operations);
  });
  await t.test('tablas existentes requieren revisión explícita y repetir no duplica ni reemplaza filas', async () => {
    operations.length = 0;
    await rejectsCode(initializePostgresDatabase(database, reviewed), 'EXISTING_TABLES_REVIEW_REQUIRED');
    assert.ok(!operations.some(({ kind }) => kind === 'exec'));
    await embedded.query('UPDATE constructora_private.maquinaria SET tarifa_diaria = 999 WHERE id = 1');
    const result = await initializePostgresDatabase(database, { ...reviewed, existingReviewed: true });
    assert.equal(result.seeded, false);
    assert.deepEqual(result.createdTables, []);
    assert.equal(Number((await embedded.query('SELECT tarifa_diaria FROM constructora_private.maquinaria WHERE id = 1')).rows[0].tarifa_diaria), 999);
  });
  await t.test('catálogo con otros IDs impide añadir maquinaria de demostración equivalente', async () => {
    await embedded.exec('TRUNCATE constructora_private.maquinaria CASCADE;');
    await embedded.query(`INSERT INTO constructora_private.maquinaria
      (id,nombre,tipo,descripcion,tarifa_diaria,disponible) VALUES (77,'CAT 336','Excavadora','Datos propios',800,true)`);
    const result = await initializePostgresDatabase(database, { ...reviewed, existingReviewed: true });
    assert.equal(result.seeded, false);
    assert.deepEqual((await embedded.query('SELECT id FROM constructora_private.maquinaria')).rows, [{ id: 77 }]);
  });
  await t.test('políticas o permisos existentes inseguros abortan antes de modificar ACL', async () => {
    await embedded.exec('GRANT SELECT ON constructora_private.maquinaria TO anon;');
    operations.length = 0;
    await rejectsCode(initializePostgresDatabase(database, { ...reviewed, existingReviewed: true }), 'UNSAFE_EXISTING_DATABASE_ACCESS');
    assert.ok(!operations.some(({ kind }) => kind === 'exec'));
    await embedded.exec('REVOKE SELECT ON constructora_private.maquinaria FROM anon; CREATE POLICY existing_policy ON constructora_private.maquinaria FOR SELECT USING (false);');
    operations.length = 0;
    await rejectsCode(initializePostgresDatabase(database, { ...reviewed, existingReviewed: true }), 'UNSAFE_EXISTING_DATABASE_ACCESS');
    assert.ok(!operations.some(({ kind }) => kind === 'exec'));
    await embedded.exec('DROP POLICY existing_policy ON constructora_private.maquinaria; GRANT SELECT ON constructora_private.maquinaria TO unknown_reader;');
    await rejectsCode(initializePostgresDatabase(database, { ...reviewed, existingReviewed: true }), 'UNSAFE_EXISTING_DATABASE_ACCESS');
    await embedded.exec('REVOKE SELECT ON constructora_private.maquinaria FROM unknown_reader;');
  });
  await t.test('pagos también rechaza acceso de Data API y no cambia permisos sin revisión', async () => {
    await embedded.exec('GRANT SELECT ON constructora_private.pago TO anon;');
    operations.length = 0;
    await rejectsCode(assertPostgresReady(database), 'UNSAFE_EXISTING_DATABASE_ACCESS');
    await rejectsCode(initializePostgresDatabase(database, { ...reviewed, existingReviewed: true }), 'UNSAFE_EXISTING_DATABASE_ACCESS');
    assert.ok(!operations.some(({ kind }) => kind === 'exec'));
    await embedded.exec('REVOKE SELECT ON constructora_private.pago FROM anon;');
  });
  await t.test('pagos exige restricciones exactas antes de aceptar o migrar una tabla existente', async () => {
    const cases = [
      ['ALTER TABLE constructora_private.pago ALTER COLUMN contrato_id DROP NOT NULL;',
        'ALTER TABLE constructora_private.pago ALTER COLUMN contrato_id SET NOT NULL;'],
      ['ALTER TABLE constructora_private.pago ALTER COLUMN creado_en DROP DEFAULT;',
        'ALTER TABLE constructora_private.pago ALTER COLUMN creado_en SET DEFAULT CURRENT_TIMESTAMP;'],
      ['ALTER TABLE constructora_private.pago DROP CONSTRAINT pago_monto_check; ALTER TABLE constructora_private.pago ADD CONSTRAINT pago_monto_check CHECK (monto >= 0);',
        'ALTER TABLE constructora_private.pago DROP CONSTRAINT pago_monto_check; ALTER TABLE constructora_private.pago ADD CONSTRAINT pago_monto_check CHECK (monto > 0);'],
      ['ALTER TABLE constructora_private.pago DROP CONSTRAINT pago_monto_check; ALTER TABLE constructora_private.pago ADD CONSTRAINT pago_monto_check CHECK (monto > 0) NOT VALID;',
        'ALTER TABLE constructora_private.pago VALIDATE CONSTRAINT pago_monto_check;'],
      ['ALTER TABLE constructora_private.pago DROP CONSTRAINT pago_contrato_id_fkey; ALTER TABLE constructora_private.pago ADD CONSTRAINT pago_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES constructora_private.contrato(id) ON DELETE CASCADE;',
        'ALTER TABLE constructora_private.pago DROP CONSTRAINT pago_contrato_id_fkey; ALTER TABLE constructora_private.pago ADD CONSTRAINT pago_contrato_id_fkey FOREIGN KEY (contrato_id) REFERENCES constructora_private.contrato(id) ON DELETE RESTRICT;'],
    ];
    for (const [change, restore] of cases) {
      await embedded.exec(change);
      try {
        operations.length = 0;
        await rejectsCode(assertPostgresReady(database), 'INCOMPATIBLE_EXISTING_TABLES');
        await rejectsCode(initializePostgresDatabase(database, { ...reviewed, existingReviewed: true }), 'INCOMPATIBLE_EXISTING_TABLES');
        assertReadOnly(operations);
      } finally { await embedded.exec(restore); }
    }
    await assertPostgresReady(database);
  });
  await t.test('esquema con objetos ajenos aborta sin quitarles permisos', async () => {
    await embedded.exec('CREATE VIEW constructora_private.unrelated_view AS SELECT 1 AS value;');
    operations.length = 0;
    await rejectsCode(initializePostgresDatabase(database, { ...reviewed, existingReviewed: true }), 'PRIVATE_SCHEMA_REVIEW_REQUIRED');
    assert.ok(!operations.some(({ kind }) => kind === 'exec'));
    await embedded.exec('DROP VIEW constructora_private.unrelated_view;');
  });
  await t.test('privilegios predeterminados inseguros existentes requieren revisión manual', async () => {
    await embedded.exec('ALTER DEFAULT PRIVILEGES IN SCHEMA constructora_private GRANT SELECT ON TABLES TO anon;');
    operations.length = 0;
    await rejectsCode(initializePostgresDatabase(database, { ...reviewed, existingReviewed: true }), 'UNSAFE_DEFAULT_DATABASE_ACCESS');
    assert.ok(!operations.some(({ kind }) => kind === 'exec'));
    await embedded.exec('ALTER DEFAULT PRIVILEGES IN SCHEMA constructora_private REVOKE SELECT ON TABLES FROM anon;');
  });
  await t.test('configuración SQL visible de Data API expuesta impide inicialización', async () => {
    await embedded.query("SELECT set_config('pgrst.db_schemas', 'public, constructora_private', false)");
    operations.length = 0;
    await rejectsCode(initializePostgresDatabase(database, { ...reviewed, existingReviewed: true }), 'SCHEMA_EXPOSED_TO_DATA_API');
    assert.ok(!operations.some(({ kind }) => kind === 'exec'));
    await embedded.query("SELECT set_config('pgrst.db_schemas', '', false)");
  });
  await t.test('esquema equivalente en public impide crear una segunda copia privada', async () => {
    await reset();
    await embedded.exec('CREATE TABLE public.maquinaria (id integer PRIMARY KEY);');
    operations.length = 0;
    await rejectsCode(initializePostgresDatabase(database, reviewed), 'APPLICATION_TABLES_IN_OTHER_SCHEMA');
    assert.ok(!operations.some(({ kind }) => kind === 'exec'));
    assert.equal((await embedded.query("SELECT COUNT(*)::integer AS count FROM pg_namespace WHERE nspname='constructora_private'")).rows[0].count, 0);
  });
  await t.test('tablas privadas incompatibles se conservan sin aplicar scripts', async () => {
    await reset();
    await embedded.exec('CREATE SCHEMA constructora_private; CREATE TABLE constructora_private.maquinaria (id text PRIMARY KEY);');
    operations.length = 0;
    await rejectsCode(initializePostgresDatabase(database, { ...reviewed, existingReviewed: true }), 'INCOMPATIBLE_EXISTING_TABLES');
    assert.ok(!operations.some(({ kind }) => kind === 'exec'));
  });
  await t.test('columnas compatibles sin claves primarias y relaciones no se aceptan', async () => {
    await reset();
    await initializePostgresDatabase(database, reviewed);
    await embedded.exec('ALTER TABLE constructora_private.maquinaria DROP CONSTRAINT maquinaria_pkey CASCADE;');
    operations.length = 0;
    await rejectsCode(initializePostgresDatabase(database, { ...reviewed, existingReviewed: true }), 'INCOMPATIBLE_EXISTING_TABLES');
    assert.ok(!operations.some(({ kind }) => kind === 'exec'));
  });
  await t.test('schema-only deja catálogo vacío y el arranque rechaza esquemas incompletos', async () => {
    await reset();
    operations.length = 0;
    await rejectsCode(assertPostgresReady(database), 'DATABASE_SCHEMA_NOT_READY');
    assertReadOnly(operations);
    const result = await initializePostgresDatabase(database, { ...reviewed, seedsSql: '' });
    assert.equal(result.seeded, false);
    assert.equal(result.tables.find(({ name }) => name === 'maquinaria').rowCount, 0);
    await embedded.exec('ALTER TABLE constructora_private.contrato DROP COLUMN firma;');
    await rejectsCode(assertPostgresReady(database), 'DATABASE_SCHEMA_NOT_READY');
  });
  await t.test('actualización revisada conserva contratos históricos y sólo rellena detalle ausente', async () => {
    // Reproduce the pre-payment schema; no historical payment can be inferred.
    await embedded.exec('DROP TABLE constructora_private.pago;');
    await embedded.exec(`INSERT INTO constructora_private.maquinaria
      (id,nombre,tipo,descripcion,tarifa_diaria,disponible) VALUES (77,'Nombre nuevo','Excavadora','Datos propios',1100,true);
      INSERT INTO constructora_private.contrato
      (id,maquinaria_id,maquinaria_nombre,cliente,fecha_inicio,fecha_fin,dias,tarifa_diaria,total)
      VALUES ('00000000-0000-4000-8000-000000000077',77,'Nombre histórico','Cliente histórico','2027-01-01','2027-01-02',2,999,1998);`);
    const result = await initializePostgresDatabase(database, { ...reviewed, existingReviewed: true });
    assert.equal(result.seeded, false);
    assert.deepEqual(result.createdTables, ['pago']);
    assert.equal((await embedded.query('SELECT COUNT(*)::integer AS count FROM constructora_private.pago')).rows[0].count, 0);
    const historical = (await embedded.query(`SELECT maquinaria_nombre, tarifa_diaria::text, total::text
      FROM constructora_private.contrato`)).rows[0];
    assert.deepEqual(historical, { maquinaria_nombre: 'Nombre histórico', tarifa_diaria: '999.00', total: '1998.00' });
    assert.deepEqual((await embedded.query(`SELECT maquinaria_nombre, tarifa_diaria::text
      FROM constructora_private.contrato_maquinaria`)).rows, [{ maquinaria_nombre: 'Nombre histórico', tarifa_diaria: '999.00' }]);
    await embedded.exec(`INSERT INTO constructora_private.pago (id, contrato_id, monto)
      VALUES ('00000000-0000-4000-8000-000000000078','00000000-0000-4000-8000-000000000077',98);`);
    const repeated = await initializePostgresDatabase(database, { ...reviewed, existingReviewed: true });
    assert.deepEqual(repeated.createdTables, []);
    assert.equal((await embedded.query('SELECT COUNT(*)::integer AS count FROM constructora_private.contrato_maquinaria')).rows[0].count, 1);
    assert.deepEqual((await embedded.query('SELECT monto::text FROM constructora_private.pago')).rows, [{ monto: '98.00' }]);
  });
  await t.test('scripts destructivos se rechazan antes de realizar cualquier consulta', async () => {
    operations.length = 0;
    for (const sql of ['DROP TABLE maquinaria;', 'DELETE FROM maquinaria;', 'TRUNCATE maquinaria;',
      'ALTER TABLE maquinaria DROP COLUMN nombre;',
      "INSERT INTO maquinaria (id,nombre) VALUES (1,'nuevo') ON CONFLICT (id) DO UPDATE SET nombre = excluded.nombre;"]) {
      await rejectsCode(initializePostgresDatabase(database, { ...reviewed, schemaSql: sql }), 'UNSAFE_DATABASE_SCRIPT');
    }
    assert.equal(operations.length, 0);
  });
  await t.test('errores de inspección nunca divulgan errores del proveedor ni credenciales', async () => {
    let caught;
    try { await inspectPostgresDatabase({ query: async () => { throw new Error(secret); } }); }
    catch (error) { caught = error; }
    assert.ok(caught instanceof PostgresPreparationError);
    assert.equal(caught.code, 'DATABASE_INSPECTION_FAILED');
    assert.ok(!caught.safeMessage.includes(secret));
    assert.ok(!caught.stack.includes(secret));
  });
});
