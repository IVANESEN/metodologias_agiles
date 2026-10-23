import test from 'node:test';
import assert from 'node:assert/strict';
import { createCobrosStore } from '../frontend/cobros.mjs';

const contract = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', cliente: 'Cliente pendiente',
  total: 450, total_pagado: 0, saldo_pendiente: 450, estado_pago: 'PENDIENTE',
  estado: 'CONFIRMADO', fecha_inicio: '2035-01-01', fecha_fin: '2035-01-01',
};
const paymentIds = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
];
const copy = value => structuredClone(value);

function paymentResponse(account, body) {
  return { pago: { id: body.id, contrato_id: account.id, monto: Number(body.monto) }, contrato: account };
}

test('cobros UI: carga los pendientes y conserva separados el estado de pago y operativo', async () => {
  const paid = { ...contract, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', saldo_pendiente: 0, total_pagado: 450, estado_pago: 'PAGADO' };
  const calls = [];
  let changes = 0;
  const store = createCobrosStore({
    request: async (path, options) => { calls.push({ path, options }); return copy([contract, paid]); },
    createId: () => paymentIds[0], onChange: () => { changes++; },
  });
  assert.equal(await store.load(), true);
  const state = store.getSnapshot();
  assert.equal(state.loaded, true);
  assert.equal(state.loading, false);
  assert.equal(state.error, '');
  assert.deepEqual(state.contracts, [contract]);
  assert.equal(state.contracts[0].estado, 'CONFIRMADO');
  assert.equal(calls[0].path, '/api/cobros');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.ok(changes >= 2, 'notifica el comienzo y el resultado de la carga');
});

test('cobros UI: el pago parcial actualiza automáticamente el saldo visible', async () => {
  const calls = [];
  const updated = { ...contract, total_pagado: 125.25, saldo_pendiente: 324.75 };
  const store = createCobrosStore({
    createId: () => paymentIds[0],
    request: async (path, options) => {
      calls.push({ path, options });
      if (path === '/api/cobros') return copy([contract]);
      return paymentResponse(copy(updated), JSON.parse(options.body));
    },
  });
  await store.load();
  store.setAmount(contract.id, '125.25');
  assert.equal(await store.pay(contract.id), true);
  const state = store.getSnapshot();
  assert.deepEqual(state.contracts, [updated]);
  assert.equal(state.payingId, null);
  assert.equal(state.error, '');
  assert.ok(state.notice, 'confirma el registro del pago');
  assert.equal(calls.filter(call => call.path === '/api/cobros').length, 1, 'el pago actualiza la vista sin una carga manual');
  assert.equal(calls[1].path, `/api/contratos/${contract.id}/pagos`);
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].options.body), { id: paymentIds[0], monto: '125.25' });
});

test('cobros UI: el pago completo retira el contrato y deja el listado vacío', async () => {
  const updated = { ...contract, total_pagado: 450, saldo_pendiente: 0, estado_pago: 'PAGADO' };
  const store = createCobrosStore({
    createId: () => paymentIds[0],
    request: async (path, options) => path === '/api/cobros'
      ? copy([contract]) : paymentResponse(copy(updated), JSON.parse(options.body)),
  });
  await store.load();
  assert.equal(await store.pay(contract.id, '450.00'), true);
  const state = store.getSnapshot();
  assert.deepEqual(state.contracts, []);
  assert.equal(state.loaded, true);
  assert.equal(state.loading, false);
  assert.equal(state.payingId, null);
  assert.ok(state.notice);
});

test('cobros UI: un error al guardar conserva saldo y monto, y el reintento usa el mismo ID', async () => {
  let attempts = 0, ids = 0;
  const bodies = [];
  const updated = { ...contract, total_pagado: 100.1, saldo_pendiente: 349.9 };
  const store = createCobrosStore({
    createId: () => paymentIds[ids++],
    request: async (path, options) => {
      if (path === '/api/cobros') return copy([contract]);
      bodies.push(JSON.parse(options.body));
      if (attempts++ === 0) throw new Error('No fue posible guardar el pago.');
      return paymentResponse(copy(updated), bodies.at(-1));
    },
  });
  await store.load();
  store.setAmount(contract.id, '100.10');
  assert.equal(await store.pay(contract.id), false);
  let state = store.getSnapshot();
  assert.deepEqual(state.contracts, [contract]);
  assert.equal(state.drafts[contract.id].amount, '100.10');
  assert.equal(state.payingId, null);
  assert.ok(state.error || state.drafts[contract.id].error, 'expone el error de registro');
  assert.equal(await store.pay(contract.id), true);
  state = store.getSnapshot();
  assert.deepEqual(state.contracts, [updated]);
  assert.deepEqual(bodies[0], bodies[1], 'reintentar una respuesta perdida no debe crear otro cobro');
  assert.equal(ids, 1);
});

test('cobros UI: cambiar el importe tras un error genera un nuevo ID de pago', async () => {
  let ids = 0;
  const bodies = [];
  const store = createCobrosStore({
    createId: () => paymentIds[ids++],
    request: async (path, options) => {
      if (path === '/api/cobros') return copy([contract]);
      bodies.push(JSON.parse(options.body));
      throw new Error('Error de red');
    },
  });
  await store.load();
  store.setAmount(contract.id, '10.00');
  await store.pay(contract.id);
  store.setAmount(contract.id, '15.00');
  await store.pay(contract.id);
  assert.notEqual(bodies[0].id, bodies[1].id);
  assert.deepEqual(store.getSnapshot().contracts, [contract]);
});

test('cobros UI: no envía cero, negativos, sobrepagos ni más de dos decimales', async () => {
  let posts = 0;
  const store = createCobrosStore({
    createId: () => paymentIds[0],
    request: async (path) => {
      if (path === '/api/cobros') return copy([contract]);
      posts++;
      throw new Error('No debe enviar datos inválidos');
    },
  });
  await store.load();
  for (const amount of ['', '0', '-1', '450.01', '1.001', 'abc']) {
    store.setAmount(contract.id, amount);
    assert.equal(await store.pay(contract.id), false, amount);
    assert.deepEqual(store.getSnapshot().contracts, [contract]);
    assert.ok(store.getSnapshot().drafts[contract.id].error, amount);
  }
  assert.equal(posts, 0);
});

test('cobros UI: una carga vacía termina correctamente y permite mostrar el mensaje sin pendientes', async () => {
  const store = createCobrosStore({ request: async () => [] });
  assert.equal(await store.load(), true);
  const state = store.getSnapshot();
  assert.deepEqual(state.contracts, []);
  assert.equal(state.loaded, true);
  assert.equal(state.loading, false);
  assert.equal(state.error, '');
});

test('cobros UI: fallar al actualizar el listado conserva la información anterior', async () => {
  let attempts = 0;
  const store = createCobrosStore({
    request: async () => {
      if (attempts++ === 0) return copy([contract]);
      throw new Error('No se pudo consultar los cobros');
    },
  });
  await store.load();
  assert.equal(await store.load(), false);
  const state = store.getSnapshot();
  assert.deepEqual(state.contracts, [contract]);
  assert.equal(state.loading, false);
  assert.ok(state.error);
});
