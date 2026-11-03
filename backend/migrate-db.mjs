import { pathToFileURL } from 'node:url';
import { createDatabase, safeDatabaseError } from './database.mjs';
import { migratePostgresDatabase, PostgresPreparationError } from './postgres-preparation.mjs';
import { migrateCuentas } from './cuentas-migracion.mjs';

export async function migrateDatabase({ connectionString = process.env.DATABASE_URL,
  production = process.env.NODE_ENV === 'production', log = console.info } = {}) {
  if (!connectionString && !production) {
    log('Desarrollo local: el servidor preparará PGlite; no se ejecutan migraciones remotas.');
    return { applied: false, skipped: 'pglite' };
  }
  const database = await createDatabase({ connectionString, production });
  try {
    const result = await migratePostgresDatabase(database);
    const cuentas = await migrateCuentas(database);
    log(cuentas.applied ? 'Migración de estados de cuenta aplicada; pagos históricos conservados.' : 'Estados de cuenta preparados.');
    log(result.applied
      ? 'Migración 20261101_reajustes aplicada y verificada; datos históricos conservados.'
      : 'Reajustes 20261101 ya preparados.');
    return result;
  } finally {
    await database.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    if (process.argv.length > 2) throw new PostgresPreparationError('INVALID_MIGRATION_FLAG',
      'Usa db:migrate sin argumentos. Solo ejecuta la migración registrada para esta versión.');
    await migrateDatabase();
  } catch (error) {
    console.error(safeDatabaseError(error));
    process.exitCode = 1;
  }
}
