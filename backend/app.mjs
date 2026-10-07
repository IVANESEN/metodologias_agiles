import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultFrontendDir = fileURLToPath(new URL('../frontend/', import.meta.url));
const MAX_BODY_BYTES = 16_384;
const DAY_MS = 86_400_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const CONTRACT_COLUMNS = `id, maquinaria_id, maquinaria_nombre, cliente,
  fecha_inicio::text, fecha_fin::text, dias, tarifa_diaria, total, estado`;

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

async function readJson(request) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers['content-type'] || '')) {
    throw new ApiError(415, 'CONTENT_TYPE', 'Envía los datos como application/json.');
  }
  if (Number(request.headers['content-length']) > MAX_BODY_BYTES) {
    request.resume();
    throw new ApiError(413, 'BODY_TOO_LARGE', 'La solicitud es demasiado grande.');
  }
  const bytes = await new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
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

export function validateContract(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Revisa los datos del contrato.');
  }
  const fields = {};
  if (!Number.isInteger(body.maquinaria_id) || body.maquinaria_id < 1 || body.maquinaria_id > 2_147_483_647) {
    fields.maquinaria_id = 'Selecciona una maquinaria válida.';
  }
  const cliente = typeof body.cliente === 'string' ? body.cliente.trim() : '';
  if (cliente.length < 2 || cliente.length > 160 || /[\u0000-\u001f\u007f]/.test(cliente)) {
    fields.cliente = 'Escribe el nombre del cliente (2 a 160 caracteres).';
  }
  const start = parseDate(body.fecha_inicio);
  const end = parseDate(body.fecha_fin);
  if (start === null) fields.fecha_inicio = 'Usa una fecha válida con formato AAAA-MM-DD.';
  if (end === null) fields.fecha_fin = 'Usa una fecha válida con formato AAAA-MM-DD.';
  if (start !== null && end !== null && end < start) {
    fields.fecha_fin = 'La fecha de fin debe ser igual o posterior a la fecha de inicio.';
  }
  if (Object.keys(fields).length) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Revisa los datos del contrato.', fields);
  }
  return {
    maquinaria_id: body.maquinaria_id, cliente,
    fecha_inicio: body.fecha_inicio, fecha_fin: body.fecha_fin,
    dias: Math.round((end - start) / DAY_MS) + 1,
  };
}

function normalizeContract(row) {
  return { ...row, dias: Number(row.dias), tarifa_diaria: Number(row.tarifa_diaria), total: Number(row.total) };
}

export async function saveContract(database, input) {
  return database.transaction(async (tx) => {
    // Every reservation writer locks this row before checking overlap. On cloud
    // PostgreSQL a second writer waits, then sees the first committed contract.
    const machineResult = await tx.query(
      'SELECT id, nombre, tarifa_diaria, disponible FROM maquinaria WHERE id = $1 FOR UPDATE',
      [input.maquinaria_id],
    );
    const machine = machineResult.rows[0];
    if (!machine) throw new ApiError(404, 'MACHINERY_NOT_FOUND', 'La maquinaria seleccionada no existe.');
    if (!machine.disponible) throw new ApiError(409, 'MACHINERY_UNAVAILABLE', 'Esta maquinaria no está disponible para alquiler.');
    const overlap = await tx.query(
      `SELECT id FROM contrato WHERE maquinaria_id = $1 AND estado = 'CONFIRMADO'
       AND fecha_inicio <= $3::date AND fecha_fin >= $2::date LIMIT 1`,
      [input.maquinaria_id, input.fecha_inicio, input.fecha_fin],
    );
    if (overlap.rows.length) {
      throw new ApiError(409, 'DATE_CONFLICT', 'La maquinaria ya tiene un contrato en esas fechas. Selecciona otro período.');
    }
    const id = randomUUID();
    const result = await tx.query(
      `INSERT INTO contrato
       (id, maquinaria_id, maquinaria_nombre, cliente, fecha_inicio, fecha_fin, dias, tarifa_diaria, total)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7::integer, $8::numeric, $7::integer * $8::numeric)
       RETURNING ${CONTRACT_COLUMNS}`,
      [id, input.maquinaria_id, machine.nombre, input.cliente, input.fecha_inicio,
        input.fecha_fin, input.dias, machine.tarifa_diaria],
    );
    return normalizeContract(result.rows[0]);
  });
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
      'Content-Length': body.length, 'Cache-Control': 'no-cache',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      throw new ApiError(404, 'NOT_FOUND', 'No se encontró el recurso solicitado.');
    }
    throw error;
  }
}

export function createServer({ database, frontendDir = defaultFrontendDir, logger = console } = {}) {
  if (!database) throw new TypeError('createServer requires a database adapter.');
  const server = createHttpServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'same-origin');
    try {
      const url = new URL(request.url, 'http://localhost');
      const path = url.pathname;
      if (path === '/api/health' && request.method === 'GET') {
        try { await database.query('SELECT 1 AS healthy'); }
        catch { throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'La base de datos no está disponible.'); }
        return json(response, 200, { status: 'ok', database: database.provider || 'postgresql' });
      }
      if (path === '/api/maquinaria' && request.method === 'GET') {
        const { rows } = await database.query(
          'SELECT id, nombre, tipo, descripcion, tarifa_diaria, disponible FROM maquinaria ORDER BY id',
        );
        return json(response, 200, rows.map((row) => ({ ...row, tarifa_diaria: Number(row.tarifa_diaria) })));
      }
      if (path === '/api/contratos' && request.method === 'POST') {
        const input = validateContract(await readJson(request));
        const contract = await saveContract(database, input);
        response.setHeader('Location', `/api/contratos/${contract.id}`);
        return json(response, 201, contract);
      }
      if (path.startsWith('/api/contratos/') && request.method === 'GET') {
        const id = path.slice('/api/contratos/'.length);
        if (!UUID_PATTERN.test(id)) throw new ApiError(400, 'INVALID_ID', 'El identificador del contrato no es válido.');
        const { rows } = await database.query(`SELECT ${CONTRACT_COLUMNS} FROM contrato WHERE id = $1`, [id]);
        if (!rows[0]) throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'No se encontró el contrato.');
        return json(response, 200, normalizeContract(rows[0]));
      }
      if (path.startsWith('/api/')) {
        const known = ['/api/maquinaria', '/api/contratos', '/api/health'].includes(path) || path.startsWith('/api/contratos/');
        if (known) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'El método no está permitido para este recurso.');
        throw new ApiError(404, 'NOT_FOUND', 'No se encontró el recurso solicitado.');
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'El método no está permitido para este recurso.');
      }
      await serveFile(request, response, path, frontendDir);
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      if (error instanceof ApiError) {
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
