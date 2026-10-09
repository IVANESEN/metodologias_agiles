import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createDatabase, initializeDatabase } from './database.mjs';
import { createServer } from './app.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

const valid = {
  maquinaria_id: 1, cliente: 'Cliente de prueba', ciudad: 'San Salvador',
  fecha_inicio: '2027-01-10', fecha_fin: '2027-01-12',
};

test('API de alquiler con PostgreSQL embebido y persistencia real', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'constructora-backend-'));
  const dataDir = join(folder, 'postgres');
  const frontendDir = join(folder, 'frontend');
  await mkdir(frontendDir);
  await writeFile(join(frontendDir, 'index.html'), '<!doctype html><title>Constructora</title>');
  let database;
  let server;
  t.after(async () => {
    await closeServer(server);
    await database?.close();
    await rm(folder, { recursive: true, force: true });
  });
  database = await createDatabase({ connectionString: '', dataDir, production: false });
  await initializeDatabase(database);
  server = createServer({ database, frontendDir });
  let base = await listen(server);
  async function request(path, body, options = {}) {
    const response = await fetch(base + path, body === undefined ? options : {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), ...options,
    });
    return { response, body: await response.json() };
  }
  async function countContracts() {
    const { rows } = await database.query('SELECT COUNT(*)::integer AS count FROM contrato');
    return rows[0].count;
  }
  let created;

  await t.test('health verifica la conexión y el catálogo usa los tipos esperados', async () => {
    const health = await request('/api/health');
    assert.equal(health.response.status, 200);
    assert.deepEqual(health.body, { status: 'ok', database: 'pglite' });
    const catalog = await request('/api/maquinaria');
    assert.equal(catalog.response.status, 200);
    assert.equal(catalog.body.length, 2);
    assert.deepEqual(catalog.body.map((row) => row.nombre), ['CAT 336', 'JCB 3CX']);
    assert.equal(typeof catalog.body[0].id, 'number');
    assert.equal(typeof catalog.body[0].tarifa_diaria, 'number');
    assert.equal(typeof catalog.body[0].disponible, 'boolean');
    assert.ok(catalog.body.every((row) => row.disponible && row.ubicacion === null));
  });

  await t.test('filtra por tipo y muestra equipos sin ciudad al buscar cualquier ciudad', async () => {
    const search = await request('/api/maquinaria?disponible=true&tipo=excavadora&ubicacion=Santa%20Ana');
    assert.equal(search.response.status, 200);
    assert.deepEqual(search.body.map((row) => row.id), [1]);
    const noType = await request('/api/maquinaria?disponible=true&ubicacion=Santa%20Ana');
    assert.deepEqual(noType.body.map((row) => row.id), [1, 2]);
    const none = await request('/api/maquinaria?disponible=true&tipo=Grua');
    assert.deepEqual(none.body, []);
  });

  await t.test('rechaza períodos incompletos, invertidos y fechas inexistentes en consultas', async () => {
    for (const query of [
      'fecha_inicio=2027-01-10', 'fecha_fin=2027-01-12',
      'fecha_inicio=2027-01-12&fecha_fin=2027-01-10',
      'fecha_inicio=2027-02-29&fecha_fin=2027-03-01',
      'fecha_inicio=2028-02-30&fecha_fin=2028-03-01',
      'fecha_inicio=0000-01-01&fecha_fin=2027-01-10',
      'fecha_inicio=2027-1-10&fecha_fin=2027-01-12',
      'tipo=' + 'a'.repeat(81), 'ubicacion=' + 'a'.repeat(101),
      'ubicacion=San%00Salvador', 'disponible=invalid',
    ]) {
      const result = await request(`/api/maquinaria?${query}`);
      assert.equal(result.response.status, 400, query);
      assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    }
    assert.equal(await countContracts(), 0);
  });

  await t.test('POST calcula días inclusivos y total y GET recupera el mismo contrato', async () => {
    const result = await request('/api/contratos', {
      ...valid, cliente: '  Cliente de prueba  ', ciudad: '  San Salvador  ', total: 1,
    });
    assert.equal(result.response.status, 201);
    created = result.body;
    assert.match(created.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual({ ...created, id: 'uuid' }, {
      id: 'uuid', maquinaria_id: 1, maquinaria_nombre: 'CAT 336', cliente: 'Cliente de prueba', ciudad: 'San Salvador',
      fecha_inicio: valid.fecha_inicio, fecha_fin: valid.fecha_fin,
      dias: 3, tarifa_diaria: 450, total: 1350, estado: 'CONFIRMADO',
    });
    assert.equal(result.response.headers.get('location'), `/api/contratos/${created.id}`);
    const read = await request(`/api/contratos/${created.id}`);
    assert.equal(read.response.status, 200);
    assert.deepEqual(read.body, created);
    const independent = await database.query('SELECT cliente, total FROM contrato WHERE id = $1', [created.id]);
    assert.equal(independent.rows[0].cliente, 'Cliente de prueba');
    assert.equal(Number(independent.rows[0].total), 1350);
    const machinery = await database.query('SELECT ubicacion, disponible FROM maquinaria WHERE id = 1');
    assert.deepEqual(machinery.rows[0], { ubicacion: 'San Salvador', disponible: true });
  });

  await t.test('la ciudad registrada permite filtrar y los parámetros se tratan como datos', async () => {
    const local = await request('/api/maquinaria?disponible=true&ubicacion=%20san%20salvador%20');
    assert.deepEqual(local.body.map((row) => row.id), [1, 2]);
    const another = await request('/api/maquinaria?disponible=true&ubicacion=Santa%20Ana');
    assert.deepEqual(another.body.map((row) => row.id), [2]);
    const combined = await request('/api/maquinaria?disponible=true&tipo=excavadora&ubicacion=Santa%20Ana');
    assert.deepEqual(combined.body, []);
    const injection = new URLSearchParams({ disponible: 'true', tipo: "Excavadora' OR 1=1 --" });
    const safe = await request(`/api/maquinaria?${injection}`);
    assert.deepEqual(safe.body, []);
    assert.equal((await database.query('SELECT COUNT(*)::integer AS count FROM maquinaria')).rows[0].count, 2);
  });

  await t.test('consulta excluye contratos solapados con extremos inclusivos y acepta el mismo día', async () => {
    for (const [fecha_inicio, fecha_fin] of [
      ['2027-01-10', '2027-01-12'], ['2027-01-09', '2027-01-10'],
      ['2027-01-12', '2027-01-13'], ['2027-01-08', '2027-01-15'],
      ['2027-01-11', '2027-01-11'],
    ]) {
      const result = await request(`/api/maquinaria?${new URLSearchParams({
        disponible: 'true', fecha_inicio, fecha_fin,
      })}`);
      assert.equal(result.response.status, 200);
      assert.deepEqual(result.body.map((row) => row.id), [2]);
    }
    for (const day of ['2027-01-09', '2027-01-13', '2028-02-29']) {
      const free = await request(`/api/maquinaria?fecha_inicio=${day}&fecha_fin=${day}`);
      assert.equal(free.response.status, 200);
      assert.deepEqual(free.body.map((row) => row.id), [1, 2]);
    }
    const allFilters = await request('/api/maquinaria?disponible=true&tipo=excavadora&ubicacion=San%20Salvador&fecha_inicio=2027-01-13&fecha_fin=2027-01-13');
    assert.deepEqual(allFilters.body.map((row) => row.id), [1]);
    assert.equal(await countContracts(), 1);
  });

  await t.test('datos inválidos y fechas inexistentes no insertan contratos', async () => {
    const initial = await countContracts();
    const invalidBodies = [
      null, [], {}, { ...valid, maquinaria_id: '1' }, { ...valid, maquinaria_id: 2_147_483_648 },
      { ...valid, cliente: ' ' }, { ...valid, cliente: 'a'.repeat(161) },
      { ...valid, ciudad: undefined }, { ...valid, ciudad: ' ' }, { ...valid, ciudad: 123 },
      { ...valid, ciudad: 'a'.repeat(101) }, { ...valid, ciudad: 'San\u0000Salvador' },
      { ...valid, cliente: 'Nombre\u0000' }, { ...valid, fecha_inicio: '2027-02-29' },
      { ...valid, fecha_inicio: '2028-02-30' }, { ...valid, fecha_inicio: '0000-01-01' },
      { ...valid, fecha_inicio: '2027-1-10' }, { ...valid, fecha_fin: '2027-01-09' },
    ];
    for (const body of invalidBodies) {
      const result = await request('/api/contratos', body);
      assert.equal(result.response.status, 400, JSON.stringify(body));
      assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    }
    assert.equal(await countContracts(), initial);
  });

  await t.test('JSON inválido, media type y tamaño se rechazan sin escribir datos', async () => {
    const initial = await countContracts();
    const broken = await request('/api/contratos', valid, { body: '{' });
    assert.equal(broken.response.status, 400);
    assert.equal(broken.body.error.code, 'INVALID_JSON');
    const wrongType = await request('/api/contratos', valid, { headers: { 'Content-Type': 'text/plain' } });
    assert.equal(wrongType.response.status, 415);
    const large = await request('/api/contratos', { ...valid, cliente: 'a'.repeat(20_000) });
    assert.equal(large.response.status, 413);
    assert.equal(await countContracts(), initial);
  });

  await t.test('maquinaria inexistente e inactiva fallan sin insertar', async () => {
    const initial = await countContracts();
    const unknown = await request('/api/contratos', { ...valid, maquinaria_id: 999 });
    assert.equal(unknown.response.status, 404);
    assert.equal(unknown.body.error.code, 'MACHINERY_NOT_FOUND');
    await database.query('UPDATE maquinaria SET disponible = FALSE WHERE id = 2');
    const completeCatalog = await request('/api/maquinaria');
    assert.deepEqual(completeCatalog.body.map((row) => row.id), [1, 2]);
    const activeCatalog = await request('/api/maquinaria?disponible=true');
    assert.deepEqual(activeCatalog.body.map((row) => row.id), [1]);
    const freePeriod = await request('/api/maquinaria?fecha_inicio=2027-04-01&fecha_fin=2027-04-02');
    assert.deepEqual(freePeriod.body.map((row) => row.id), [1]);
    const unavailable = await request('/api/contratos', { ...valid, maquinaria_id: 2 });
    assert.equal(unavailable.response.status, 409);
    assert.equal(unavailable.body.error.code, 'MACHINERY_UNAVAILABLE');
    await database.query('UPDATE maquinaria SET disponible = TRUE WHERE id = 2');
    assert.equal(await countContracts(), initial);
  });

  await t.test('solapamientos, incluidos extremos compartidos, se rechazan; el día posterior funciona', async () => {
    const initial = await countContracts();
    for (const [fecha_inicio, fecha_fin] of [
      ['2027-01-10', '2027-01-12'], ['2027-01-09', '2027-01-10'],
      ['2027-01-12', '2027-01-13'], ['2027-01-08', '2027-01-15'],
      ['2027-01-11', '2027-01-11'],
    ]) {
      const conflict = await request('/api/contratos', { ...valid, fecha_inicio, fecha_fin });
      assert.equal(conflict.response.status, 409);
      assert.equal(conflict.body.error.code, 'DATE_CONFLICT');
    }
    assert.equal(await countContracts(), initial);
    const next = await request('/api/contratos', { ...valid, fecha_inicio: '2027-01-13', fecha_fin: '2027-01-13' });
    assert.equal(next.response.status, 201);
    assert.equal(next.body.dias, 1);
    assert.equal(next.body.total, 450);
  });

  await t.test('dos solicitudes simultáneas para una máquina generan solo un contrato', async () => {
    const initial = await countContracts();
    const body = { ...valid, fecha_inicio: '2027-02-05', fecha_fin: '2027-02-08' };
    const results = await Promise.all([request('/api/contratos', body), request('/api/contratos', body)]);
    assert.deepEqual(results.map((result) => result.response.status).sort(), [201, 409]);
    assert.equal(await countContracts(), initial + 1);
  });

  await t.test('contratos posteriores actualizan ciudad de referencia; un conflicto no la cambia', async () => {
    const updated = await request('/api/contratos', {
      ...valid, ciudad: 'Santa Ana', fecha_inicio: '2027-04-03', fecha_fin: '2027-04-03',
    });
    assert.equal(updated.response.status, 201);
    assert.equal(updated.body.ciudad, 'Santa Ana');
    const conflict = await request('/api/contratos', {
      ...valid, ciudad: 'San Miguel', fecha_inicio: '2027-04-03', fecha_fin: '2027-04-03',
    });
    assert.equal(conflict.response.status, 409);
    const city = await database.query('SELECT ubicacion FROM maquinaria WHERE id = 1');
    assert.equal(city.rows[0].ubicacion, 'Santa Ana');
    const historical = await request(`/api/contratos/${created.id}`);
    assert.equal(historical.body.ciudad, 'San Salvador');
  });

  await t.test('fallar al registrar la ciudad revierte también el contrato', async () => {
    const initial = await countContracts();
    await database.exec(`ALTER TABLE maquinaria ADD CONSTRAINT test_city_rollback
      CHECK (ubicacion IS NULL OR ubicacion <> 'Ciudad rechazada')`);
    try {
      const failed = await request('/api/contratos', {
        ...valid, ciudad: 'Ciudad rechazada', fecha_inicio: '2027-05-01', fecha_fin: '2027-05-01',
      });
      assert.equal(failed.response.status, 500);
      assert.equal(await countContracts(), initial);
      const machine = await database.query('SELECT ubicacion FROM maquinaria WHERE id = 1');
      assert.equal(machine.rows[0].ubicacion, 'Santa Ana');
    } finally {
      await database.exec('ALTER TABLE maquinaria DROP CONSTRAINT test_city_rollback');
    }
  });

  await t.test('una transacción fallida revierte todas sus escrituras y permite la siguiente', async () => {
    const initial = (await database.query('SELECT tarifa_diaria FROM maquinaria WHERE id = 1')).rows[0].tarifa_diaria;
    await assert.rejects(database.transaction(async (tx) => {
      await tx.query('UPDATE maquinaria SET tarifa_diaria = 999 WHERE id = 1');
      await tx.query('UPDATE maquinaria SET tarifa_diaria = -1 WHERE id = 2');
    }));
    const price = (await database.query('SELECT tarifa_diaria FROM maquinaria WHERE id = 1')).rows[0].tarifa_diaria;
    assert.equal(price, initial);
    const after = await request('/api/contratos', {
      ...valid, maquinaria_id: 2, fecha_inicio: '2028-02-29', fecha_fin: '2028-03-01',
    });
    assert.equal(after.response.status, 201);
    assert.equal(after.body.dias, 2);
    assert.equal(after.body.total, 550);
  });

  await t.test('sirve el frontend con seguridad de ruta y métodos HTTP', async () => {
    const index = await fetch(base + '/');
    assert.equal(index.status, 200);
    assert.match(await index.text(), /Constructora/);
    const head = await fetch(base + '/', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal(head.headers.get('x-content-type-options'), 'nosniff');
    const traversal = await fetch(base + '/%2e%2e%2fpostgres/PG_VERSION');
    assert.equal(traversal.status, 404);
    const wrongMethod = await request('/api/maquinaria', {});
    assert.equal(wrongMethod.response.status, 405);
    const missing = await request('/api/no-existe');
    assert.equal(missing.response.status, 404);
    const invalidId = await request('/api/contratos/no-es-uuid');
    assert.equal(invalidId.response.status, 400);
  });

  await t.test('cerrar y reabrir PostgreSQL mantiene los contratos y las semillas son idempotentes', async () => {
    const initialCount = await countContracts();
    await database.query('UPDATE maquinaria SET tarifa_diaria = 460 WHERE id = 1');
    await closeServer(server);
    await database.close();
    database = undefined;
    database = await createDatabase({ connectionString: '', dataDir, production: false });
    await initializeDatabase(database);
    await initializeDatabase(database);
    assert.equal(await countContracts(), initialCount);
    const catalog = await database.query('SELECT id, tarifa_diaria, ubicacion FROM maquinaria ORDER BY id');
    assert.equal(catalog.rows.length, 2);
    assert.equal(Number(catalog.rows[0].tarifa_diaria), 460);
    assert.equal(catalog.rows[0].ubicacion, 'Santa Ana');
    server = createServer({ database, frontendDir });
    base = await listen(server);
    const persisted = await request(`/api/contratos/${created.id}`);
    assert.equal(persisted.response.status, 200);
    assert.deepEqual(persisted.body, created);
  });
});

test('la actualización de esquema conserva equipos y contratos históricos sin inventar ciudades', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'constructora-upgrade-'));
  const database = await createDatabase({ connectionString: '', dataDir: join(folder, 'postgres'), production: false });
  t.after(async () => {
    await database.close();
    await rm(folder, { recursive: true, force: true });
  });
  // Sprint 0 database shape, before either city column existed.
  await database.exec(`
    CREATE TABLE maquinaria (
      id INTEGER PRIMARY KEY, nombre VARCHAR(120) NOT NULL, tipo VARCHAR(80) NOT NULL,
      descripcion TEXT NOT NULL, tarifa_diaria NUMERIC(12, 2) NOT NULL CHECK (tarifa_diaria > 0),
      disponible BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE TABLE contrato (
      id UUID PRIMARY KEY,
      maquinaria_id INTEGER NOT NULL REFERENCES maquinaria(id) ON DELETE RESTRICT,
      maquinaria_nombre VARCHAR(120) NOT NULL,
      cliente VARCHAR(160) NOT NULL CHECK (length(trim(cliente)) >= 2),
      fecha_inicio DATE NOT NULL, fecha_fin DATE NOT NULL,
      dias INTEGER NOT NULL CHECK (dias > 0),
      tarifa_diaria NUMERIC(12, 2) NOT NULL CHECK (tarifa_diaria > 0),
      total NUMERIC(14, 2) NOT NULL CHECK (total > 0),
      estado VARCHAR(20) NOT NULL DEFAULT 'CONFIRMADO' CHECK (estado = 'CONFIRMADO'),
      creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (fecha_fin >= fecha_inicio), CHECK (dias = fecha_fin - fecha_inicio + 1),
      CHECK (total = dias * tarifa_diaria)
    );
    INSERT INTO maquinaria VALUES (1, 'Equipo existente', 'Excavadora', 'Datos del equipo', 999, FALSE);
    INSERT INTO contrato
      (id, maquinaria_id, maquinaria_nombre, cliente, fecha_inicio, fecha_fin, dias, tarifa_diaria, total)
      VALUES ('00000000-0000-4000-8000-000000000099', 1, 'Equipo existente', 'Cliente histórico',
        '2026-10-01', '2026-10-02', 2, 999, 1998);
  `);
  await initializeDatabase(database);
  await initializeDatabase(database);
  const machine = (await database.query('SELECT nombre, tarifa_diaria, disponible, ubicacion FROM maquinaria WHERE id = 1')).rows[0];
  assert.deepEqual({ ...machine, tarifa_diaria: Number(machine.tarifa_diaria) }, {
    nombre: 'Equipo existente', tarifa_diaria: 999, disponible: false, ubicacion: null,
  });
  const contracts = (await database.query(`SELECT cliente, fecha_inicio::text, fecha_fin::text,
    dias, total, ciudad FROM contrato`)).rows;
  assert.equal(contracts.length, 1);
  assert.deepEqual({ ...contracts[0], total: Number(contracts[0].total) }, {
    cliente: 'Cliente histórico', fecha_inicio: '2026-10-01', fecha_fin: '2026-10-02', dias: 2, total: 1998, ciudad: null,
  });
  await database.query('UPDATE maquinaria SET ubicacion = $1 WHERE id = 1', ['San Miguel']);
  await initializeDatabase(database);
  assert.equal((await database.query('SELECT ubicacion FROM maquinaria WHERE id = 1')).rows[0].ubicacion, 'San Miguel');
});

test('health y errores internos nunca exponen credenciales', async (t) => {
  const secret = 'postgresql://usuario:password@privado.example/db';
  const logged = [];
  const server = createServer({
    database: { provider: 'postgresql', query: async () => { throw new Error(secret); } },
    logger: { error: (...args) => logged.push(args) },
  });
  const base = await listen(server);
  t.after(() => closeServer(server));
  const health = await fetch(base + '/api/health');
  assert.equal(health.status, 503);
  assert.equal((await health.json()).error.code, 'DATABASE_UNAVAILABLE');
  const catalog = await fetch(base + '/api/maquinaria');
  assert.equal(catalog.status, 500);
  assert.equal((await catalog.json()).error.code, 'INTERNAL_ERROR');
  assert.ok(!JSON.stringify(logged).includes(secret));
});

test('producción exige PostgreSQL remoto y no inicia persistencia efímera', async () => {
  await assert.rejects(createDatabase({ connectionString: '', production: true }), /DATABASE_URL es obligatoria/);
});
