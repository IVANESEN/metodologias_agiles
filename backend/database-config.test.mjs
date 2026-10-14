import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import pg from 'pg';
import { buildPostgresConfig, DatabaseConfigurationError, safeDatabaseError } from './database.mjs';

// All connection details here are fictitious; these tests never open a socket.
const fakeSecret = 'unit-test-secret';
const fakeUri = `postgresql://backend_role:${fakeSecret}@session.example.invalid:5432/postgres`;
const baseOptions = {
  connectionString: fakeUri,
  schema: 'constructora_private',
  caFile: '',
  projectRef: '',
  tlsVerificationDisabled: false,
};
const config = (options = {}) => buildPostgresConfig({ ...baseOptions, ...options });

async function removeFixtureFolder(folder, prefix) {
  const target = resolve(folder);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.ok(basename(target).startsWith(prefix));
  await rm(target, { recursive: true, force: true });
}

async function rejectsConfig(options, code) {
  await assert.rejects(config(options), (error) => {
    assert.ok(error instanceof DatabaseConfigurationError);
    assert.equal(error.code, code);
    assert.equal(typeof safeDatabaseError(error), 'string');
    assert.ok(!safeDatabaseError(error).includes(fakeSecret));
    assert.ok(!error.message.includes(fakeSecret));
    return true;
  });
}

test('pg preserves verified TLS after accepted sslmode parameters are normalized', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'constructora-tls-config-'));
  t.after(() => removeFixtureFolder(folder, 'constructora-tls-config-'));
  const caFile = join(folder, 'fictitious-root.pem');
  // This fixture only exercises config parsing, not certificate validity.
  const ca = '-----BEGIN CERTIFICATE-----\nUNIT_TEST_CERTIFICATE\n-----END CERTIFICATE-----\n';
  await writeFile(caFile, ca);

  for (const mode of [null, 'require', 'verify-full']) {
    for (const configuredCa of ['', caFile]) {
      const connectionString = `${fakeUri}?application_name=local-config-test${mode ? `&sslmode=${mode}` : ''}`;
      const { poolConfig } = await config({ connectionString, caFile: configuredCa });
      const parameters = new pg.Client(poolConfig).connectionParameters;
      assert.equal(new URL(poolConfig.connectionString).searchParams.has('sslmode'), false);
      assert.equal(parameters.ssl.rejectUnauthorized, true);
      assert.equal(parameters.ssl.ca, configuredCa ? ca : undefined);
      assert.equal(parameters.ssl.checkServerIdentity, undefined);
      assert.equal(parameters.sslnegotiation, 'postgres');
      assert.equal(parameters.application_name, 'local-config-test');
      assert.equal(parameters.host, 'session.example.invalid');
      assert.equal(parameters.port, 5432);
      assert.equal(parameters.user, 'backend_role');
      assert.equal(parameters.database, 'postgres');
    }
  }
});

test('URI options cannot override TLS, credentials, destination, or session settings', async () => {
  for (const query of [
    'ssl=0', 'ssl=no-verify', 'sslrootcert=secret-file', 'sslcert=secret-file',
    'sslkey=secret-file', 'uselibpqcompat=true', 'sslnegotiation=direct',
    'host=other.example.invalid', 'port=6543', 'user=other_role',
    'password=other-secret', 'options=-csearch_path%3Dpublic',
    'application_name=first&application_name=second',
    'sslmode=require&sslmode=verify-full',
  ]) {
    await rejectsConfig({ connectionString: `${fakeUri}?${query}` }, 'UNSAFE_URI_OPTIONS');
  }
  for (const mode of ['disable', 'allow', 'prefer', 'verify-ca', 'no-verify']) {
    await rejectsConfig({ connectionString: `${fakeUri}?sslmode=${mode}` }, 'UNSAFE_TLS');
  }
  await rejectsConfig({ tlsVerificationDisabled: true }, 'UNSAFE_TLS');
});

test('non-PostgreSQL, incomplete, malformed, and placeholder URIs fail safely', async () => {
  for (const connectionString of [
    `https://backend_role:${fakeSecret}@session.example.invalid/postgres`,
    `not-a-uri-${fakeSecret}`,
    'postgresql://backend_role@session.example.invalid:5432/postgres',
    `postgresql://backend_role:${fakeSecret}@session.example.invalid:5432/`,
    `${fakeUri}#unexpected-fragment`,
    'postgresql://USUARIO_DEL_PANEL:CONTRASENA_CODIFICADA@HOST_DEL_PANEL:5432/BASE_DEL_PANEL',
    `postgresql://backend_role:${fakeSecret}%not-hex@session.example.invalid:5432/postgres`,
  ]) {
    await rejectsConfig({ connectionString }, 'INVALID_DATABASE_URL');
  }
});

test('public, reserved, and injectable schema names cannot become the search path', async () => {
  for (const schema of [
    'public', 'auth', 'storage', 'information_schema', 'extensions', 'realtime',
    'graphql_public', 'vault', 'pg_catalog', 'Private', 'private,public',
    'private;DROP SCHEMA public', 'a'.repeat(64),
  ]) {
    await rejectsConfig({ schema }, 'INVALID_SCHEMA');
  }
  assert.equal((await config({ schema: 'backend_2026' })).schema, 'backend_2026');
});

test('Supabase target check uses the supplied pooler hostname and project username', async () => {
  const projectRef = 'hqhkpuaxnisfxicvjsmn';
  // Explicitly fictitious host: no attempt is made to infer the real panel host.
  const connectionString = `postgresql://backend_role.${projectRef}:${fakeSecret}@fictitious.pooler.supabase.com:5432/postgres`;
  const accepted = await config({ connectionString, projectRef });
  assert.equal(accepted.targetProjectVerified, true);
  assert.equal(new pg.Client(accepted.poolConfig).connectionParameters.host, 'fictitious.pooler.supabase.com');
  assert.equal((await config()).targetProjectVerified, false);

  for (const options of [
    { connectionString: fakeUri, projectRef },
    { connectionString, projectRef: 'aaaaaaaaaaaaaaaaaaaa' },
    { connectionString, projectRef: 'not-a-project-ref' },
    { connectionString: connectionString.replace('fictitious.pooler.supabase.com', 'fictitious.pooler.supabase.com.evil.invalid'), projectRef },
    { connectionString: connectionString.replace(`backend_role.${projectRef}`, `.${projectRef}`), projectRef },
  ]) {
    await rejectsConfig(options, 'WRONG_SUPABASE_TARGET');
  }
  for (const connection of [
    connectionString.replace(':5432/', ':6543/'),
    connectionString.replace(':5432/', '/'),
  ]) {
    await rejectsConfig({ connectionString: connection, projectRef }, 'WRONG_POOLER_MODE');
  }
});

test('reserved password characters reach pg once decoded and never get double encoded', async () => {
  const password = 'unit@secret:/?#% &+!';
  const encodedPassword = encodeURIComponent(password);
  const connectionString = `postgresql://backend_role:${encodedPassword}@session.example.invalid:5432/postgres?sslmode=verify-full`;
  const { poolConfig } = await config({ connectionString });
  const client = new pg.Client(poolConfig);
  assert.equal(client.connectionParameters.password, password);
  assert.equal(new URL(poolConfig.connectionString).password, encodedPassword);
  assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
});

test('CA read errors and driver errors expose only safe diagnostic messages', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'constructora-invalid-ca-'));
  t.after(() => removeFixtureFolder(folder, 'constructora-invalid-ca-'));
  const invalidCa = join(folder, 'invalid.pem');
  await writeFile(invalidCa, `not a certificate ${fakeSecret}`);
  await rejectsConfig({ caFile: join(folder, 'missing.pem') }, 'INVALID_CA_FILE');
  await rejectsConfig({ caFile: invalidCa }, 'INVALID_CA_FILE');

  for (const code of [
    '28P01', 'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID', 'SELF_SIGNED_CERT_IN_CHAIN',
    'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNKNOWN_DRIVER_CODE', '__proto__', 'constructor',
  ]) {
    const error = Object.assign(new Error(`Driver error with ${fakeUri}`), {
      code,
      input: fakeUri,
      detail: fakeSecret,
    });
    const message = safeDatabaseError(error);
    assert.equal(typeof message, 'string');
    assert.ok(message.length > 0);
    assert.ok(!message.includes(fakeSecret));
    assert.ok(!message.includes(fakeUri));
  }
  for (const error of [null, undefined, new Error(fakeUri)]) {
    assert.equal(typeof safeDatabaseError(error), 'string');
    assert.ok(!safeDatabaseError(error).includes(fakeSecret));
  }
});
