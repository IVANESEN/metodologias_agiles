import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createDatabase, initializeDatabase } from './database.mjs';
import { createServer, validateContract, saveContract } from './app.mjs';
import { hoyElSalvador, validarDias, buscarPorVencer, DIAS_POR_DEFECTO } from './contratos-por-vencer.mjs';

const base = {
  cliente: 'Constructora Ñandú S.A. de C.V.', ciudad: 'Santa Ana', operador: 'José Ernesto Pérez',
  seguro: 'TODO_RIESGO', forma_pago: 'TRANSFERENCIA',
};

// Suma días a una fecha 'AAAA-MM-DD' sin depender de la zona del equipo.
function sumarDias(fecha, dias) {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

test('hoyElSalvador usa la zona America/El_Salvador y no la fecha UTC', () => {
  assert.equal(hoyElSalvador(new Date('2031-03-02T03:30:00Z')), '2031-03-01');
  assert.equal(hoyElSalvador(new Date('2031-03-02T06:00:00Z')), '2031-03-02');
  assert.equal(hoyElSalvador(new Date('2031-03-02T05:59:59Z')), '2031-03-01');
});

test('validarDias acepta enteros de 1 a 365 y usa 7 si no viene', () => {
  assert.equal(DIAS_POR_DEFECTO, 7);
  assert.deepEqual(validarDias(null), { dias: 7 });
  for (const valido of ['1', '30', '365']) assert.deepEqual(validarDias(valido), { dias: Number(valido) });
  for (const invalido of ['abc', '0', '-1', '366', '1.5', '', '07', ' 7', '1e2']) {
    assert.ok(validarDias(invalido).error, `debe rechazar ${JSON.stringify(invalido)}`);
  }
});

test('HU4a: contratos por vencer', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'contratos-por-vencer-'));
  const database = await createDatabase({ connectionString: '', dataDir: join(folder, 'pg'), production: false });
  await initializeDatabase(database);
  const server = createServer({ database, logger: {} });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await database.close();
    await rm(folder, { recursive: true, force: true });
  });
  // Las ventanas de fechas no se solapan por máquina, porque la HU8 rechaza
  // dos contratos de la misma máquina en fechas que se cruzan.
  const guardar = async (cliente, maquinaria_ids, fecha_inicio, fecha_fin) =>
    (await saveContract(database, validateContract({ ...base, cliente, maquinaria_ids, fecha_inicio, fecha_fin }))).id;
  const crear = async (cliente, maquinaria_ids, fecha_inicio, fecha_fin) => {
    const response = await fetch(`${url}/api/contratos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, cliente, maquinaria_ids, fecha_inicio, fecha_fin }),
    });
    assert.equal(response.status, 201);
    return (await response.json()).id;
  };
  const porVencer = async (query = '') => {
    const response = await fetch(`${url}/api/contratos/por-vencer${query}`);
    return { response, body: await response.json() };
  };

  await t.test('límites con hoy fijo: incluye hoy y hoy + N, excluye ayer y N + 1', async () => {
    await guardar('vence ayer', [1], '2031-03-01', '2031-03-09');
    await guardar('vence hoy', [2], '2031-03-05', '2031-03-10');
    await guardar('vence en N, aún no inicia', [1], '2031-03-12', '2031-03-17');
    await guardar('vence en N + 1', [2], '2031-03-12', '2031-03-18');
    const lista = await buscarPorVencer(database, { hoy: '2031-03-10', dias: 7 });
    assert.deepEqual(lista.map((c) => [c.cliente, c.fecha_fin, c.dias_restantes]), [
      ['vence hoy', '2031-03-10', 0],
      ['vence en N, aún no inicia', '2031-03-17', 7],
    ]);
    assert.equal(lista[1].fecha_inicio, '2031-03-12');
  });

  await t.test('cruce de año: hoy 2031-12-28 y N = 5 incluye el que vence el 2032-01-02', async () => {
    await guardar('cruce de año', [1, 2], '2031-12-30', '2032-01-02');
    const lista = await buscarPorVencer(database, { hoy: '2031-12-28', dias: 5 });
    assert.equal(lista.length, 1);
    assert.equal(lista[0].cliente, 'cruce de año');
    assert.equal(lista[0].dias_restantes, 5);
    assert.deepEqual(lista[0].maquinarias.map((m) => m.maquinaria_nombre), ['CAT 336', 'JCB 3CX']);
  });

  // Con el reloj real. Si se corre justo a medianoche de El Salvador, la prueba
  // y el servidor podrían calcular días distintos por milisegundos.
  const hoy = hoyElSalvador();
  let cercano;
  await t.test('HTTP: lista el que vence en 2 días con sus datos de la base y omite el lejano', async () => {
    cercano = await crear('Cliente cercano', [1, 2], hoy, sumarDias(hoy, 2));
    await crear('Cliente lejano', [1], sumarDias(hoy, 50), sumarDias(hoy, 60));
    const { response, body } = await porVencer();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(body.hoy, hoy);
    assert.equal(body.dias, 7);
    assert.deepEqual(body.contratos.map((c) => c.cliente), ['Cliente cercano']);
    const [item] = body.contratos;
    const registro = await (await fetch(`${url}/api/contratos/${cercano}`)).json();
    assert.equal(item.id, registro.id);
    assert.equal(item.cliente, registro.cliente);
    assert.equal(item.ciudad, registro.ciudad);
    assert.equal(item.fecha_inicio, registro.fecha_inicio);
    assert.equal(item.fecha_fin, registro.fecha_fin);
    assert.equal(item.dias_restantes, 2);
    assert.deepEqual(item.maquinarias.map((m) => m.maquinaria_nombre),
      registro.maquinarias.map((m) => m.maquinaria_nombre));
    assert.equal(item.maquinarias.length, 2);
  });

  await t.test('?dias=N cambia el umbral', async () => {
    assert.deepEqual((await porVencer('?dias=1')).body.contratos, []);
    assert.equal((await porVencer('?dias=2')).body.contratos.length, 1);
    assert.equal((await porVencer('?dias=365')).body.dias, 365);
  });

  await t.test('dias inválido responde 400 JSON con error.fields.dias', async () => {
    for (const valor of ['abc', '0', '-1', '366', '1.5']) {
      const { response, body } = await porVencer(`?dias=${valor}`);
      assert.equal(response.status, 400, valor);
      assert.match(response.headers.get('content-type'), /^application\/json/);
      assert.equal(body.error.code, 'VALIDATION_ERROR');
      assert.ok(body.error.fields.dias, `falta fields.dias para ${valor}`);
    }
  });

  await t.test('refresco: la siguiente petición incluye un contrato nuevo que cumple el umbral', async () => {
    const antes = await porVencer();
    assert.equal(antes.body.contratos.length, 1);
    const nuevo = await crear('Cliente nuevo', [2], sumarDias(hoy, 4), sumarDias(hoy, 5));
    const despues = await porVencer();
    assert.equal(despues.response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(despues.body.contratos.map((c) => [c.id, c.dias_restantes]), [[cercano, 2], [nuevo, 5]]);
  });

  await t.test('la ruta va antes del GET por ID y los otros métodos dan 405', async () => {
    const { response, body } = await porVencer();
    assert.equal(response.status, 200);
    assert.notEqual(body.error?.code, 'INVALID_ID');
    const post = await fetch(`${url}/api/contratos/por-vencer`, { method: 'POST' });
    assert.equal(post.status, 405);
  });
});
