import { createDatabase, safeDatabaseError } from './database.mjs';
import { inspectPostgresDatabase, PostgresPreparationError } from './postgres-preparation.mjs';

let database;
try {
  if (!process.env.DATABASE_URL) {
    throw new PostgresPreparationError('DATABASE_URL_REQUIRED',
      'Configura personalmente DATABASE_URL en .env antes de inspeccionar PostgreSQL. Este comando no usa PGlite.');
  }
  database = await createDatabase();
  const verified = await database.verifyConnection();
  const connection = { provider: 'postgresql', targetProjectVerified: verified.targetProjectVerified === true,
    privateNetwork: verified.privateNetwork === true,
    databaseSchema: database.schema, tls: { encrypted: verified.tls?.encrypted === true,
      authorized: verified.tls?.authorized === true,
      protocol: verified.tls?.encrypted === true
        ? (/^TLSv\d(?:\.\d)?$/.test(verified.tls?.protocol) ? verified.tls.protocol : 'TLS') : null } };
  const inventory = await inspectPostgresDatabase(database);
  console.info(JSON.stringify({ connection, inventory }, null, 2));
} catch (error) {
  console.error(error instanceof PostgresPreparationError ? error.safeMessage : safeDatabaseError(error));
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => { process.exitCode = 1; });
}
