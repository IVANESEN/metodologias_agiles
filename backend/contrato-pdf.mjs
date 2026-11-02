// PDF descargable del contrato (HU6b). Todo dato sale del objeto que devuelve
// la base (contractWithMachinery) y las cláusulas salen de buildContractDocument,
// así el PDF y GET /api/contratos/:id/documento muestran el mismo texto.
//
// Helvetica cubre Windows-1252. La API valida esa restricción antes de guardar
// contratos; los datos históricos incompatibles se rechazan de forma explícita
// al generar el PDF. Nunca se sustituyen letras de un nombre por otro carácter.
import PDFDocument from 'pdfkit';
import { SEGUROS, FORMAS_PAGO, buildContractDocument } from './contrato-legal.mjs';

const REGULAR = 'Helvetica';
const BOLD = 'Helvetica-Bold';
const ITALIC = 'Helvetica-Oblique';

// Caracteres de Windows-1252 fuera del rango Latin-1 (posiciones 0x80-0x9F).
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

export const mensajeTextoContrato = 'Usa caracteres compatibles con el contrato PDF: letras latinas (incluidas tildes y ñ), números y signos de Windows-1252; no se admiten emoji ni otros alfabetos.';

export function textoContratoCompatible(value) {
  if (value === null || value === undefined) return true;
  return [...String(value).normalize('NFC')].every((char) => {
    const code = char.codePointAt(0);
    return char === '\t' || char === '\n' || char === '\r' ||
      (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || CP1252_EXTRA.has(char);
  });
}

export function safeText(value) {
  if (value === null || value === undefined) return '';
  if (!textoContratoCompatible(value)) {
    const error = new Error(mensajeTextoContrato);
    error.code = 'UNSUPPORTED_PDF_TEXT';
    throw error;
  }
  // Normalización canónica: e + acento conserva la misma letra que é.
  return String(value).normalize('NFC').replace(/[\t\n\r]/g, ' ');
}

function usd(value) {
  return `US$ ${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function heading(doc, text) {
  doc.moveDown(0.8).font(BOLD).fontSize(11).text(safeText(text));
  doc.moveDown(0.3);
}

function field(doc, label, value) {
  doc.font(BOLD).fontSize(10).text(`${safeText(label)}: `, { continued: true })
    .font(REGULAR).text(safeText(value));
}

function renderContract(doc, contract) {
  const documento = buildContractDocument(contract);
  const dias = `${contract.dias} ${contract.dias === 1 ? 'día' : 'días'}`;

  doc.font(BOLD).fontSize(14).text(safeText(documento.titulo), { align: 'center' });
  doc.moveDown(0.3).font(REGULAR).fontSize(10)
    .text(`Contrato N.º ${safeText(contract.id)}`, { align: 'center' });

  heading(doc, 'Datos del contrato');
  field(doc, 'Número de contrato', contract.id);
  field(doc, 'Cliente', contract.cliente);
  if (contract.ciudad) field(doc, 'Ciudad de la obra', contract.ciudad);
  field(doc, 'Fecha de inicio', contract.fecha_inicio);
  field(doc, 'Fecha de fin', contract.fecha_fin);
  field(doc, 'Días', dias);

  heading(doc, 'Maquinaria');
  for (const machine of contract.maquinarias) {
    doc.font(BOLD).fontSize(10).text(safeText(machine.maquinaria_nombre));
    doc.font(REGULAR).text(
      `Tarifa diaria: ${usd(machine.tarifa_diaria)}  ·  Subtotal (${dias}): ${usd(machine.total)}`,
      { indent: 12 },
    );
  }
  doc.moveDown(0.3);
  field(doc, 'Tarifa diaria total', usd(contract.tarifa_diaria));
  field(doc, 'Total del arrendamiento', usd(contract.total));

  heading(doc, 'Operación y condiciones');
  field(doc, 'Operador', contract.operador || 'Por designar');
  if (contract.operador_documento) field(doc, 'DUI del operador', contract.operador_documento);
  field(doc, 'Seguro', SEGUROS[contract.seguro] || 'No especificado');
  field(doc, 'Forma de pago', FORMAS_PAGO[contract.forma_pago] || 'Según lo acordado por las partes');
  field(doc, 'Condiciones especiales', contract.condiciones_especiales || 'Ninguna');

  heading(doc, 'Cláusulas');
  for (const clausula of documento.clausulas) {
    doc.font(BOLD).fontSize(10).text(safeText(clausula.titulo));
    doc.font(REGULAR).text(safeText(clausula.texto), { align: 'justify' });
    doc.moveDown(0.5);
  }

  if (contract.firma) {
    // Reservar espacio evita cortar la firma entre páginas. Las coordenadas
    // guardadas se dibujan como vectores, también al descargar tras reiniciar.
    if (doc.y + 155 > doc.page.height - doc.page.margins.bottom) doc.addPage();
    heading(doc, 'Firma simulada del cliente');
    const x = doc.page.margins.left;
    const y = doc.y;
    const scale = 0.45;
    doc.save().lineWidth(1.2).strokeColor('#17202a').lineCap('round').lineJoin('round');
    for (const trazo of contract.firma.trazos) {
      doc.moveTo(x + trazo[0][0] * scale, y + trazo[0][1] * scale);
      for (const [px, py] of trazo.slice(1)) doc.lineTo(x + px * scale, y + py * scale);
      doc.stroke();
    }
    doc.restore();
    doc.y = y + contract.firma.alto * scale + 8;
    field(doc, 'Cliente firmante', contract.cliente);
    field(doc, 'Firma registrada (UTC)', new Date(contract.firmado_en).toISOString());
  }
  doc.moveDown(0.5).font(ITALIC).fontSize(9).text(safeText(documento.aviso), { align: 'center' });
}

// Pie con número de página. Se baja el margen inferior mientras se escribe para
// que pdfkit no abra una página nueva al escribir debajo del área de texto.
function renderFooters(doc, contract) {
  const { start, count } = doc.bufferedPageRange();
  for (let index = start; index < start + count; index += 1) {
    doc.switchToPage(index);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font(REGULAR).fontSize(8).text(
      `Contrato ${safeText(contract.id)}  ·  Página ${index - start + 1} de ${count}`,
      doc.page.margins.left, doc.page.height - bottom / 2 - 4,
      { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center', lineBreak: false },
    );
    doc.page.margins.bottom = bottom;
  }
}

export function buildContractPdf(contract) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER', margin: 56, bufferPages: true,
      info: { Title: `Contrato ${safeText(contract.id)}`, Author: 'Constructora El Salvador' },
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      renderContract(doc, contract);
      renderFooters(doc, contract);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
