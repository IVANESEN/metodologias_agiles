import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDatabase, initializeDatabase } from './database.mjs';
import { createServer } from './app.mjs';
import { createTechnicalSheet } from '../frontend/ficha-tecnica.mjs';

// DOM mínimo: ejecuta el mismo constructor que usa la pantalla y permite
// comprobar texto, asociación y el evento de imagen fallida sin navegador.
class Node {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.events = {}; }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  addEventListener(event, callback) { this.events[event] = callback; }
  replaceWith(other) { this.parent.children.splice(this.parent.children.indexOf(this), 1, other); }
}
const document = { createElement: tag => new Node(tag) };
const texts = node => [node.textContent, ...node.children.flatMap(texts)].filter(value => value !== undefined);

test('HU5 API: cada ID conserva sus propias fotos, ficha y horómetro; faltantes siguen siendo null', async t => {
  const database = await createDatabase({ connectionString: '', dataDir: 'memory://', production: false });
  await initializeDatabase(database);
  const server = createServer({ database, logger: {} });
  t.after(async () => {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await database.close();
  });
  await database.query(`UPDATE maquinaria SET tipo = 'HU5-A', nombre = 'Excavadora HU5', horometro = 0,
    ficha_tecnica = 'Potencia 220 kW', foto_url = '/assets/img/maquinaria/excavadora-cat-336.jpg' WHERE id = 1`);
  await database.query(`UPDATE maquinaria SET tipo = 'HU5-B', nombre = 'Grúa HU5', horometro = NULL,
    ficha_tecnica = NULL, foto_url = NULL WHERE id = 2`);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [type, id] of [['HU5-A', 1], ['HU5-B', 2]]) {
    const response = await fetch(`${base}/api/maquinaria?tipo=${type}`);
    assert.equal(response.status, 200);
    const rows = await response.json();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, id);
    const stored = (await database.query('SELECT id, nombre, horometro, ficha_tecnica, foto_url FROM maquinaria WHERE id = $1', [id])).rows[0];
    assert.deepEqual(Object.fromEntries(Object.keys(stored).map(key => [key, rows[0][key]])), stored);
  }
});

test('HU5 pantalla: ficha y foto corresponden al equipo y el horómetro cero no se trata como ausente', () => {
  const first = createTechnicalSheet({ id: 11, nombre: 'Excavadora Águila', horometro: 0,
    ficha_tecnica: 'Potencia <220 kW>', foto_url: '/excavadora.jpg' }, document);
  const second = createTechnicalSheet({ id: 12, nombre: 'Grúa Ñandú', horometro: 140,
    ficha_tecnica: 'Alcance 18 m', foto_url: '/grua.jpg' }, document);
  assert.equal(first.dataset.maquinariaId, '11');
  assert.equal(second.dataset.maquinariaId, '12');
  assert.ok(texts(first).includes('Horómetro: 0 horas'));
  assert.ok(texts(first).includes('Ficha técnica: Potencia <220 kW>'));
  assert.ok(!texts(first).includes('Ficha técnica: Alcance 18 m'));
  for (const [sheet, name, url] of [[first, 'Excavadora Águila', '/excavadora.jpg'], [second, 'Grúa Ñandú', '/grua.jpg']]) {
    const photo = sheet.children[1].children.find(node => node.tagName === 'img');
    assert.equal(photo.alt, `Fotografía de ${name}`);
    assert.equal(photo.src, url);
    assert.equal(photo.loading, 'lazy');
    photo.events.error();
    assert.ok(texts(sheet).includes('Fotografía no disponible'));
    assert.equal(sheet.children[1].children.some(node => node.tagName === 'img'), false);
  }
});

test('HU5 pantalla: etiqueta fotos, ficha y lecturas faltantes o inválidas sin inventar valores', () => {
  for (const missing of [undefined, null, '', '  ']) {
    const sheet = createTechnicalSheet({ id: 21, nombre: 'Equipo', horometro: missing,
      ficha_tecnica: missing, foto_url: missing }, document);
    assert.deepEqual(texts(sheet), ['Ver ficha técnica', 'Horómetro: No disponible',
      'Ficha técnica: No disponible', 'Fotografía no disponible']);
  }
  for (const invalid of [-1, 1.5, NaN, '140']) {
    assert.ok(texts(createTechnicalSheet({ id: 22, nombre: 'Equipo', horometro: invalid }, document))
      .includes('Horómetro: No disponible'));
  }
});
