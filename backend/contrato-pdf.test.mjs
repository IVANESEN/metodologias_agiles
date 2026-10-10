import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { once } from 'node:events';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createDatabase, initializeDatabase } from './database.mjs';
import { createServer } from './app.mjs';
import { SEGUROS, FORMAS_PAGO, buildContractDocument } from './contrato-legal.mjs';
import { buildContractPdf, safeText } from './contrato-pdf.mjs';

// Ruta normal (no file://) a las fuentes estándar de pdfjs, así no muestra el
// aviso de standardFontDataUrl. Termina en '/' y no en path.sep porque pdfjs
// exige esa barra y en Windows path.sep es '\'.
const STANDARD_FONTS = path.resolve('node_modules/pdfjs-dist/standard_fonts') + '/';

const normalize = (text) => text.replace(/\s+/g, ' ').trim();
const usd = (value) => `US$ ${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Extrae el texto página por página y quita el pie de cada una; así una
// cláusula que cae entre dos páginas no queda partida por el pie.
async function pdfText(buffer, id) {
  const loadingTask = getDocument({ data: new Uint8Array(buffer), standardFontDataUrl: STANDARD_FONTS });
  const pdf = await loadingTask.promise;
  const footer = new RegExp(`Contrato ${id}\\s+·\\s+Página \\d+ de \\d+`, 'g');
  const pages = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const content = await (await pdf.getPage(number)).getTextContent();
    pages.push(content.items.map((item) => item.str + (item.hasEOL ? ' ' : '')).join('').replace(footer, ' '));
  }
  const numPages = pdf.numPages;
  await loadingTask.destroy();
  return { numPages, text: normalize(pages.join(' ')) };
}

const completo = {
  maquinaria_id: 1, cliente: 'Constructora Ñandú S.A. de C.V.', ciudad: 'Santa Ana',
  fecha_inicio: '2031-03-01', fecha_fin: '2031-03-05',
  operador: 'José Ernesto Pérez', operador_documento: '01234567-8',
  seguro: 'RESPONSABILIDAD_CIVIL', forma_pago: 'CREDITO_30_DIAS',
  condiciones_especiales: 'Entrega en el portón norte de la obra.',
};

test('HU6b: descarga del contrato en PDF', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'contrato-pdf-'));
  const database = await createDatabase({ connectionString: '', dataDir: join(folder, 'pg'), production: false });
  await initializeDatabase(database);
  const server = createServer({ database, logger: {} });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await database.close();
    await rm(folder, { recursive: true, force: true });
  });
  const crear = async (body) => {
    const response = await fetch(`${base}/api/contratos`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 201);
    return (await response.json()).id;
  };
  const registro = async (id) => (await fetch(`${base}/api/contratos/${id}`)).json();
  const descargar = async (id) => {
    const response = await fetch(`${base}/api/contratos/${id}/pdf`);
    return { response, buffer: Buffer.from(await response.arrayBuffer()) };
  };

  const id = await crear(completo);

  await t.test('responde 200 con un PDF adjunto que no se guarda en caché', async () => {
    const { response, buffer } = await descargar(id);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.equal(response.headers.get('content-disposition'), `attachment; filename="contrato-${id}.pdf"`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(buffer.subarray(0, 4).toString('latin1'), '%PDF');
  });

  await t.test('el texto del PDF coincide con el registro de la base', async () => {
    const contrato = await registro(id);
    const { text } = await pdfText((await descargar(id)).buffer, id);
    const dias = `${contrato.dias} ${contrato.dias === 1 ? 'día' : 'días'}`;
    const esperados = [
      `Número de contrato: ${contrato.id}`,
      `Cliente: ${contrato.cliente}`,
      `Ciudad de la obra: ${contrato.ciudad}`,
      `Fecha de inicio: ${contrato.fecha_inicio}`,
      `Fecha de fin: ${contrato.fecha_fin}`,
      `Días: ${dias}`,
      ...contrato.maquinarias.flatMap((m) => [m.maquinaria_nombre,
        `Tarifa diaria: ${usd(m.tarifa_diaria)} · Subtotal (${dias}): ${usd(m.total)}`]),
      `Tarifa diaria total: ${usd(contrato.tarifa_diaria)}`,
      `Total del arrendamiento: ${usd(contrato.total)}`,
      `Operador: ${contrato.operador}`,
      `DUI del operador: ${contrato.operador_documento}`,
      `Seguro: ${SEGUROS[contrato.seguro]}`,
      `Forma de pago: ${FORMAS_PAGO[contrato.forma_pago]}`,
      `Condiciones especiales: ${contrato.condiciones_especiales}`,
    ];
    const documento = buildContractDocument(contrato);
    for (const clausula of documento.clausulas) esperados.push(`${clausula.titulo} ${clausula.texto}`);
    esperados.push(documento.aviso);
    for (const esperado of esperados) {
      assert.ok(text.includes(normalize(esperado)), `falta en el PDF: ${esperado}`);
    }
    // Solo fija el formato del importe; el valor ya se comparó con el registro de la base.
    assert.match(text, /Total del arrendamiento: US\$ \d{1,3}(,\d{3})*\.\d{2}/);
  });

  await t.test('un contrato con varias maquinarias las muestra todas', async () => {
    const multiple = await crear({ ...completo, maquinaria_id: undefined, maquinaria_ids: [1, 2],
      fecha_inicio: '2031-04-01', fecha_fin: '2031-04-03' });
    const contrato = await registro(multiple);
    assert.equal(contrato.maquinarias.length, 2);
    const { text } = await pdfText((await descargar(multiple)).buffer, multiple);
    for (const m of contrato.maquinarias) {
      assert.ok(text.includes(`${m.maquinaria_nombre} Tarifa diaria: ${usd(m.tarifa_diaria)} · Subtotal (3 días): ${usd(m.total)}`),
        `falta ${m.maquinaria_nombre}`);
    }
    assert.ok(text.includes(`Total del arrendamiento: ${usd(contrato.total)}`));
  });

  await t.test('un ID que no existe o mal formado responde JSON, nunca un PDF', async () => {
    for (const [ruta, status, code] of [
      ['00000000-0000-4000-8000-000000000000', 404, 'CONTRACT_NOT_FOUND'],
      ['no-es-uuid', 400, 'INVALID_ID'],
    ]) {
      const response = await fetch(`${base}/api/contratos/${ruta}/pdf`);
      assert.equal(response.status, status);
      assert.match(response.headers.get('content-type'), /^application\/json/);
      assert.equal(response.headers.get('content-disposition'), null);
      assert.equal((await response.json()).error.code, code);
    }
  });

  await t.test('un contrato sin ciudad genera el PDF sin la línea de ciudad', async () => {
    const contrato = { ...(await registro(id)), ciudad: null };
    const buffer = await buildContractPdf(contrato);
    assert.equal(buffer.subarray(0, 4).toString('latin1'), '%PDF');
    const { text } = await pdfText(buffer, id);
    assert.ok(!text.includes('Ciudad de la obra'));
  });
});

test('safeText deja solo caracteres que Helvetica puede dibujar', () => {
  assert.equal(safeText('Obra 😀 北京'), 'Obra ? ??');
  assert.equal(safeText('Ñandú, José Pérez, acción'), 'Ñandú, José Pérez, acción');
  assert.equal(safeText('Pe\u0301rez'), 'Pérez');
  assert.equal(safeText('€ “comillas” — guion'), '€ “comillas” — guion');
  assert.equal(safeText('línea\nsiguiente\u0007'), 'línea siguiente');
  assert.equal(safeText(null), '');
  assert.equal(safeText(undefined), '');
});
