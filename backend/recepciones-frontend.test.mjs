import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../frontend/recepcion.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const context = vm.createContext({
  Promise, Error, TypeError, JSON, Number, String, Array, Set, Map, RegExp,
  sessionReady: Promise.resolve(false), hasPermission: () => false, requirePermission: () => false,
});
const { validateReceptionDraft, createReceptionStore } = await vm.runInContext(
  `(async () => { ${source}\nreturn { validateReceptionDraft, createReceptionStore }; })()`, context,
  { filename: 'recepcion.js' },
);

const contractId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const receiptId = '11111111-1111-4111-8111-111111111111';
const nextReceiptId = '22222222-2222-4222-8222-222222222222';
const photo = 'data:image/png;base64,iVBORw0KGgo=';
const contract = {
  id: contractId, cliente: 'Cliente HU10',
  maquinarias: [{ maquinaria_id: 1, maquinaria_nombre: 'CAT 336' }],
};

test('HU10 UI: valida contrato, máquina, horómetro y cantidad de fotografías', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(validateReceptionDraft({
    contrato_id: contractId.toUpperCase(), maquinaria_id: '1', horometro: '0', fotos: [photo],
  }))), { contrato_id: contractId, maquinaria_id: 1, horometro: 0, fotos: [photo] });
  for (const [field, value] of [
    ['contrato_id', 'invalido'], ['maquinaria_id', ''], ['horometro', ''], ['horometro', '-1'], ['fotos', []],
    ['fotos', Array(6).fill(photo)],
  ]) {
    const draft = { contrato_id: contractId, maquinaria_id: '1', horometro: '10', fotos: [photo], [field]: value };
    assert.throws(() => validateReceptionDraft(draft), error => error.status === 400 && Boolean(error.fields[field]), field);
  }
});

test('HU10 UI: carga el contrato y sus evidencias sin mezclar identificadores', async () => {
  const calls = [];
  const saved = { id: receiptId, contrato_id: contractId, maquinaria_id: 1, maquinaria_nombre: 'CAT 336',
    horometro: 25, fotos: [photo], fecha_recepcion: '2040-01-10T12:00:00.000Z' };
  const store = createReceptionStore({
    request: async (path, options) => {
      calls.push({ path, options });
      return path.endsWith('/recepciones') ? { recepciones: [saved] } : contract;
    },
    createId: () => receiptId,
  });
  const state = await store.load(` ${contractId.toUpperCase()} `);
  assert.deepEqual(state.contract, contract);
  assert.deepEqual(state.receptions, [saved]);
  assert.deepEqual(calls.map(call => call.path), [
    `/api/contratos/${contractId}`, `/api/contratos/${contractId}/recepciones`,
  ]);
  assert.ok(calls.every(call => call.options.cache === 'no-store'));
});

test('HU10 UI: un fallo de red conserva el mismo ID para reintentar sin duplicar', async () => {
  const posts = [];
  let attempts = 0;
  const store = createReceptionStore({
    createId: () => receiptId,
    request: async (path, options) => {
      if (path === `/api/contratos/${contractId}`) return contract;
      if (path.endsWith('/recepciones') && path !== '/api/recepciones') return { recepciones: [] };
      const body = JSON.parse(options.body);
      posts.push(body);
      if (attempts++ === 0) throw new TypeError('sin conexión');
      return { ...body, maquinaria_nombre: 'CAT 336', fecha_recepcion: '2040-01-10T12:00:00.000Z' };
    },
  });
  await store.load(contractId);
  const draft = { contrato_id: contractId, maquinaria_id: '1', horometro: '25', fotos: [photo] };
  await assert.rejects(store.save(draft), TypeError);
  const saved = await store.save(draft);
  assert.equal(saved.id, receiptId);
  assert.deepEqual(posts[0], posts[1]);
  assert.equal(store.getSnapshot().receptions.length, 1);
});

test('HU10 UI: cambiar los datos tras un fallo genera otro ID y una máquina ajena no se envía', async () => {
  const ids = [receiptId, nextReceiptId];
  const posts = [];
  const store = createReceptionStore({
    createId: () => ids.shift(),
    request: async (path, options) => {
      if (path === `/api/contratos/${contractId}`) return contract;
      if (path.endsWith('/recepciones') && path !== '/api/recepciones') return { recepciones: [] };
      posts.push(JSON.parse(options.body));
      throw new TypeError('sin conexión');
    },
  });
  await store.load(contractId);
  await assert.rejects(store.save({ contrato_id: contractId, maquinaria_id: 1, horometro: 10, fotos: [photo] }));
  await assert.rejects(store.save({ contrato_id: contractId, maquinaria_id: 1, horometro: 11, fotos: [photo] }));
  assert.equal(posts[0].id, receiptId);
  assert.equal(posts[1].id, nextReceiptId);
  await assert.rejects(store.save({ contrato_id: contractId, maquinaria_id: 2, horometro: 11, fotos: [photo] }),
    error => Boolean(error.fields.maquinaria_id));
  assert.equal(posts.length, 2);
});
