import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEGUROS, FORMAS_PAGO, buildContractDocument } from './contrato-legal.mjs';
import { buildContractPdf } from './contrato-pdf.mjs';
import { hoyElSalvador, validarDias, buscarPorVencer } from './contratos-por-vencer.mjs';
import { validarEntrega, guardarEntrega, consultarEntrega } from './entregas.mjs';
import { normalizeSignature } from '../frontend/firma-datos.mjs';
import { AuthError, handleAuthRoutes, guardSession, guardPermission, checkRequestOrigin } from './auth.mjs';
import { handleRecoveryRoutes } from './recuperacion.mjs';
import { resolverRutaProtegida } from './permisos.mjs';

const defaultFrontendDir = fileURLToPath(new URL('../frontend/', import.meta.url));
const MAX_BODY_BYTES = 16_384;
const MAX_RECEPTION_BODY_BYTES = 7_100_000;
const MAX_RECEPTION_PHOTO_BYTES = 1_000_000;
const MAX_RECEPTION_TOTAL_PHOTO_BYTES = 5_000_000;
const DAY_MS = 86_400_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const CONTRACT_COLUMNS = `id, maquinaria_id, maquinaria_nombre, cliente, ciudad,
  fecha_inicio::text, fecha_fin::text, dias, tarifa_diaria, total, estado,
  operador, operador_documento, seguro, forma_pago, condiciones_especiales,
  firma, firmado_en::text`;

export class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store',
  });
  response.end(body);
}

async function readJson(request, maxBytes = MAX_BODY_BYTES) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers['content-type'] || '')) {
    throw new ApiError(415, 'CONTENT_TYPE', 'Envía los datos como application/json.');
  }
  if (Number(request.headers['content-length']) > maxBytes) {
    request.resume();
    throw new ApiError(413, 'BODY_TOO_LARGE', 'La solicitud es demasiado grande.');
  }
  const bytes = await new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        if (!rejected) reject(new ApiError(413, 'BODY_TOO_LARGE', 'La solicitud es demasiado grande.'));
        rejected = true;
        // Keep draining the stream so the HTTP response can reach the client.
      } else if (!rejected) chunks.push(chunk);
    });
    request.once('end', () => { if (!rejected) resolve(Buffer.concat(chunks)); });
    request.once('error', reject);
    request.once('aborted', () => reject(new ApiError(400, 'REQUEST_ABORTED', 'La solicitud fue interrumpida.')));
  });
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw new ApiError(400, 'INVALID_JSON', 'El cuerpo de la solicitud no contiene JSON válido.'); }
}

/** Date-only strings are compared in UTC to avoid timezone and DST drift. */
function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) return null;
  // PostgreSQL stores Gregorian dates; this MVP supports years 0001 through 9999.
  if (value.slice(0, 4) === '0000') return null;
  return timestamp;
}

export function validateMachineryFilters(searchParams) {
  const fields = {};
  const tipo = (searchParams.get('tipo') || '').trim();
  const ubicacion = (searchParams.get('ubicacion') || '').trim();
  if (tipo.length > 80 || /[\u0000-\u001f\u007f]/.test(tipo)) {
    fields.tipo = 'Escribe un tipo válido de hasta 80 caracteres.';
  }
  if (ubicacion.length > 100 || /[\u0000-\u001f\u007f]/.test(ubicacion)) {
    fields.ubicacion = 'Escribe una ciudad válida de hasta 100 caracteres.';
  }
  const fecha_inicio = searchParams.get('fecha_inicio') || '';
  const fecha_fin = searchParams.get('fecha_fin') || '';
  if (fecha_inicio || fecha_fin) {
    const start = parseDate(fecha_inicio);
    const end = parseDate(fecha_fin);
    if (start === null) fields.fecha_inicio = 'Selecciona ambas fechas válidas con formato AAAA-MM-DD.';
    if (end === null) fields.fecha_fin = 'Selecciona ambas fechas válidas con formato AAAA-MM-DD.';
    if (start !== null && end !== null && end < start) {
      fields.fecha_fin = 'La fecha de fin debe ser igual o posterior a la fecha de inicio.';
    }
  }
  const available = searchParams.get('disponible');
  if (available !== null && !['true', 'false'].includes(available)) {
    fields.disponible = 'Usa true o false para indicar disponibilidad.';
  }
  if (Object.keys(fields).length) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Revisa los filtros de maquinaria.', fields);
  }
  return {
    tipo, ubicacion, fecha_inicio, fecha_fin,
    disponible: available === null ? (fecha_inicio ? true : undefined) : available === 'true',
  };
}

export async function findMachinery(database, filters) {
  const conditions = [];
  const values = [];
  const parameter = (value) => { values.push(value); return `$${values.length}`; };
  if (filters.disponible !== undefined) {
    conditions.push(`m.disponible = ${parameter(filters.disponible)}::boolean`);
  }
  if (filters.tipo) conditions.push(`lower(m.tipo) = lower(${parameter(filters.tipo)})`);
  if (filters.ubicacion) {
    conditions.push(`(m.ubicacion IS NULL OR lower(m.ubicacion) = lower(${parameter(filters.ubicacion)}))`);
  }
  if (filters.fecha_inicio) {
    const start = parameter(filters.fecha_inicio);
    const end = parameter(filters.fecha_fin);
    conditions.push(`NOT EXISTS (
      SELECT 1 FROM contrato_maquinaria cm JOIN contrato c ON c.id = cm.contrato_id
      WHERE cm.maquinaria_id = m.id AND c.estado = 'CONFIRMADO'
      AND c.fecha_inicio <= ${end}::date AND c.fecha_fin >= ${start}::date
    )`);
  }
  const { rows } = await database.query(
    `SELECT m.id, m.nombre, m.tipo, m.descripcion, m.tarifa_diaria, m.disponible, m.ubicacion, m.horometro, m.ficha_tecnica, m.foto_url
     FROM maquinaria m ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY m.id`,
    values,
  );
  return rows.map((row) => ({ ...row, tarifa_diaria: Number(row.tarifa_diaria) }));
}

export function validateContract(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Revisa los datos del contrato.');
  }
  const fields = {};
  const hasMultiple = Object.hasOwn(body, 'maquinaria_ids');
  const hasSingle = Object.hasOwn(body, 'maquinaria_id');
  const ids = hasMultiple ? body.maquinaria_ids : [body.maquinaria_id];
  if (hasMultiple && hasSingle) {
    fields.maquinaria_ids = 'Envía maquinaria_ids o maquinaria_id, sin combinar ambos.';
  } else if (!Array.isArray(ids) || ids.length === 0 ||
    ids.some((id) => !Number.isInteger(id) || id < 1 || id > 2_147_483_647) ||
    new Set(ids).size !== ids.length) {
    fields[hasSingle ? 'maquinaria_id' : 'maquinaria_ids'] = 'Selecciona una o más maquinarias válidas, sin repetirlas.';
  }
  const cliente = typeof body.cliente === 'string' ? body.cliente.trim() : '';
  if (cliente.length < 2 || cliente.length > 160 || /[\u0000-\u001f\u007f]/.test(cliente)) {
    fields.cliente = 'Escribe el nombre del cliente (2 a 160 caracteres).';
  }
  const ciudad = typeof body.ciudad === 'string' ? body.ciudad.trim() : '';
  if (ciudad.length < 2 || ciudad.length > 100 || /[\u0000-\u001f\u007f]/.test(ciudad)) {
    fields.ciudad = 'Escribe la ciudad de la obra (2 a 100 caracteres).';
  }
  const REQUIRED = 'Este campo es obligatorio.';
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  const operador = text(body.operador);
  if (!operador) fields.operador = REQUIRED;
  else if (operador.length < 2 || operador.length > 160 || /[\u0000-\u001f\u007f]/.test(operador)) {
    fields.operador = 'Escribe el nombre del operador asignado (2 a 160 caracteres).';
  }
  const operador_documento = text(body.operador_documento);
  if (operador_documento && !/^\d{8}-\d$/.test(operador_documento)) {
    fields.operador_documento = 'Usa el formato del DUI: 00000000-0.';
  }
  const seguro = text(body.seguro);
  if (!seguro) fields.seguro = REQUIRED;
  else if (!Object.hasOwn(SEGUROS, seguro)) fields.seguro = 'Selecciona un tipo de seguro válido.';
  const forma_pago = text(body.forma_pago);
  if (!forma_pago) fields.forma_pago = REQUIRED;
  else if (!Object.hasOwn(FORMAS_PAGO, forma_pago)) fields.forma_pago = 'Selecciona una forma de pago válida.';
  const condiciones_especiales = text(body.condiciones_especiales);
  if (condiciones_especiales.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(condiciones_especiales)) {
    fields.condiciones_especiales = 'Usa un máximo de 1000 caracteres.';
  }
  for (const name of ['cliente', 'ciudad', 'fecha_inicio', 'fecha_fin']) {
    if (body[name] === undefined || body[name] === null || text(body[name]) === '') fields[name] = REQUIRED;
  }
  const start = parseDate(body.fecha_inicio);
  const end = parseDate(body.fecha_fin);
  if (start === null && !fields.fecha_inicio) fields.fecha_inicio = 'Usa una fecha válida con formato AAAA-MM-DD.';
  if (end === null && !fields.fecha_fin) fields.fecha_fin = 'Usa una fecha válida con formato AAAA-MM-DD.';
  if (start !== null && end !== null && end < start) {
    fields.fecha_fin = 'La fecha de fin debe ser igual o posterior a la fecha de inicio.';
  }
  if (Object.keys(fields).length) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Revisa los datos del contrato.', fields);
  }
  return {
    maquinaria_ids: ids.toSorted((a, b) => a - b), cliente, ciudad,
    operador, operador_documento: operador_documento || null, seguro, forma_pago,
    condiciones_especiales: condiciones_especiales || null,
    fecha_inicio: body.fecha_inicio, fecha_fin: body.fecha_fin,
    dias: Math.round((end - start) / DAY_MS) + 1,
  };
}

async function contractWithMachinery(database, row) {
  const { rows } = await database.query(
    `SELECT maquinaria_id, maquinaria_nombre, tarifa_diaria, tarifa_diaria * $2::integer AS total
     FROM contrato_maquinaria WHERE contrato_id = $1 ORDER BY maquinaria_id`,
    [row.id, row.dias],
  );
  const { total_pagado, saldo_pendiente, estado_pago } = await contractAccount(database, row.id);
  return {
    ...row, dias: Number(row.dias), tarifa_diaria: Number(row.tarifa_diaria), total: Number(row.total),
    total_pagado, saldo_pendiente, estado_pago,
    maquinarias: rows.map((machine) => ({
      ...machine, tarifa_diaria: Number(machine.tarifa_diaria), total: Number(machine.total),
    })),
  };
}

// Payment status is derived from the ledger, independently of operational estado.
// PostgreSQL numeric arithmetic keeps the balance exact without duplicate state.
const ACCOUNT_QUERY = `SELECT c.id, c.cliente, c.total, c.estado,
  c.fecha_inicio::text, c.fecha_fin::text,
  COALESCE(SUM(p.monto), 0) AS total_pagado,
  GREATEST(c.total - COALESCE(SUM(p.monto), 0), 0) AS saldo_pendiente,
  CASE WHEN c.total > COALESCE(SUM(p.monto), 0) THEN 'PENDIENTE' ELSE 'PAGADO' END AS estado_pago
  FROM contrato c LEFT JOIN pago p ON p.contrato_id = c.id`;

function accountNumbers(row) {
  return { ...row, total: Number(row.total), total_pagado: Number(row.total_pagado),
    saldo_pendiente: Number(row.saldo_pendiente) };
}

async function contractAccount(database, id) {
  const { rows } = await database.query(`${ACCOUNT_QUERY} WHERE c.id = $1 GROUP BY c.id`, [id]);
  return accountNumbers(rows[0]);
}

export async function findPendingAccounts(database) {
  const { rows } = await database.query(`${ACCOUNT_QUERY}
    GROUP BY c.id HAVING c.total > COALESCE(SUM(p.monto), 0) ORDER BY c.creado_en, c.id`);
  return rows.map(accountNumbers);
}

export function validatePayment(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Revisa los datos del pago.');
  }
  const amount = ['string', 'number'].includes(typeof body.monto) ? String(body.monto).trim() : '';
  const fields = {};
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    fields.monto = 'Ingresa un monto mayor que cero, con un máximo de dos decimales y 12 dígitos enteros.';
  }
  if (body.id !== undefined && (typeof body.id !== 'string' || !UUID_PATTERN.test(body.id))) {
    fields.id = 'El identificador del pago no es válido.';
  }
  if (Object.keys(fields).length) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Revisa los datos del pago.', fields);
  }
  const [whole, decimals = ''] = amount.split('.');
  return { id: body.id?.toLowerCase() || randomUUID(), monto: `${Number(whole)}.${decimals.padEnd(2, '0')}` };
}

function validImageSignature(type, bytes) {
  if (type === 'jpeg') {
    return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
      bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  }
  if (type === 'png') {
    return bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.subarray(12, 16).toString('ascii') === 'IHDR';
  }
  return type === 'webp' && bytes.length >= 16 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP' &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.subarray(12, 16).toString('ascii'));
}

export function validateReception(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Revisa los datos de la recepción.');
  }
  const fields = {};
  const id = body.id === undefined ? randomUUID() : body.id;
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    fields.id = 'El identificador de la recepción no es válido.';
  }
  if (typeof body.contrato_id !== 'string' || !UUID_PATTERN.test(body.contrato_id)) {
    fields.contrato_id = 'El identificador del contrato no es válido.';
  }
  if (!Number.isInteger(body.maquinaria_id) || body.maquinaria_id < 1 || body.maquinaria_id > 2_147_483_647) {
    fields.maquinaria_id = 'Selecciona una maquinaria válida.';
  }
  if (!Number.isInteger(body.horometro) || body.horometro < 0 || body.horometro > 2_147_483_647) {
    fields.horometro = 'Ingresa una lectura entera del horómetro entre 0 y 2147483647.';
  }
  const photos = [];
  let totalBytes = 0;
  if (!Array.isArray(body.fotos) || body.fotos.length < 1 || body.fotos.length > 5) {
    fields.fotos = 'Adjunta entre 1 y 5 fotografías.';
  } else {
    for (const photo of body.fotos) {
      const match = typeof photo === 'string'
        ? /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo) : null;
      if (!match || match[2].length % 4 !== 0) {
        fields.fotos = 'Las evidencias deben ser fotografías JPEG, PNG o WebP válidas.';
        break;
      }
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.toString('base64') !== match[2] || !validImageSignature(match[1], bytes)) {
        fields.fotos = 'El contenido de una fotografía no coincide con su formato.';
        break;
      }
      if (bytes.length > MAX_RECEPTION_PHOTO_BYTES) {
        fields.fotos = 'Cada fotografía debe ocupar como máximo 1 MB después de optimizarse.';
        break;
      }
      totalBytes += bytes.length;
      photos.push(`data:image/${match[1]};base64,${match[2]}`);
    }
    if (!fields.fotos && totalBytes > MAX_RECEPTION_TOTAL_PHOTO_BYTES) {
      fields.fotos = 'Las fotografías superan el límite total de 5 MB.';
    }
  }
  if (Object.keys(fields).length) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Revisa los datos de la recepción.', fields);
  }
  return {
    id: id.toLowerCase(), contrato_id: body.contrato_id.toLowerCase(),
    maquinaria_id: body.maquinaria_id, horometro: body.horometro, fotos: photos,
  };
}

function sameReception(row, input) {
  return row.contrato_id === input.contrato_id && Number(row.maquinaria_id) === input.maquinaria_id &&
    Number(row.horometro) === input.horometro && JSON.stringify(row.fotos) === JSON.stringify(input.fotos);
}

export async function saveReception(database, input) {
  const contract = await database.query('SELECT id FROM contrato WHERE id = $1', [input.contrato_id]);
  if (!contract.rows[0]) throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'No se encontró el contrato.');
  const membership = await database.query(
    `SELECT maquinaria_id, maquinaria_nombre FROM contrato_maquinaria
     WHERE contrato_id = $1 AND maquinaria_id = $2`, [input.contrato_id, input.maquinaria_id],
  );
  if (!membership.rows[0]) {
    throw new ApiError(409, 'MACHINERY_NOT_IN_CONTRACT', 'La maquinaria seleccionada no pertenece al contrato.',
      { maquinaria_id: 'Selecciona una maquinaria incluida en este contrato.' });
  }
  let inserted;
  try {
    inserted = await database.query(
      `INSERT INTO recepcion_maquinaria (id, contrato_id, maquinaria_id, horometro, fotos)
       VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT DO NOTHING
       RETURNING id, contrato_id, maquinaria_id, horometro, fotos, fecha_recepcion::text`,
      [input.id, input.contrato_id, input.maquinaria_id, input.horometro, JSON.stringify(input.fotos)],
    );
  } catch (error) {
    if (error.code === '23503') {
      throw new ApiError(409, 'MACHINERY_NOT_IN_CONTRACT', 'La maquinaria ya no pertenece al contrato.');
    }
    if (error.code === '23514') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'La recepción no cumple las restricciones de almacenamiento.');
    }
    throw error;
  }
  if (inserted.rows[0]) {
    return { replayed: false, recepcion: { ...inserted.rows[0], horometro: Number(inserted.rows[0].horometro),
      maquinaria_nombre: membership.rows[0].maquinaria_nombre } };
  }
  const byId = await database.query(
    `SELECT r.id, r.contrato_id, r.maquinaria_id, cm.maquinaria_nombre, r.horometro, r.fotos,
       r.fecha_recepcion::text FROM recepcion_maquinaria r JOIN contrato_maquinaria cm
       ON cm.contrato_id = r.contrato_id AND cm.maquinaria_id = r.maquinaria_id WHERE r.id = $1`, [input.id],
  );
  if (byId.rows[0]) {
    if (!sameReception(byId.rows[0], input)) {
      throw new ApiError(409, 'RECEPTION_ID_CONFLICT', 'El identificador ya pertenece a otra recepción.');
    }
    return { replayed: true, recepcion: { ...byId.rows[0], horometro: Number(byId.rows[0].horometro) } };
  }
  throw new ApiError(409, 'RECEPTION_ALREADY_EXISTS', 'Esta maquinaria ya tiene una recepción registrada para el contrato.');
}

export async function findReceptions(database, contractId) {
  const contract = await database.query('SELECT id FROM contrato WHERE id = $1', [contractId]);
  if (!contract.rows[0]) throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'No se encontró el contrato.');
  const { rows } = await database.query(
    `SELECT r.id, r.contrato_id, r.maquinaria_id, cm.maquinaria_nombre, r.horometro, r.fotos,
       r.fecha_recepcion::text FROM recepcion_maquinaria r JOIN contrato_maquinaria cm
       ON cm.contrato_id = r.contrato_id AND cm.maquinaria_id = r.maquinaria_id
     WHERE r.contrato_id = $1 ORDER BY r.fecha_recepcion DESC, r.id`, [contractId],
  );
  return rows.map((row) => ({ ...row, horometro: Number(row.horometro) }));
}

export async function savePayment(database, contractId, input) {
  return database.transaction(async (tx) => {
    // All payments for a contract serialize on its header. At READ COMMITTED the
    // subsequent aggregate sees the previous writer's commit before accepting.
    const locked = await tx.query('SELECT id FROM contrato WHERE id = $1 FOR UPDATE', [contractId]);
    if (!locked.rows[0]) throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'No se encontró el contrato.');
    const existing = await tx.query(
      'SELECT id, contrato_id, monto, creado_en::text FROM pago WHERE id = $1', [input.id],
    );
    if (existing.rows[0]) {
      const payment = existing.rows[0];
      if (payment.contrato_id !== locked.rows[0].id || Number(payment.monto) !== Number(input.monto)) {
        throw new ApiError(409, 'PAYMENT_ID_CONFLICT', 'El identificador ya pertenece a otro pago.');
      }
      return { replayed: true, pago: { ...payment, monto: Number(payment.monto) },
        contrato: await contractAccount(tx, contractId) };
    }
    const account = await contractAccount(tx, contractId);
    if (Number(input.monto) > account.saldo_pendiente) {
      throw new ApiError(409, 'PAYMENT_EXCEEDS_BALANCE', 'El pago supera el saldo pendiente del contrato.',
        { monto: `El saldo pendiente es $${account.saldo_pendiente.toFixed(2)}.` });
    }
    const { rows } = await tx.query(
      `INSERT INTO pago (id, contrato_id, monto) VALUES ($1, $2, $3::numeric)
       ON CONFLICT (id) DO NOTHING RETURNING id, contrato_id, monto, creado_en::text`,
      [input.id, contractId, input.monto],
    );
    // A concurrent request for another contract may have claimed this UUID.
    if (!rows[0]) throw new ApiError(409, 'PAYMENT_ID_CONFLICT', 'El identificador ya pertenece a otro pago.');
    return { replayed: false, pago: { ...rows[0], monto: Number(rows[0].monto) },
      contrato: await contractAccount(tx, contractId) };
  });
}

export async function saveContract(database, input) {
  return database.transaction(async (tx) => {
    // All writers lock every selected machine in the same order. Shared machines
    // serialize concurrent rentals without cycles between multi-machine writers.
    const machineResult = await tx.query(
      `SELECT id, nombre, tarifa_diaria, disponible FROM maquinaria
       WHERE id = ANY($1::integer[]) ORDER BY id FOR UPDATE`,
      [input.maquinaria_ids],
    );
    const machines = machineResult.rows;
    if (machines.length !== input.maquinaria_ids.length) {
      throw new ApiError(404, 'MACHINERY_NOT_FOUND', 'Una de las maquinarias seleccionadas no existe.');
    }
    const inactive = machines.find((machine) => !machine.disponible);
    if (inactive) {
      throw new ApiError(409, 'MACHINERY_UNAVAILABLE', `${inactive.nombre} no está disponible para alquiler.`);
    }
    const overlap = await tx.query(
      `SELECT cm.maquinaria_id FROM contrato_maquinaria cm JOIN contrato c ON c.id = cm.contrato_id
       WHERE cm.maquinaria_id = ANY($1::integer[]) AND c.estado = 'CONFIRMADO'
       AND c.fecha_inicio <= $3::date AND c.fecha_fin >= $2::date ORDER BY cm.maquinaria_id LIMIT 1`,
      [input.maquinaria_ids, input.fecha_inicio, input.fecha_fin],
    );
    if (overlap.rows.length) {
      const busy = machines.find((machine) => machine.id === overlap.rows[0].maquinaria_id);
      throw new ApiError(409, 'DATE_CONFLICT', `${busy.nombre} ya tiene un contrato en esas fechas. Selecciona otro período.`);
    }
    // PostgreSQL sums numeric tariffs exactly; client totals never set the price.
    const tariff = await tx.query('SELECT SUM(tarifa_diaria) AS tarifa FROM maquinaria WHERE id = ANY($1::integer[])',
      [input.maquinaria_ids]);
    const id = randomUUID();
    const firstMachine = machines[0];
    const result = await tx.query(
      `INSERT INTO contrato
       (id, maquinaria_id, maquinaria_nombre, cliente, fecha_inicio, fecha_fin, dias, tarifa_diaria, total, ciudad,
        operador, operador_documento, seguro, forma_pago, condiciones_especiales)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7::integer, $8::numeric, $7::integer * $8::numeric, $9,
        $10, $11, $12, $13, $14)
       RETURNING ${CONTRACT_COLUMNS}`,
      [id, firstMachine.id, firstMachine.nombre, input.cliente, input.fecha_inicio,
        input.fecha_fin, input.dias, tariff.rows[0].tarifa, input.ciudad,
        input.operador, input.operador_documento, input.seguro, input.forma_pago, input.condiciones_especiales],
    );
    await tx.query(
      `INSERT INTO contrato_maquinaria (contrato_id, maquinaria_id, maquinaria_nombre, tarifa_diaria)
       SELECT $1::uuid, id, nombre, tarifa_diaria FROM maquinaria
       WHERE id = ANY($2::integer[]) ORDER BY id`,
      [id, input.maquinaria_ids],
    );
    // This is the last city entered in a contract, not a live physical location.
    await tx.query('UPDATE maquinaria SET ubicacion = $2 WHERE id = ANY($1::integer[])', [input.maquinaria_ids, input.ciudad]);
    return contractWithMachinery(tx, result.rows[0]);
  });
}

export async function saveSignature(database, id, body) {
  let firma;
  try { firma = normalizeSignature(body?.firma); }
  catch (error) {
    throw new ApiError(400, 'VALIDATION_ERROR', error.message, { firma: error.message });
  }
  // Una actualización condicional protege la firma incluso si dos teléfonos
  // envían al mismo tiempo. La fecha la asigna la base de datos.
  const { rows } = await database.query(
    `UPDATE contrato SET firma = $2::jsonb, firmado_en = CURRENT_TIMESTAMP
     WHERE id = $1 AND firma IS NULL RETURNING id AS contrato_id, firma, firmado_en::text`,
    [id, JSON.stringify(firma)],
  );
  if (rows[0]) return rows[0];
  const existing = await database.query(
    'SELECT id AS contrato_id, firma, firmado_en::text FROM contrato WHERE id = $1', [id],
  );
  if (!existing.rows[0]) throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'No se encontró el contrato.');
  // Reintentar el mismo envío tras perder conexión no modifica la firma ni su fecha.
  if (JSON.stringify(normalizeSignature(existing.rows[0].firma)) === JSON.stringify(firma)) return existing.rows[0];
  throw new ApiError(409, 'CONTRACT_ALREADY_SIGNED', 'El contrato ya tiene una firma guardada y no se puede reemplazar.');
}

async function serveFile(request, response, pathname, frontendDir) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { throw new ApiError(400, 'INVALID_PATH', 'La dirección solicitada no es válida.'); }
  if (decoded.includes('\0') || decoded.includes('\\')) {
    throw new ApiError(400, 'INVALID_PATH', 'La dirección solicitada no es válida.');
  }
  const root = resolve(frontendDir);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const path = resolve(root, relative);
  if (path !== root && !path.startsWith(root + sep)) {
    throw new ApiError(404, 'NOT_FOUND', 'No se encontró el recurso solicitado.');
  }
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) throw new ApiError(404, 'NOT_FOUND', 'No se encontró el recurso solicitado.');
    const body = await readFile(path);
    response.writeHead(200, {
      'Content-Type': MIME[extname(path)] || 'application/octet-stream',
      'Content-Length': body.length, 'Cache-Control': response.getHeader('Cache-Control') || 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      throw new ApiError(404, 'NOT_FOUND', 'No se encontró el recurso solicitado.');
    }
    throw error;
  }
}

export function createServer({ database, frontendDir = defaultFrontendDir, logger = console,
  requireAuth = false, mailer, appUrl = process.env.APP_URL,
  secureCookies = process.env.NODE_ENV === 'production' } = {}) {
  if (!database) throw new TypeError('createServer requires a database adapter.');
  const server = createHttpServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'same-origin');
    try {
      const url = new URL(request.url, 'http://localhost');
      const path = url.pathname;
      // La ejecución normal activa requireAuth; las pruebas anteriores pueden
      // ejercitar el negocio aisladamente sin autenticación ni autorización.
      const authContext = { request, response, path, database, json, readJson, mailer, appUrl, secureCookies };
      if (requireAuth || path.startsWith('/api/auth/')) checkRequestOrigin(request, { secureCookies, appUrl });
      if (await handleAuthRoutes(authContext)) return;
      if (await handleRecoveryRoutes(authContext)) return;
      if (requireAuth && await guardSession(authContext)) return;
      const ruta = resolverRutaProtegida(request.method, path);
      if (ruta?.metodoNoPermitido || (path === '/api/health' && request.method !== 'GET')) {
        throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'El método no está permitido para este recurso.');
      }
      // Las API nuevas no llegan al despacho de negocio hasta registrar su
      // método, ruta y permiso. La sesión ya validada se reutiliza una sola vez.
      if (path.startsWith('/api/') && path !== '/api/health' && !ruta) {
        throw new ApiError(404, 'NOT_FOUND', 'No se encontró el recurso solicitado.');
      }
      if (requireAuth && ruta) guardPermission(authContext, ruta.permiso);
      if (path === '/api/health' && request.method === 'GET') {
        try { await database.query('SELECT 1 AS healthy'); }
        catch { throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'La base de datos no está disponible.'); }
        // Render define RENDER_GIT_COMMIT; permite comprobar qué commit está publicado.
        const commit = process.env.RENDER_GIT_COMMIT;
        return json(response, 200, {
          status: 'ok',
          database: database.provider || 'postgresql',
          ...(commit ? { commit } : {}),
        });
      }
      if (ruta?.operacion === 'maquinaria.consultar') {
        const filters = validateMachineryFilters(url.searchParams);
        return json(response, 200, await findMachinery(database, filters));
      }
      if (ruta?.operacion === 'reservas.consultar') {
        const id = Number(url.searchParams.get('maquinaria_id'));
        if (!Number.isInteger(id) || id < 1 || id > 2147483647) {
          throw new ApiError(400, 'VALIDATION_ERROR', 'Selecciona una maquinaria válida.');
        }
        const { rows } = await database.query(
          `SELECT c.fecha_inicio::text, c.fecha_fin::text
           FROM contrato c
           JOIN contrato_maquinaria cm ON cm.contrato_id = c.id
           WHERE cm.maquinaria_id = $1 AND c.estado = 'CONFIRMADO'
           ORDER BY c.fecha_inicio`,
          [id],
        );
        return json(response, 200, rows);
      }
      if (ruta?.operacion === 'recepciones.crear') {
        const { replayed, recepcion } = await saveReception(database,
          validateReception(await readJson(request, MAX_RECEPTION_BODY_BYTES)));
        response.setHeader('Location', `/api/contratos/${recepcion.contrato_id}/recepciones`);
        return json(response, replayed ? 200 : 201, recepcion);
      }
      if (ruta?.operacion === 'recepciones.consultar') {
        const [contractId] = ruta.parametros;
        if (!UUID_PATTERN.test(contractId)) {
          throw new ApiError(400, 'INVALID_ID', 'El identificador del contrato no es válido.');
        }
        return json(response, 200, { recepciones: await findReceptions(database, contractId.toLowerCase()) });
      }
      // HU9a: "hoy" se calcula en El Salvador, no con la fecha UTC del servidor.
      if (ruta?.operacion === 'entregas.programar') {
        const hoy = hoyElSalvador();
        const { datos, fields } = validarEntrega(await readJson(request), hoy);
        if (fields) throw new ApiError(400, 'VALIDATION_ERROR', 'Revisa los datos de la entrega.', fields);
        const resultado = await guardarEntrega(database, datos, hoy);
        if (resultado.noEncontrado) throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'No se encontró el contrato.');
        if (resultado.fields) throw new ApiError(400, 'VALIDATION_ERROR', 'Revisa los datos de la entrega.', resultado.fields);
        response.setHeader('Location', `/api/contratos/${datos.contrato_id}/entrega`);
        return json(response, resultado.creada ? 201 : 200, { estado: 'PROGRAMADA', entrega: resultado.entrega });
      }
      if (ruta?.operacion === 'entregas.consultar') {
        const [contractId] = ruta.parametros;
        if (!UUID_PATTERN.test(contractId)) {
          throw new ApiError(400, 'INVALID_ID', 'El identificador del contrato no es válido.');
        }
        const resultado = await consultarEntrega(database, contractId.toLowerCase());
        if (resultado.noEncontrado) throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'No se encontró el contrato.');
        return json(response, 200, resultado);
      }

      if (ruta?.operacion === 'contratos.crear') {
        const input = validateContract(await readJson(request));
        const contract = await saveContract(database, input);
        response.setHeader('Location', `/api/contratos/${contract.id}`);
        return json(response, 201, contract);
      }
      if (ruta?.operacion === 'alertas.consultar') {
        const { dias, error } = validarDias(url.searchParams.get('dias'));
        if (error) throw new ApiError(400, 'VALIDATION_ERROR', error, { dias: error });
        const hoy = hoyElSalvador();
        return json(response, 200, { hoy, dias, contratos: await buscarPorVencer(database, { hoy, dias }) });
      }
      if (ruta?.operacion === 'cobros.consultar') {
        return json(response, 200, await findPendingAccounts(database));
      }
      if (ruta?.operacion === 'pagos.registrar') {
        const [id] = ruta.parametros;
        if (!UUID_PATTERN.test(id)) throw new ApiError(400, 'INVALID_ID', 'El identificador del contrato no es válido.');
        const { replayed, ...result } = await savePayment(database, id, validatePayment(await readJson(request)));
        return json(response, replayed ? 200 : 201, result);
      }
      if (ruta?.operacion === 'contratos.firmar') {
        const [id] = ruta.parametros;
        if (!UUID_PATTERN.test(id)) throw new ApiError(400, 'INVALID_ID', 'El identificador del contrato no es válido.');
        return json(response, 200, await saveSignature(database, id, await readJson(request, 131_072)));
      }
      if (ruta?.operacion === 'contratos.documento') {
        const [id] = ruta.parametros;
        if (!UUID_PATTERN.test(id)) throw new ApiError(400, 'INVALID_ID', 'El identificador del contrato no es válido.');
        const { rows } = await database.query(`SELECT ${CONTRACT_COLUMNS} FROM contrato WHERE id = $1`, [id]);
        if (!rows[0]) throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'No se encontró el contrato.');
        return json(response, 200, buildContractDocument(await contractWithMachinery(database, rows[0])));
      }
      // El PDF se genera completo antes de responder: si algo falla, el cliente
      // recibe un error JSON y nunca un PDF a medias.
      if (ruta?.operacion === 'contratos.pdf') {
        const [id] = ruta.parametros;
        if (!UUID_PATTERN.test(id)) throw new ApiError(400, 'INVALID_ID', 'El identificador del contrato no es válido.');
        const { rows } = await database.query(`SELECT ${CONTRACT_COLUMNS} FROM contrato WHERE id = $1`, [id]);
        if (!rows[0]) throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'No se encontró el contrato.');
        const contract = await contractWithMachinery(database, rows[0]);
        const pdf = await buildContractPdf(contract);
        response.writeHead(200, {
          'Content-Type': 'application/pdf', 'Content-Length': pdf.length, 'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="contrato-${contract.id}.pdf"`,
        });
        return response.end(pdf);
      }
      if (ruta?.operacion === 'contratos.consultar') {
        const [id] = ruta.parametros;
        if (!UUID_PATTERN.test(id)) throw new ApiError(400, 'INVALID_ID', 'El identificador del contrato no es válido.');
        const { rows } = await database.query(`SELECT ${CONTRACT_COLUMNS} FROM contrato WHERE id = $1`, [id]);
        if (!rows[0]) throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'No se encontró el contrato.');
        return json(response, 200, await contractWithMachinery(database, rows[0]));
      }
      if (path.startsWith('/api/')) {
        throw new ApiError(404, 'NOT_FOUND', 'No se encontró el recurso solicitado.');
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'El método no está permitido para este recurso.');
      }
      await serveFile(request, response, path, frontendDir);
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      if (error instanceof ApiError || error instanceof AuthError) {
        return json(response, error.status, {
          error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) },
        });
      }
      // Avoid logging SQL, request data or provider URLs containing credentials.
      logger.error?.('Error interno al procesar una solicitud.', { code: error.code || 'INTERNAL_ERROR' });
      json(response, 500, { error: { code: 'INTERNAL_ERROR', message: 'No se pudo completar la solicitud. Inténtalo de nuevo.' } });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return server;
}
