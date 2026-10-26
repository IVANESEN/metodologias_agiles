import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Ejecuta solo las funciones puras de entrega.js: sin sesión no toca el DOM.
const source = (await readFile(new URL('../frontend/entrega.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const context = vm.createContext({ Intl, Date, Number, String, Object, Error, TypeError, JSON,
  sessionReady: Promise.resolve(false), hasPermission: () => false });
const { validarBorradorEntrega, textoEstadoEntrega, formatearFecha, hoyElSalvador } = await vm.runInContext(
  `(async () => { ${source}\nreturn { validarBorradorEntrega, textoEstadoEntrega, formatearFecha, hoyElSalvador }; })()`,
  context, { filename: 'entrega.js' },
);
const plano = (value) => JSON.parse(JSON.stringify(value));
const limites = { hoy: '2031-03-10', fechaFin: '2031-03-15' };
const valido = { fecha_entrega: '2031-03-10', hora_desde: '07:00', hora_hasta: '09:30', transportista: '  Fletes del Norte ' };

test('HU9a UI: un borrador completo se normaliza para enviarse', () => {
  assert.deepEqual(plano(validarBorradorEntrega(valido, limites)), { datos: {
    fecha_entrega: '2031-03-10', hora_desde: '07:00', hora_hasta: '09:30', transportista: 'Fletes del Norte' } });
  assert.ok(validarBorradorEntrega({ ...valido, fecha_entrega: '2031-03-15' }, limites).datos, 'fecha de fin incluida');
});

test('HU9a UI: bloquea el envío si falta transportista o ventana horaria, o si la fecha no corresponde', () => {
  for (const [campo, cambio] of [
    ['transportista', { transportista: '' }], ['transportista', { transportista: '   ' }],
    ['transportista', { transportista: 'x' }], ['transportista', { transportista: 'x'.repeat(161) }],
    ['hora_desde', { hora_desde: '' }], ['hora_hasta', { hora_hasta: '' }],
    ['hora_desde', { hora_desde: '7:00' }], ['hora_hasta', { hora_hasta: '09:30:00' }],
    ['hora_hasta', { hora_hasta: '07:00' }], ['hora_hasta', { hora_hasta: '06:59' }],
    ['fecha_entrega', { fecha_entrega: '' }], ['fecha_entrega', { fecha_entrega: '2031-02-30' }],
    ['fecha_entrega', { fecha_entrega: '2031-03-09' }], ['fecha_entrega', { fecha_entrega: '2031-03-16' }],
  ]) {
    const { datos, fields } = validarBorradorEntrega({ ...valido, ...cambio }, limites);
    assert.equal(datos, undefined, JSON.stringify(cambio));
    assert.ok(fields[campo], `falta el mensaje de ${campo} para ${JSON.stringify(cambio)}`);
  }
  assert.deepEqual(Object.keys(validarBorradorEntrega({}, limites).fields).sort(),
    ['fecha_entrega', 'hora_desde', 'hora_hasta', 'transportista']);
});

test('HU9a UI: el estado muestra "Sin programar" o la programación completa como texto', () => {
  assert.equal(textoEstadoEntrega({ estado: 'SIN_PROGRAMAR', entrega: null }), 'Sin programar');
  assert.equal(textoEstadoEntrega(null), 'Sin programar');
  const texto = textoEstadoEntrega({ estado: 'PROGRAMADA', entrega: { fecha_entrega: '2031-03-12',
    hora_desde: '08:00', hora_hasta: '10:30', transportista: '<b>x</b>' } });
  assert.equal(texto, `Programada: ${formatearFecha('2031-03-12')}, 08:00–10:30, <b>x</b>`);
  assert.match(formatearFecha('2031-03-12'), /12/);
  assert.match(formatearFecha('2031-03-12'), /2031/);
});

test('HU9a UI: "hoy" se calcula en El Salvador y no con la fecha UTC', () => {
  assert.equal(hoyElSalvador(new Date('2031-03-02T05:59:59Z')), '2031-03-01');
  assert.equal(hoyElSalvador(new Date('2031-03-02T06:00:00Z')), '2031-03-02');
});
