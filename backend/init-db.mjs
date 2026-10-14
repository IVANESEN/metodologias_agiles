import { createDatabase, initializeDatabase, safeDatabaseError } from './database.mjs';
import { PostgresPreparationError } from './postgres-preparation.mjs';

let database;
try {
  const flags = new Set(process.argv.slice(2));
  if ([...flags].some((flag) => !['--existing-reviewed', '--schema-only'].includes(flag))) {
    throw new PostgresPreparationError('INVALID_INITIALIZATION_FLAG',
      'Usa db:init con --existing-reviewed o --schema-only cuando corresponda.');
  }
  database = await createDatabase();
  const result = await initializeDatabase(database, {
    existingReviewed: flags.has('--existing-reviewed'), seed: !flags.has('--schema-only'),
  });
  if (database.provider === 'postgresql') console.info(JSON.stringify(result, null, 2));
  else console.info(`Esquema local inicializado (${database.provider}).`);
} catch (error) {
  console.error(error instanceof PostgresPreparationError ? error.safeMessage : safeDatabaseError(error));
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => { process.exitCode = 1; });
}
