import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const defaultDataDir = fileURLToPath(new URL('../data/', import.meta.url));

/** Both adapters expose query, exec, transaction and close. */
export async function createDatabase({
  connectionString = process.env.DATABASE_URL,
  dataDir = process.env.DATA_DIR || defaultDataDir,
  production = process.env.NODE_ENV === 'production',
} = {}) {
  if (connectionString) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      // TLS is configured by the provider's connection URL; certificate
      // verification is never disabled silently by this application.
    });
    // Idle connection failures otherwise become uncaught EventEmitter errors.
    pool.on('error', () => console.error('Una conexión inactiva de PostgreSQL falló.'));
    return {
      provider: 'postgresql',
      query: (sql, params = []) => pool.query(sql, params),
      exec: (sql) => pool.query(sql),
      async transaction(callback) {
        const client = await pool.connect();
        let brokenConnection;
        try {
          await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
          const result = await callback({
            query: (sql, params = []) => client.query(sql, params),
            exec: (sql) => client.query(sql),
          });
          await client.query('COMMIT');
          return result;
        } catch (error) {
          try { await client.query('ROLLBACK'); }
          catch (rollbackError) { brokenConnection = rollbackError; }
          throw error;
        } finally {
          // A connection unable to roll back must not return to the pool.
          client.release(brokenConnection);
        }
      },
      close: () => pool.end(),
    };
  }

  if (production) {
    throw new Error('DATABASE_URL es obligatoria en producción. No uses PGlite en almacenamiento efímero.');
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const embedded = await PGlite.create(dataDir);
  return {
    provider: 'pglite',
    query: (sql, params = []) => embedded.query(sql, params),
    exec: (sql) => embedded.exec(sql),
    transaction: (callback) => embedded.transaction(callback),
    close: () => embedded.close(),
  };
}

export async function initializeDatabase(database) {
  const [schema, seeds] = await Promise.all([
    readFile(new URL('../database/schema.sql', import.meta.url), 'utf8'),
    readFile(new URL('../database/seeds.sql', import.meta.url), 'utf8'),
  ]);
  await database.transaction(async (tx) => {
    await tx.exec(schema);
    await tx.exec(seeds);
  });
}
