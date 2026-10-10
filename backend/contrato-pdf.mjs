// PDF descargable del contrato (HU6b). Todo dato sale del objeto que devuelve
// la base (contractWithMachinery) y las cláusulas salen de buildContractDocument,
// así el PDF y GET /api/contratos/:id/documento muestran el mismo texto.
//
// Limitación conocida: se usan las fuentes estándar Helvetica, que solo cubren
// Windows-1252 (Latin-1 más algunos signos como € “ ” – —). pdfkit no falla con
// emoji o caracteres CJK, los dibuja como basura; por eso safeText los cambia
// por "?" antes de escribirlos. Para soportarlos haría falta incrustar una
// fuente TrueType con esos glifos.
import PDFDocument from 'pdfkit';
import { SEGUROS, FORMAS_PAGO, buildContractDocument } from './contrato-legal.mjs';

const REGULAR = 'Helvetica';
const BOLD = 'Helvetica-Bold';
const ITALIC = 'Helvetica-Oblique';

// Caracteres de Windows-1252 fuera del rango Latin-1 (posiciones 0x80-0x9F).
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

export function safeText(value) {
  if (value === null || value === undefined) return '';
  let result = '';
  // NFC junta letras con tilde escritas en dos partes (e + ´) en un solo carácter.
  for (const char of String(value).normalize('NFC')) {
    const code = char.codePointAt(0);
    if (char === '\t' || char === '\n' || char === '\r') result += ' ';
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue;
    else if (code <= 0xff || CP1252_EXTRA.has(char)) result += char;
    else result += '?';
  }
  return result;
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
