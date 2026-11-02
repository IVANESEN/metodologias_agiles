// Prepara una base PostgreSQL existente (Supabase o Render) para el portal multirrol.
// Uso: npm run db:portal            → roles, columnas, tablas y tasas
//      npm run db:portal -- --demo  → además, cuentas y catálogo de demostración
// Es aditivo e idempotente: no borra ni modifica contratos, pagos, usuarios ni sesiones.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createDatabase, safeDatabaseError } from './database.mjs';
import {
  PostgresPreparationError, inspectPostgresDatabase, initializePostgresDatabase, assertPostgresReady,
} from './postgres-preparation.mjs';
import { loadDemoData } from './demo-data.mjs';

export async function prepararPortal(database, { demo = false, log = console.info } = {}) {
  if (database.provider !== 'postgresql') {
    throw new PostgresPreparationError('POSTGRES_REQUIRED',
      'Configura DATABASE_URL en .env. En local, npm start ya prepara PGlite con el portal y los datos de demostración.');
  }
  const schema = database.schema || 'constructora_private';
  const [schemaSql, seedsSql] = await Promise.all([
    readFile(new URL('../database/schema.sql', import.meta.url), 'utf8'),
    readFile(new URL('../database/seeds.sql', import.meta.url), 'utf8'),
  ]);

  log('1/5 Revisando la base (solo lectura)…');
  const before = await inspectPostgresDatabase(database);
  const names = before.appTables.filter((table) => table.schema === schema).map((table) => table.name);
  if (!names.includes('usuario')) {
    throw new PostgresPreparationError('USUARIO_TABLE_MISSING',
      'La base no tiene la tabla usuario de los sprints anteriores. Ejecuta primero npm run db:init.');
  }
  log(`    Tablas encontradas en ${schema}: ${names.join(', ')}`);

  const tasas = /INSERT INTO configuracion[\s\S]*?ON CONFLICT \(clave\) DO NOTHING;/.exec(seedsSql)?.[0];
  if (!tasas) throw new PostgresPreparationError('RATES_MISSING', 'No se encontró el bloque de tasas en database/seeds.sql.');
  log('2/5 Preparando ampliación de roles y estados sin cambiar registros históricos…');
  log('3/5 Creando columnas y tablas nuevas del portal…');
  log('4/5 Registrando tasas iniciales en la misma transacción (no cambia tasas existentes)…');
  // Roles, columnas, tablas y tasas se confirman juntos o se revierten juntos.
  await initializePostgresDatabase(database, { schemaSql: `${schemaSql}\n${tasas}`, seedsSql: '', existingReviewed: true });

  log('5/5 Verificando el esquema como lo hará el servidor al arrancar…');
  const after = await assertPostgresReady(database);
  log(`    Listo: ${after.appTables.length} tablas protegidas.`);

  let demoLoaded = false;
  if (demo) {
    ({ loaded: demoLoaded } = await loadDemoData(database, { logger: { info: log } }));
    if (!demoLoaded) log('Los datos de demostración ya existían; no se modificó nada.');
  }
  return { tables: after.appTables.length, demoLoaded };
}

// Ejecución directa: npm run db:portal [-- --demo]
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  let database;
  try {
    const flags = new Set(process.argv.slice(2));
    if ([...flags].some((flag) => flag !== '--demo')) {
      throw new PostgresPreparationError('INVALID_FLAG', 'Usa db:portal o db:portal -- --demo.');
    }
    database = await createDatabase();
    await prepararPortal(database, { demo: flags.has('--demo') });
    console.info('La base está lista para desplegar el portal en Render.');
  } catch (error) {
    console.error(error instanceof PostgresPreparationError ? error.safeMessage : safeDatabaseError(error));
    process.exitCode = 1;
  } finally {
    await database?.close().catch(() => { process.exitCode = 1; });
  }
}
