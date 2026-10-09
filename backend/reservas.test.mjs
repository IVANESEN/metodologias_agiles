import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, initializeDatabase } from './database.mjs';
import { createServer } from './app.mjs';

test('HU8: las reservas confirmadas bloquean fechas', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'hu8-reservas-'));
  let database;
  let server;

  t.after(async () => {
    if (server?.listening) {
      await new Promise((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve())
      );
    }
    await database?.close();
    await rm(folder, { recursive: true, force: true });
  });

  database = await createDatabase({
    connectionString: '',
    dataDir: join(folder, 'postgres'),
    production: false
  });

  await initializeDatabase(database);

  server = createServer({ database });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  const base = `http://127.0.0.1:${server.address().port}`;
  const ruta = '/api/reservas/ocupadas?maquinaria_id=1';

  const inicial = await fetch(base + ruta);
  assert.equal(inicial.status, 200);
  assert.deepEqual(await inicial.json(), []);

  const reserva = await fetch(base + '/api/contratos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      maquinaria_id: 1,
      cliente: 'Cliente Sprint 1',
      fecha_inicio: '2027-02-10',
      fecha_fin: '2027-02-12'
    })
  });

  assert.equal(reserva.status, 201);

  const ocupadas = await fetch(base + ruta);
  assert.equal(ocupadas.status, 200);
  assert.deepEqual(await ocupadas.json(), [
    {
      fecha_inicio: '2027-02-10',
      fecha_fin: '2027-02-12'
    }
  ]);

  const conflicto = await fetch(base + '/api/contratos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      maquinaria_id: 1,
      cliente: 'Segundo cliente',
      fecha_inicio: '2027-02-11',
      fecha_fin: '2027-02-13'
    })
  });

  assert.equal(conflicto.status, 409);
  const error = await conflicto.json();
  assert.equal(error.error.code, 'DATE_CONFLICT');
});
