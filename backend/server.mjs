import { createServer } from './app.mjs';
import { createDatabase, initializeDatabase, safeDatabaseError } from './database.mjs';
import { assertPostgresReady } from './postgres-preparation.mjs';

const configuredPort = process.env.PORT || process.env.SERVER_PORT || '3000';
const port = Number(configuredPort);
const host = process.env.HOST || '0.0.0.0';
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  console.error('PORT o SERVER_PORT debe contener un puerto válido.');
  process.exitCode = 1;
} else {
  let database;
  let server;
  try {
    database = await createDatabase();
    if (database.provider === 'pglite') {
      await initializeDatabase(database);
    } else {
      await database.verifyConnection();
      await assertPostgresReady(database);
    }
    server = createServer({ database });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
    console.info(`Constructora El Salvador disponible en http://localhost:${server.address().port}`);
    console.info(`Persistencia: ${database.provider}.`);
    let shuttingDown = false;
    async function shutdown() {
      if (shuttingDown) return;
      shuttingDown = true;
      const deadline = setTimeout(() => {
        server.closeAllConnections();
        process.exit(1);
      }, 10_000);
      deadline.unref();
      server.closeIdleConnections();
      await new Promise((resolve) => server.close(resolve));
      await database.close();
      clearTimeout(deadline);
    }
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } catch (error) {
    console.error(process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL
      ? 'DATABASE_URL es obligatoria en producción. Configura PostgreSQL antes de iniciar el servicio.'
      : `No se pudo iniciar el servidor. ${safeDatabaseError(error)}`);
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await database?.close().catch(() => {});
    process.exitCode = 1;
  }
}
