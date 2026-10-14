import { createDatabase, DatabaseConfigurationError, safeDatabaseError } from './database.mjs';
import { assertPostgresReady } from './postgres-preparation.mjs';

let database;
let server;
try {
  if (!process.env.DATABASE_URL || !process.env.SUPABASE_PROJECT_REF) {
    throw new DatabaseConfigurationError('SUPABASE_NOT_CONFIGURED',
      'Configura DATABASE_URL y SUPABASE_PROJECT_REF en .env para verificar Supabase. Esta comprobación nunca usa PGlite.');
  }
  const { createServer } = await import('./app.mjs');
  database = await createDatabase();
  const evidence = await database.verifyConnection();
  if (!evidence.targetProjectVerified) {
    throw new DatabaseConfigurationError('WRONG_SUPABASE_TARGET', 'No se pudo confirmar el proyecto de Supabase configurado.');
  }
  await assertPostgresReady(database);
  // Exercise the actual HTTP handlers using the same verified pg pool.
  // No schema initialization, fixtures or write requests are made here.
  server = createServer({ database });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(10_000) });
  const healthBody = await health.json();
  if (health.status !== 200 || healthBody.status !== 'ok' || healthBody.database !== 'postgresql') {
    throw new DatabaseConfigurationError('HEALTH_FAILED', '/api/health no confirmó PostgreSQL disponible.');
  }
  const machinery = await fetch(`${baseUrl}/api/maquinaria`, { signal: AbortSignal.timeout(10_000) });
  const rows = await machinery.json();
  if (machinery.status !== 200 || !Array.isArray(rows)) {
    throw new DatabaseConfigurationError('READ_FAILED', 'La consulta de lectura /api/maquinaria no se completó.');
  }
  console.info(JSON.stringify({
    ...evidence,
    health: { httpStatus: health.status, ...healthBody },
    read: { endpoint: '/api/maquinaria', httpStatus: machinery.status, rowCount: rows.length },
  }, null, 2));
} catch (error) {
  console.error(`Verificación de Supabase incompleta. ${safeDatabaseError(error)}`);
  process.exitCode = 1;
} finally {
  if (server?.listening) {
    server.closeIdleConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await database?.close().catch(() => { process.exitCode = 1; });
}
