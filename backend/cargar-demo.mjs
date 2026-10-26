// Carga explícita de los datos de demostración en una base PostgreSQL ya preparada.
import { createDatabase, initializeDatabase, safeDatabaseError } from './database.mjs';
import { assertPostgresReady } from './postgres-preparation.mjs';
import { loadDemoData } from './demo-data.mjs';

let database;
try {
  database = await createDatabase();
  if (database.provider === 'postgresql') await assertPostgresReady(database);
  else await initializeDatabase(database);
  const { loaded } = await loadDemoData(database);
  console.info(loaded ? 'Datos de demostración cargados.' : 'Los datos de demostración ya existían; no se modificó nada.');
} catch (error) {
  console.error(safeDatabaseError(error));
  process.exitCode = 1;
} finally { await database?.close(); }
