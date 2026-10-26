import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import * as signatureData from '../frontend/firma-datos.mjs';

const html = await readFile(new URL('../frontend/index.html', import.meta.url), 'utf8');
const sources = Object.fromEntries(await Promise.all(['sesion.js', 'app.js', 'alertas.js', 'cobros.mjs', 'firma.js', 'recepcion.js', 'entrega.js'].map(async file => [file,
  (await readFile(new URL(`../frontend/${file}`, import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, ''),
])));
const commonPermissions = ['maquinaria.consultar', 'contratos.crear', 'contratos.consultar', 'contratos.documento', 'contratos.pdf', 'contratos.firmar', 'alertas.consultar', 'recepciones.crear', 'recepciones.consultar', 'entregas.consultar'];
const managerPermissions = [...commonPermissions, 'cobros.consultar', 'pagos.registrar', 'entregas.programar', 'gastos.aprobar', 'contratos.modificaciones.autorizar'];
const equipment = { id: 1, nombre: 'Excavadora', tipo: 'Excavadora', descripcion: 'Equipo de obra', ubicacion: null, tarifa_diaria: 450, disponible: true };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const turn = () => new Promise(resolve => setImmediate(resolve));

// DOM mínimo: ejecuta los módulos de producción, incluyendo sus listeners y solicitudes.
class Node {
  constructor(tag = '', text = '') {
    this.tagName = tag.toLowerCase(); this.children = []; this.attributes = {}; this.dataset = {}; this.events = new Map();
    this.text = text; this.hidden = false; this.disabled = false; this.value = ''; this.validity = { badInput: false };
    this.classList = { toggle() {} };
  }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.text = String(value); this.children = []; }
  get options() { return this.children.filter(node => node.tagName === 'option'); }
  get lastElementChild() { return this.children.at(-1); }
  append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
  replaceChildren(...children) { this.text = ''; this.children = []; this.append(...children); }
  after(child) { const siblings = this.parentNode.children; siblings.splice(siblings.indexOf(this) + 1, 0, child); child.parentNode = this.parentNode; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5)] = String(value);
    if (['id', 'name', 'type', 'value', 'class'].includes(name)) this[name === 'class' ? 'className' : name] = String(value);
    if (name === 'hidden') this.hidden = true;
  }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, callback) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(callback); }
  async dispatch(name, extra = {}) { for (const callback of this.events.get(name) || []) await callback({ preventDefault() {}, ...extra }); }
  querySelectorAll(selector) {
    const matches = node => selector.split(',').some(part => {
      const text = part.trim();
      if (text === '[data-permission]') return Boolean(node.dataset.permission);
      if (text === '[data-permission][id]') return Boolean(node.dataset.permission && node.id);
      if (text.startsWith('.')) return (node.className || '').split(' ').includes(text.slice(1));
      if (text.startsWith('#')) return node.id === text.slice(1);
      return node.tagName === text;
    });
    return this.children.flatMap(node => [...(matches(node) ? [node] : []), ...node.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolled = true; }
  reset() {}
  getContext() { return { fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} }; }
}

function documentFromHtml() {
  const document = new Node('document');
  document.createElement = tag => new Node(tag);
  document.createTextNode = text => new Node('#text', text);
  document.getElementById = id => document.querySelector(`#${id}`);
  document.visibilityState = 'visible';
  const stack = [document];
  const voidTags = new Set(['meta', 'link', 'input', 'br', 'img', 'hr']);
  for (const match of html.matchAll(/<\/?([a-z][\w:-]*)\b([^>]*)>/gi)) {
    const [, tag, attrs] = match;
    if (match[0].startsWith('</')) {
      const position = stack.findLastIndex(node => node.tagName === tag);
      if (position > 0) stack.length = position;
      continue;
    }
    const node = new Node(tag);
    for (const attribute of attrs.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) node.setAttribute(attribute[1], attribute[2] || '');
    stack.at(-1).append(node);
    if (!voidTags.has(tag)) stack.push(node);
  }
  return document;
}

function startPage({ permisos = commonPermissions, role = 'residente', hash = '', sessionStatus = 200, sessionError = false,
  delaySession = false, onRequest = () => undefined } = {}) {
  const document = documentFromHtml();
  const calls = [], redirects = [], intervals = [];
  let reloads = 0, releaseSession;
  const sessionGate = delaySession ? new Promise(resolve => { releaseSession = resolve; }) : Promise.resolve();
  const location = new URL(`http://localhost/${hash}`);
  location.replace = target => { redirects.push(target); };
  location.reload = () => { reloads++; };
  const events = new Node('window');
  const context = vm.createContext({ document, location, URL, URLSearchParams, Request, Response, AbortController,
    Intl, Date, Map, Set, Error, TypeError, crypto: webcrypto, ...signatureData,
    setTimeout: callback => { intervals.push(callback); return intervals.length; }, clearTimeout() {},
    setInterval: callback => { intervals.push(callback); return intervals.length; },
    addEventListener: events.addEventListener.bind(events),
    // HU9a: app.js avisa el contrato mostrado con un CustomEvent sobre window.
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    dispatchEvent: event => { events.dispatch(event.type, { detail: event.detail }); return true; },
    matchMedia: () => ({ matches: false }),
    history: { replaceState: (_, __, url) => { location.href = new URL(url, location).href; } },
    Option: function(text, value) { const option = new Node('option', text); option.value = value; return option; },
    fetch: async (path, init = {}) => {
      calls.push({ path: String(path), init });
      if (path === '/api/auth/sesion') {
        await sessionGate;
        if (sessionError) throw new TypeError('desconectado');
        return response({ nombre: 'Usuario de prueba', rol: role, permisos }, sessionStatus);
      }
      const custom = await onRequest(path, init);
      if (custom) return custom;
      if (String(path).startsWith('/api/maquinaria')) return response([equipment]);
      if (String(path).startsWith('/api/contratos/por-vencer')) return response({ contratos: [], dias: 7 });
      if (path === '/api/cobros') return response([]);
      if (path.endsWith('/documento')) return response({ titulo: 'Contrato', clausulas: [] });
      if (path.endsWith('/entrega')) return response({ estado: 'SIN_PROGRAMAR', entrega: null });
      if (path === '/api/auth/logout') return response({ ok: true });
      throw new Error(`Solicitud inesperada: ${path}`);
    },
  });
  context.window = context;
  const evaluate = (file, returned = '') => vm.runInContext(`(async () => { ${sources[file]}\n${returned} })()`, context, { filename: file });
  const ready = (async () => {
    Object.assign(context, await evaluate('sesion.js', 'return {sessionReady, hasPermission, requirePermission, showPermissionNotice};'));
    Object.assign(context, await evaluate('firma.js', 'return {createSignaturePanel};'));
    Object.assign(context, await evaluate('cobros.mjs', 'return {createCobrosPanel};'));
    await Promise.all([evaluate('app.js'), evaluate('alertas.js'), evaluate('recepcion.js'), evaluate('entrega.js')]);
    await turn();
  })();
  return { document, calls, redirects, intervals, context, location, events, ready,
    releaseSession: () => releaseSession?.(), reloads: () => reloads };
}

test('HU2 UI: HTML oculta controles y módulos esperan una única sesión antes de solicitar datos', async () => {
  const page = startPage({ delaySession: true });
  await turn();
  assert.equal(page.document.querySelector('main').hidden, true);
  assert.ok(page.document.querySelectorAll('[data-permission]').every(node => node.hidden));
  assert.deepEqual(page.calls.map(call => call.path), ['/api/auth/sesion']);
  assert.equal(page.document.getElementById('booking-form').events.has('submit'), false, 'no inicializa el formulario durante la sesión pendiente');
  assert.equal(page.intervals.length, 0, 'no inicializa refrescos de alertas durante la sesión pendiente');
  page.releaseSession();
  await page.ready;
  assert.equal(page.calls.filter(call => call.path === '/api/auth/sesion').length, 1);
});

test('HU2 UI: residente oculta Cobros, no hace su solicitud y corrige enlaces directos iniciales y posteriores', async () => {
  const page = startPage({ hash: '#cobros' });
  await page.ready;
  assert.equal(page.document.querySelector('main').hidden, false);
  assert.equal(page.document.getElementById('cobros').hidden, true);
  assert.equal(page.document.getElementById('recepcion').hidden, false);
  assert.equal(page.document.querySelectorAll('[data-permission]').find(node => node.attributes.href === '#cobros').hidden, true);
  assert.equal(page.calls.some(call => call.path === '/api/cobros'), false);
  assert.ok(page.calls.some(call => call.path.startsWith('/api/maquinaria')));
  assert.ok(page.calls.some(call => call.path.startsWith('/api/contratos/por-vencer')));
  assert.equal(page.location.hash, '#catalogo');
  assert.match(page.document.getElementById('permission-notice').textContent, /No tienes permiso/);
  page.location.hash = '#cobros';
  await page.events.dispatch('hashchange');
  assert.equal(page.location.hash, '#catalogo');
  assert.deepEqual(page.redirects, []);
});

for (const hash of ['#cobros-title', '#cobros-list', '#%63obros', '#%63obros-title']) {
  test(`HU2 UI: residente rechaza el enlace directo ${hash} y sus descendientes sin cargar Cobros`, async () => {
    const page = startPage({ hash });
    await page.ready;
    assert.equal(page.location.hash, '#catalogo');
    assert.equal(page.document.getElementById('cobros').hidden, true);
    assert.match(page.document.getElementById('permission-notice').textContent, /No tienes permiso/);
    assert.equal(page.calls.some(call => call.path === '/api/cobros'), false);
    page.document.getElementById('permission-notice').hidden = true;
    page.location.hash = hash;
    await page.events.dispatch('hashchange');
    assert.equal(page.location.hash, '#catalogo');
    assert.equal(page.document.getElementById('permission-notice').hidden, false);
    assert.equal(page.calls.some(call => call.path === '/api/cobros'), false);
    assert.deepEqual(page.redirects, []);
  });
}

test('HU2 UI: gerente conserva enlaces autorizados a descendientes de Cobros', async () => {
  const page = startPage({ role: 'gerente', permisos: managerPermissions, hash: '#cobros-title' });
  await page.ready;
  assert.equal(page.location.hash, '#cobros-title');
  assert.equal(page.document.getElementById('cobros').hidden, false);
  assert.equal(page.calls.filter(call => call.path === '/api/cobros').length, 1);
  assert.equal(page.document.getElementById('permission-notice').hidden, true);
  page.location.hash = '#%63obros-list';
  await page.events.dispatch('hashchange');
  assert.equal(page.location.hash, '#%63obros-list');
  assert.equal(page.document.getElementById('permission-notice').hidden, true);
  assert.deepEqual(page.redirects, []);
});

test('HU2 UI: el permiso de un descendiente no permite acceder a su sección restringida', async () => {
  const page = startPage({ permisos: ['maquinaria.consultar', 'contratos.documento'], hash: '#contract-document' });
  await page.ready;
  assert.equal(page.location.hash, '#catalogo');
  assert.equal(page.document.getElementById('contrato').hidden, true);
  assert.match(page.document.getElementById('permission-notice').textContent, /No tienes permiso/);
  assert.ok(page.calls.slice(1).every(call => call.path.startsWith('/api/maquinaria')));
});

test('HU2 UI: un hash mal codificado no interrumpe la sesión ni las funciones autorizadas', async () => {
  const page = startPage({ hash: '#%E0%A4%A' });
  await page.ready;
  assert.equal(page.document.querySelector('main').hidden, false);
  assert.equal(page.context.hasPermission('maquinaria.consultar'), true);
  assert.ok(page.calls.some(call => call.path.startsWith('/api/maquinaria')));
  page.location.hash = '#%';
  await page.events.dispatch('hashchange');
  assert.equal(page.context.hasPermission('maquinaria.consultar'), true);
  assert.equal(page.calls.some(call => call.path === '/api/cobros'), false);
  assert.deepEqual(page.redirects, []);
});

test('HU2 UI: permisos del servidor controlan vistas aunque el campo rol diga gerente', async () => {
  const page = startPage({ role: 'gerente', permisos: ['maquinaria.consultar'] });
  await page.ready;
  assert.equal(page.document.getElementById('contrato').hidden, true);
  assert.equal(page.document.getElementById('booking-form').hidden, true);
  assert.equal(page.document.getElementById('signature-form').hidden, true);
  assert.equal(page.document.getElementById('alertas').hidden, true);
  assert.equal(page.document.getElementById('cobros').hidden, true);
  assert.equal(page.document.getElementById('recepcion').hidden, true);
  assert.ok(page.calls.slice(1).every(call => call.path.startsWith('/api/maquinaria')));
  assert.equal(page.intervals.length, 0);
  assert.ok(page.document.getElementById('equipment-grid').querySelector('button').hidden);
  await page.document.getElementById('booking-form').dispatch('submit');
  assert.equal(page.calls.some(call => call.init.method === 'POST'), false);
});

for (const [role, permisos, expectedLoads] of [['residente', commonPermissions, 0], ['gerente', managerPermissions, 2]]) {
  test(`HU2 UI: ${role} crea contrato y solo actualiza Cobros con permiso (inicial y posterior)`, async () => {
    const page = startPage({ role, permisos, onRequest(path, init) {
      if (path !== '/api/contratos' || init.method !== 'POST') return;
      const payload = JSON.parse(init.body);
      return response({ ...payload, id: 'contrato-prueba', estado: 'CONFIRMADO', dias: 1, maquinaria_id: 1,
        maquinaria_nombre: equipment.nombre, tarifa_diaria: 450, total: 450,
        maquinarias: [{ maquinaria_id: 1, maquinaria_nombre: equipment.nombre, tarifa_diaria: 450, total: 450 }] }, 201);
    } });
    await page.ready;
    assert.equal(page.document.getElementById('cobros').hidden, role !== 'gerente');
    await page.document.getElementById('select-equipment-1').dispatch('click');
    for (const [id, value] of Object.entries({ cliente: 'Cliente de prueba', ciudad: 'Santa Ana', operador: 'Operador de prueba',
      seguro: 'TODO_RIESGO', forma_pago: 'EFECTIVO', fecha_inicio: '2035-01-01', fecha_fin: '2035-01-01' })) page.document.getElementById(id).value = value;
    await page.document.getElementById('booking-form').dispatch('submit');
    await turn();
    assert.equal(page.document.getElementById('form-error').hidden, true, page.document.getElementById('form-error').textContent);
    assert.equal(page.document.getElementById('confirmation').hidden, false, 'creación autorizada llega a confirmación');
    assert.equal(page.calls.filter(call => call.path === '/api/contratos' && call.init.method === 'POST').length, 1);
    assert.equal(page.calls.filter(call => call.path === '/api/cobros').length, expectedLoads);
    assert.ok(page.document.getElementById('contract-pdf'));
    assert.deepEqual(page.redirects, []);
  });
}

for (const [role, permisos, puedeProgramar] of [['residente', commonPermissions, false], ['gerente', managerPermissions, true]]) {
  test(`HU9a UI: ${role} ve el estado de la entrega en el detalle ${puedeProgramar ? 'y puede programarla' : 'sin formulario'}`, async () => {
    const programada = { estado: 'PROGRAMADA', entrega: { contrato_id: 'contrato-prueba', fecha_entrega: '2035-01-01',
      hora_desde: '08:00', hora_hasta: '10:00', transportista: '<b>x</b> Fletes', actualizado_en: '2034-12-01T00:00:00.000Z' } };
    const page = startPage({ role, permisos, hash: '?contrato=contrato-prueba#contrato', onRequest(path, init) {
      if (path === '/api/contratos/contrato-prueba') {
        return response({ id: 'contrato-prueba', estado: 'CONFIRMADO', cliente: 'Cliente', ciudad: 'Santa Ana', dias: 1,
          fecha_inicio: '2035-01-01', fecha_fin: '2035-01-01', maquinaria_id: 1, maquinaria_nombre: equipment.nombre,
          tarifa_diaria: 450, total: 450, maquinarias: [{ maquinaria_id: 1, maquinaria_nombre: equipment.nombre, tarifa_diaria: 450, total: 450 }] });
      }
      if (path.endsWith('/entrega')) return response(programada);
      if (path === '/api/entregas' && init.method === 'POST') return response(programada);
    } });
    await page.ready;
    await turn();
    const seccion = page.document.getElementById('entrega');
    assert.equal(seccion.hidden, false);
    assert.equal(page.document.getElementById('entrega-form').hidden, !puedeProgramar);
    assert.ok(page.calls.some(call => call.path === '/api/contratos/contrato-prueba/entrega'));
    const estado = page.document.getElementById('entrega-estado').textContent;
    assert.match(estado, /^Programada: .*08:00–10:00, <b>x<\/b> Fletes$/);
    assert.equal(page.document.getElementById('entrega-estado').children.length, 0, 'el HTML del transportista queda como texto');
    await page.document.getElementById('entrega-form').dispatch('submit');
    assert.equal(page.calls.some(call => call.path === '/api/entregas'), puedeProgramar,
      'solo envía con permiso de programar y datos completos');
  });
}

test('HU2 UI: 403 avisa permisos sin cerrar sesión ni repetir automáticamente las alertas rechazadas', async () => {
  const page = startPage({ role: 'gerente', permisos: managerPermissions, onRequest(path) {
    if (path === '/api/cobros' || path.startsWith('/api/contratos/por-vencer')) return response({ error: { message: 'No tienes permiso para realizar esta acción.' } }, 403);
  } });
  await page.ready;
  assert.match(page.document.getElementById('cobros-error').textContent, /No tienes permiso/);
  assert.match(page.document.getElementById('alertas-lista').textContent, /No tienes permiso/);
  assert.equal(page.document.getElementById('permission-notice').hidden, false);
  for (const callback of page.intervals) callback();
  await page.document.dispatch('visibilitychange');
  await turn();
  assert.equal(page.calls.filter(call => call.path.startsWith('/api/contratos/por-vencer')).length, 1);
  assert.ok(page.context.hasPermission('cobros.consultar'));
  assert.deepEqual(page.redirects, []);
});

test('HU2 UI: consultar cobros y registrar pagos son permisos independientes', async () => {
  const account = { id: 'cuenta-prueba', cliente: 'Cliente pendiente', total: 450, total_pagado: 0,
    saldo_pendiente: 450, estado_pago: 'PENDIENTE', fecha_inicio: '2035-01-01', fecha_fin: '2035-01-01' };
  const page = startPage({ permisos: [...commonPermissions, 'cobros.consultar'], onRequest(path) {
    if (path === '/api/cobros') return response([account]);
  } });
  await page.ready;
  assert.equal(page.document.getElementById('cobros').hidden, false);
  const form = page.document.getElementById('cobros-list').querySelector('form');
  assert.ok(form);
  assert.equal(form.hidden, true);
  assert.equal(form.querySelector('button').disabled, true);
  await form.dispatch('submit');
  assert.equal(page.calls.some(call => call.init.method === 'POST'), false);
});

test('HU2 UI: gerente ve formulario de pago y 403 al enviarlo conserva el aviso y la sesión', async () => {
  const account = { id: 'cuenta-prueba', cliente: 'Cliente pendiente', total: 450, total_pagado: 0,
    saldo_pendiente: 450, estado_pago: 'PENDIENTE', fecha_inicio: '2035-01-01', fecha_fin: '2035-01-01' };
  const page = startPage({ role: 'gerente', permisos: managerPermissions, onRequest(path) {
    if (path === '/api/cobros') return response([account]);
    if (path.endsWith('/pagos')) return response({ error: { message: 'No tienes permiso para realizar esta acción.' } }, 403);
  } });
  await page.ready;
  const form = page.document.getElementById('cobros-list').querySelector('form');
  assert.equal(form.hidden, false);
  const input = form.querySelector('input');
  input.value = '10.00';
  await input.dispatch('input');
  await form.dispatch('submit');
  assert.match(form.querySelector('.field-error').textContent, /No tienes permiso/);
  assert.equal(input.value, '10.00');
  assert.equal(page.document.getElementById('permission-notice').hidden, false);
  assert.equal(page.context.hasPermission('pagos.registrar'), true);
  assert.deepEqual(page.redirects, []);
});

for (const setup of [{ sessionStatus: 401 }, { sessionStatus: 403 }, { sessionStatus: 500 }, { sessionError: true }, { permisos: null }]) {
  test(`HU2 UI: sesión fallida no inicia paneles ${JSON.stringify(setup)}`, async () => {
    const page = startPage(setup);
    await page.ready;
    assert.deepEqual(page.calls.map(call => call.path), ['/api/auth/sesion']);
    assert.equal(page.document.querySelector('main').hidden, true);
    assert.equal(page.intervals.length, 0);
    assert.equal(page.context.hasPermission('maquinaria.consultar'), false);
    assert.deepEqual(page.redirects, setup.sessionStatus === 401 ? ['/login.html'] : []);
    if (setup.sessionStatus !== 401) assert.match(page.document.getElementById('session-status').textContent,
      setup.sessionStatus === 403 ? /No tienes permiso/ : /No se pudo comprobar/);
  });
}

test('HU2 UI: 401 de API redirige una sola vez, logout y restauración bfcache eliminan datos', async () => {
  const page = startPage({ onRequest(path) { if (path.startsWith('https://otro.example')) return response({}, 401); } });
  await page.ready;
  await page.context.fetch('https://otro.example/api/restringida');
  assert.deepEqual(page.redirects, [], '401 ajeno al API local no cierra sesión');
  await page.document.getElementById('session-user').querySelector('button').dispatch('click');
  assert.deepEqual(page.redirects, ['/login.html']);
  assert.equal(page.document.querySelector('main').children.length, 0);
  assert.equal(page.context.hasPermission('maquinaria.consultar'), false);

  const expired = startPage({ onRequest(path) { if (path === '/api/prueba') return response({}, 401); } });
  await expired.ready;
  await expired.context.fetch('/api/prueba');
  await expired.context.fetch('/api/prueba');
  assert.deepEqual(expired.redirects, ['/login.html']);

  const restored = startPage();
  await restored.ready;
  await restored.events.dispatch('pageshow', { persisted: true });
  assert.equal(restored.document.querySelector('main').children.length, 0);
  assert.equal(restored.reloads(), 1);
  assert.equal(restored.context.hasPermission('maquinaria.consultar'), false);
});
