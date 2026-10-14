import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PostgresPreparationError } from './postgres-preparation.mjs';

const defaultDataDir = fileURLToPath(new URL('../data/', import.meta.url));

export class DatabaseConfigurationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.safeMessage = message;
  }
}

/** Never print driver errors: authentication errors can contain credentials. */
export function safeDatabaseError(error) {
  if (error instanceof DatabaseConfigurationError || error instanceof PostgresPreparationError) {
    return error.safeMessage;
  }
  const messages = {
    '28P01': 'PostgreSQL rechazó la autenticación. Revisa la contraseña local y su codificación URI.',
    ENOTFOUND: 'No se pudo resolver el host. Copia de nuevo la URI de Connect > Session pooler.',
    ECONNREFUSED: 'La conexión fue rechazada. Revisa el panel, la red y las restricciones de acceso.',
    ETIMEDOUT: 'La conexión agotó el tiempo de espera. Revisa la red y el estado del proyecto.',
    CERT_HAS_EXPIRED: 'El certificado TLS ha caducado. Revisa el certificado del servidor.',
    ERR_TLS_CERT_ALTNAME_INVALID: 'El certificado no corresponde al host. Revisa la URI del panel.',
    SELF_SIGNED_CERT_IN_CHAIN: 'No se reconoce la autoridad TLS. Configura el certificado raíz del panel en DATABASE_SSL_CA_FILE.',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'No se reconoce la autoridad TLS. Configura DATABASE_SSL_CA_FILE con el certificado del panel.',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'No se pudo verificar TLS. Revisa DATABASE_SSL_CA_FILE; no desactives la verificación.',
    UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'Falta una autoridad TLS confiable. Configura DATABASE_SSL_CA_FILE con el certificado del panel.',
  };
  return Object.hasOwn(messages, error?.code) ? messages[error.code]
    : 'No se pudo completar la operación. Revisa la configuración local, la conexión y los permisos de PostgreSQL.';
}

/** Validate before handing the URI to pg, which accepts query overrides. */
export async function buildPostgresConfig({
  connectionString,
  schema = process.env.DATABASE_SCHEMA || 'constructora_private',
  caFile = process.env.DATABASE_SSL_CA_FILE,
  projectRef = process.env.SUPABASE_PROJECT_REF,
  tlsVerificationDisabled = process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0',
} = {}) {
  const fail = (code, message) => { throw new DatabaseConfigurationError(code, message); };
  if (tlsVerificationDisabled) {
    fail('UNSAFE_TLS', 'Quita NODE_TLS_REJECT_UNAUTHORIZED=0 antes de conectar. Se requiere verificación TLS.');
  }
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema) ||
      ['public', 'auth', 'storage', 'information_schema', 'extensions', 'realtime', 'graphql_public', 'vault'].includes(schema) ||
      schema.startsWith('pg_')) {
    fail('INVALID_SCHEMA', 'DATABASE_SCHEMA debe ser un esquema privado de la aplicación, por ejemplo constructora_private.');
  }
  let uri;
  try { uri = new URL(connectionString); }
  catch { fail('INVALID_DATABASE_URL', 'DATABASE_URL debe contener la URI PostgreSQL de Connect > Session pooler.'); }
  if (!['postgres:', 'postgresql:'].includes(uri.protocol) || !uri.hostname ||
      !uri.username || !uri.password || !uri.pathname || uri.pathname === '/' || uri.hash ||
      /USUARIO_DEL_PANEL|CONTRASENA_CODIFICADA|HOST_DEL_PANEL|BASE_DEL_PANEL|YOUR-PASSWORD/i.test(connectionString)) {
    fail('INVALID_DATABASE_URL', 'DATABASE_URL debe ser una URI PostgreSQL completa del panel, con los marcadores sustituidos y la contraseña codificada.');
  }
  let username;
  try {
    username = decodeURIComponent(uri.username);
    decodeURIComponent(uri.password);
    decodeURIComponent(uri.pathname);
  } catch {
    fail('INVALID_DATABASE_URL', 'Revisa la codificación URI del usuario, la contraseña y la base en .env.');
  }
  for (const key of uri.searchParams.keys()) {
    if (!['application_name', 'sslmode'].includes(key) || uri.searchParams.getAll(key).length !== 1) {
      fail('UNSAFE_URI_OPTIONS', 'La URI contiene opciones no admitidas. Usa la URI del panel; TLS se configura en el backend y el certificado en DATABASE_SSL_CA_FILE.');
    }
  }
  const sslmode = uri.searchParams.get('sslmode');
  if (sslmode !== null && !['require', 'verify-full'].includes(sslmode)) {
    fail('UNSAFE_TLS', 'Solo se admiten sslmode=require o verify-full; el backend siempre verifica certificado y hostname.');
  }
  // pg replaces the ssl object when sslmode is present. Normalize these two
  // accepted modes to explicit verified TLS, preserving the configured CA.
  uri.searchParams.delete('sslmode');
  let targetProjectVerified = false;
  if (projectRef) {
    if (!/^[a-z]{20}$/.test(projectRef) || !uri.hostname.endsWith('.pooler.supabase.com') ||
        !username.endsWith(`.${projectRef}`) || username === `.${projectRef}`) {
      fail('WRONG_SUPABASE_TARGET', 'La URI no coincide con el Session pooler del SUPABASE_PROJECT_REF configurado. Copia los valores exactos del panel.');
    }
    // The documented shared Session pooler uses 5432; 6543 is transaction
    // mode and cannot preserve the search_path set once per connection.
    // Reject a mismatch rather than guessing or rewriting the panel's port.
    if (uri.port !== '5432') {
      fail('WRONG_POOLER_MODE', 'Se requiere la URI exacta de Connect > Session pooler, con su puerto explícito. Transaction pooler no conserva la configuración de sesión del backend.');
    }
    targetProjectVerified = true;
  }
  let ca;
  if (caFile) {
    try { ca = await readFile(caFile, 'utf8'); }
    catch { fail('INVALID_CA_FILE', 'No se pudo leer DATABASE_SSL_CA_FILE. Usa la ruta local del certificado raíz descargado del panel.'); }
    if (!ca.includes('-----BEGIN CERTIFICATE-----')) {
      fail('INVALID_CA_FILE', 'DATABASE_SSL_CA_FILE debe contener el certificado raíz PEM descargado del panel.');
    }
  }
  return {
    schema,
    targetProjectVerified,
    poolConfig: {
      connectionString: uri.toString(),
      ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
      sslnegotiation: 'postgres',
      max: 3,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    },
  };
}

function verifiedTls(client) {
  const stream = client.connection.stream;
  if (stream.encrypted !== true || stream.authorized !== true) {
    throw new DatabaseConfigurationError('UNVERIFIED_TLS', 'La conexión no tiene TLS verificado. Revisa el certificado raíz y la URI del panel.');
  }
  return { encrypted: true, authorized: true, protocol: stream.getProtocol() };
}

/** Both adapters expose query, exec, transaction and close. */
export async function createDatabase({
  connectionString = process.env.DATABASE_URL,
  dataDir = process.env.DATA_DIR || defaultDataDir,
  production = process.env.NODE_ENV === 'production',
  schema,
  caFile,
  projectRef,
} = {}) {
  if (connectionString) {
    const { default: pg } = await import('pg');
    const config = await buildPostgresConfig({ connectionString, schema, caFile, projectRef });
    const pool = new pg.Pool({
      ...config.poolConfig,
      async onConnect(client) {
        verifiedTls(client);
        // Session pooler preserves session state. Never fall back to public.
        await client.query("SELECT set_config('search_path', $1, false)", [`${config.schema}, pg_catalog`]);
      },
    });
    // Idle connection failures otherwise become uncaught EventEmitter errors.
    pool.on('error', () => console.error('Una conexión inactiva de PostgreSQL falló.'));
    return {
      provider: 'postgresql',
      schema: config.schema,
      targetProjectVerified: config.targetProjectVerified,
      async verifyConnection() {
        const client = await pool.connect();
        try {
          const tls = verifiedTls(client);
          await client.query('SELECT 1 AS connected');
          return { provider: 'postgresql', targetProjectVerified: config.targetProjectVerified, databaseSchema: config.schema, tls };
        } finally { client.release(); }
      },
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
    throw new DatabaseConfigurationError('DATABASE_URL_REQUIRED',
      'DATABASE_URL es obligatoria en producción. No uses PGlite en almacenamiento efímero.');
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

export async function initializeDatabase(database, { existingReviewed = false, seed = true } = {}) {
  const [schema, seeds] = await Promise.all([
    readFile(new URL('../database/schema.sql', import.meta.url), 'utf8'),
    readFile(new URL('../database/seeds.sql', import.meta.url), 'utf8'),
  ]);
  if (database.provider === 'postgresql') {
    const { initializePostgresDatabase } = await import('./postgres-preparation.mjs');
    return initializePostgresDatabase(database, {
      schemaSql: schema, seedsSql: seed ? seeds : '', existingReviewed,
    });
  }
  await database.transaction(async (tx) => {
    await tx.exec(schema);
    if (seed) await tx.exec(seeds);
  });
}
