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
const fakeRenderHost = 'dpg-unittest123-a';
const fakeRenderUri = `postgresql://backend_role:${fakeSecret}@${fakeRenderHost}/constructora_test`;
const baseOptions = {
  connectionString: fakeUri,
  schema: 'constructora_private',
  caFile: '',
  projectRef: '',
  tlsVerificationDisabled: false,
  runningOnRender: false,
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

test('Render internal PostgreSQL disables TLS only inside the Render runtime', async () => {
  for (const port of ['', ':5432']) {
    const connectionString = fakeRenderUri.replace(fakeRenderHost, `${fakeRenderHost}${port}`);
    const accepted = await config({
      connectionString: `${connectionString}?application_name=render-config-test`,
      runningOnRender: true,
    });
    const parameters = new pg.Client(accepted.poolConfig).connectionParameters;
    assert.equal(accepted.renderInternal, true);
    assert.equal(accepted.requiresDataApiReview, false);
    assert.equal(accepted.targetProjectVerified, false);
    assert.equal(accepted.poolConfig.ssl, false);
    assert.equal(parameters.ssl, false);
    assert.equal(parameters.host, fakeRenderHost);
    assert.equal(parameters.port, 5432);
    assert.equal(parameters.database, 'constructora_test');
    assert.equal(parameters.application_name, 'render-config-test');
  }
  await rejectsConfig({ connectionString: fakeRenderUri }, 'RENDER_INTERNAL_URL');
});

test('Render runtime detection defaults to the exact RENDER environment flag', async () => {
  const originalRender = process.env.RENDER;
  try {
    for (const value of [undefined, 'false', 'TRUE', '1']) {
      if (value === undefined) delete process.env.RENDER;
      else process.env.RENDER = value;
      await rejectsConfig({ connectionString: fakeRenderUri, runningOnRender: undefined }, 'RENDER_INTERNAL_URL');
    }
    process.env.RENDER = 'true';
    const accepted = await config({ connectionString: fakeRenderUri, runningOnRender: undefined });
    assert.equal(accepted.renderInternal, true);
    assert.equal(accepted.poolConfig.ssl, false);
    await rejectsConfig({ connectionString: fakeRenderUri, runningOnRender: false }, 'RENDER_INTERNAL_URL');
  } finally {
    if (originalRender === undefined) delete process.env.RENDER;
    else process.env.RENDER = originalRender;
  }
});

test('Render internal PostgreSQL rejects unsupported ports and explicit TLS modes', async () => {
  for (const port of ['5433', '6543']) {
    await rejectsConfig({
      connectionString: fakeRenderUri.replace(fakeRenderHost, `${fakeRenderHost}:${port}`),
      runningOnRender: true,
    }, 'INVALID_RENDER_INTERNAL_URL');
  }
  for (const mode of ['', 'require', 'verify-full', 'disable', 'allow', 'prefer', 'verify-ca', 'no-verify']) {
    await rejectsConfig({
      connectionString: `${fakeRenderUri}?sslmode=${mode}`,
      runningOnRender: true,
    }, 'UNSAFE_TLS');
  }
  await rejectsConfig({
    connectionString: fakeRenderUri,
    runningOnRender: true,
    tlsVerificationDisabled: true,
  }, 'UNSAFE_TLS');
});

test('Render internal PostgreSQL rejects retained Supabase project and CA settings', async () => {
  for (const options of [
    { projectRef: 'aaaaaaaaaaaaaaaaaaaa' },
    { caFile: 'fictitious-previous-provider-root.pem' },
    { projectRef: 'aaaaaaaaaaaaaaaaaaaa', caFile: 'fictitious-previous-provider-root.pem' },
  ]) {
    await rejectsConfig({
      connectionString: fakeRenderUri,
      runningOnRender: true,
      ...options,
    }, 'INVALID_RENDER_INTERNAL_URL');
  }
});

test('external and Render lookalike hosts retain verified TLS on Render', async () => {
  for (const hostname of [
    'session.example.invalid',
    `${fakeRenderHost}.example.invalid`,
    'dpg-unit-test-a',
    'dpg-unittest123-aa',
    'dpg-unittest123',
    'DPG-UNITTEST123-A',
    '%64pg-unittest123-a',
    `${fakeRenderHost}.`,
  ]) {
    for (const mode of ['', '?sslmode=require', '?sslmode=verify-full']) {
      const connectionString = `postgresql://backend_role:${fakeSecret}@${hostname}:5432/postgres${mode}`;
      const accepted = await config({ connectionString, runningOnRender: true });
      const parameters = new pg.Client(accepted.poolConfig).connectionParameters;
      assert.equal(accepted.renderInternal, false);
      assert.equal(accepted.requiresDataApiReview, false);
      assert.equal(parameters.host, decodeURIComponent(hostname));
      assert.equal(parameters.ssl.rejectUnauthorized, true);
      assert.equal(new URL(accepted.poolConfig.connectionString).searchParams.has('sslmode'), false);
    }
  }
});

test('Data API review is required only for actual Supabase hostname suffixes', async () => {
  for (const hostname of [
    'fictitious.pooler.supabase.com',
    'db.fictitious.supabase.co',
    'fictitious.POOLER.SUPABASE.COM',
    'fictitious.pooler.supabase%2ecom',
    'fictitious.pooler.supabase.com.',
    'db.fictitious.SUPABASE.CO',
    'db.fictitious.supabase%2eco',
    'db.fictitious.supabase.co.',
  ]) {
    const connectionString = `postgresql://backend_role:${fakeSecret}@${hostname}:5432/postgres`;
    const accepted = await config({ connectionString });
    assert.equal(accepted.requiresDataApiReview, true);
    assert.equal(accepted.targetProjectVerified, false);
    assert.equal(accepted.renderInternal, false);
  }
  for (const hostname of [
    'session.example.invalid',
    'fictitious.pooler.supabase.com.evil.invalid',
    'db.fictitious.supabase.co.evil.invalid',
    'fictitious.supabase.com',
    'supabase.co',
  ]) {
    const connectionString = `postgresql://backend_role:${fakeSecret}@${hostname}:5432/postgres`;
    assert.equal((await config({ connectionString })).requiresDataApiReview, false);
  }
  await rejectsConfig({
    connectionString: `postgresql://backend_role:${fakeSecret}@fictitious.pooler.supabase%zzcom:5432/postgres`,
  }, 'INVALID_DATABASE_URL');
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
  assert.equal(accepted.requiresDataApiReview, true);
  assert.equal(accepted.renderInternal, false);
  assert.equal(new pg.Client(accepted.poolConfig).connectionParameters.host, 'fictitious.pooler.supabase.com');
  assert.equal((await config()).targetProjectVerified, false);

  for (const hostname of [
    'fictitious.POOLER.SUPABASE.COM',
    'fictitious.pooler.supabase%2ecom',
    'fictitious.pooler.supabase.com.',
  ]) {
    const normalized = await config({
      connectionString: connectionString.replace('fictitious.pooler.supabase.com', hostname),
      projectRef,
    });
    assert.equal(normalized.targetProjectVerified, true);
    assert.equal(normalized.requiresDataApiReview, true);
    assert.equal(normalized.poolConfig.ssl.rejectUnauthorized, true);
  }

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
