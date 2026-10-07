import { createDatabase, initializeDatabase } from './database.mjs';

let database;
try {
  database = await createDatabase();
  await initializeDatabase(database);
  console.info(`Esquema y maquinaria inicializados (${database.provider}).`);
} catch {
  console.error(process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL
    ? 'DATABASE_URL es obligatoria en producción. Configura PostgreSQL antes de inicializar el esquema.'
    : 'No se pudo inicializar la base de datos. Revisa la configuración y la conexión.');
  process.exitCode = 1;
} finally {
  await database?.close().catch(() => { process.exitCode = 1; });
}
