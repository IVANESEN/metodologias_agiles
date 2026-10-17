import { createDatabase, initializeDatabase, safeDatabaseError } from './database.mjs';
import { assertPostgresReady } from './postgres-preparation.mjs';
import { createUser, AuthError } from './auth.mjs';

let database;
try {
  // Environment only: passwords never appear in CLI arguments, repository seeds, or success output.
  database = await createDatabase();
  if (database.provider === 'postgresql') await assertPostgresReady(database);
  else await initializeDatabase(database);
  const user = await createUser(database, { correo: process.env.USUARIO_CORREO, nombre: process.env.USUARIO_NOMBRE,
    clave: process.env.USUARIO_CLAVE, rol: process.env.USUARIO_ROL || 'residente' });
  console.info(`Usuario creado: ${user.id}`);
} catch (error) {
  console.error(error instanceof AuthError ? error.message : error.code === '23505'
    ? 'Ya existe un usuario con ese correo.' : safeDatabaseError(error));
  process.exitCode = 1;
} finally { await database?.close(); }
