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
const CONTRACT_COLUMNS = `id, maquinaria_id, maquinaria_nombre, cliente, ciudad,
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
    `SELECT m.id, m.nombre, m.tipo, m.descripcion, m.tarifa_diaria, m.disponible, m.ubicacion
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
    maquinaria_ids: ids.toSorted((a, b) => a - b), cliente, ciudad,
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
  return {
    ...row, dias: Number(row.dias), tarifa_diaria: Number(row.tarifa_diaria), total: Number(row.total),
    maquinarias: rows.map((machine) => ({
      ...machine, tarifa_diaria: Number(machine.tarifa_diaria), total: Number(machine.total),
    })),
  };
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
       (id, maquinaria_id, maquinaria_nombre, cliente, fecha_inicio, fecha_fin, dias, tarifa_diaria, total, ciudad)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7::integer, $8::numeric, $7::integer * $8::numeric, $9)
       RETURNING ${CONTRACT_COLUMNS}`,
      [id, firstMachine.id, firstMachine.nombre, input.cliente, input.fecha_inicio,
        input.fecha_fin, input.dias, tariff.rows[0].tarifa, input.ciudad],
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
        const filters = validateMachineryFilters(url.searchParams);
        return json(response, 200, await findMachinery(database, filters));
      }
      if (path === '/api/reservas/ocupadas' && request.method === 'GET') {
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
        return json(response, 200, await contractWithMachinery(database, rows[0]));
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
