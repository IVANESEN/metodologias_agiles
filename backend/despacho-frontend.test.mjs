import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../frontend/despacho.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
test('HU9b: la interfaz distingue falta de envío, fallo y confirmación del canal', async () => {
  const context = vm.createContext({ sessionReady: Promise.resolve(false), hasPermission: () => false });
  const format = await vm.runInContext(`(async()=>{ ${source}; return estadoDespacho; })()`, context);
  assert.match(format(null), /aún no/);
  assert.match(format({ estado: 'FALLIDO', intentos: 2, ultimo_error: 'Canal sin configurar' }), /Canal sin configurar.*2/);
  assert.match(format({ estado: 'ENVIADO', intentos: 3, proveedor_id: 'acuse-prueba' }), /acuse-prueba.*3/);
});

test('HU9b: un fallo del envío se muestra y el reintento reutiliza el contrato vigente', async () => {
  const handlers = new Map();
  const elements = Object.fromEntries(['despacho-estado', 'despacho-error', 'despacho-enviar', 'despacho-actualizar'].map(id => [id, {
    textContent: '', hidden: false, disabled: false, addEventListener(name, fn) { handlers.set(`${id}:${name}`, fn); },
  }]));
  const events = new Map();
  const calls = [];
  let notification = null;
  const entrega = { fecha_entrega: '2040-01-10', hora_desde: '08:00', hora_hasta: '10:00', transportista: 'Destino simulado' };
  const context = vm.createContext({
    sessionReady: Promise.resolve(true), hasPermission: () => true, console,
    document: { getElementById: id => elements[id] },
    window: { addEventListener: (name, fn) => events.set(name, fn) },
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      let body;
      if (options.method === 'POST') {
        const retry = JSON.parse(options.body).reintentar;
        notification = { id: 'revision-vigente', estado: retry ? 'ENVIADO' : 'FALLIDO', intentos: retry ? 2 : 1,
          ultimo_error: retry ? null : 'Fallo simulado verificable', proveedor_id: retry ? 'acuse-1' : null, orden: { entrega } };
        body = { notificacion: notification };
      } else body = url.endsWith('/entrega') ? { estado: 'PROGRAMADA', entrega }
        : { notificaciones: notification ? [notification] : [], vigente_id: 'revision-vigente' };
      return { ok: true, json: async () => body };
    },
  });
  await vm.runInContext(`(async()=>{ ${source} })()`, context);
  events.get('contrato-mostrado')({ detail: { id: 'contrato-prueba' } });
  await new Promise(resolve => setImmediate(resolve));
  await handlers.get('despacho-enviar:click')();
  assert.match(elements['despacho-estado'].textContent, /Fallo simulado verificable/);
  assert.equal(elements['despacho-enviar'].textContent, 'Reintentar orden de despacho');
  await handlers.get('despacho-enviar:click')();
  assert.match(elements['despacho-estado'].textContent, /acuse-1/);
  assert.equal(elements['despacho-enviar'].disabled, true);
  const posts = calls.filter(c => c.options.method === 'POST');
  assert.deepEqual(posts.map(p => p.url), ['/api/contratos/contrato-prueba/despacho', '/api/contratos/contrato-prueba/despacho']);
  assert.deepEqual(posts.map(p => JSON.parse(p.options.body).reintentar), [false, true]);
});
