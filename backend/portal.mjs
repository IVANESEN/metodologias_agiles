// Portal multirrol: tienda para clientes, catálogo de proveedores, operación
// para empleados y gobierno para administradores. Todas las reglas de alcance
// (qué ve cada rol) viven aquí; los permisos de ruta viven en permisos.mjs.
import { randomBytes, randomUUID } from 'node:crypto';
import {
  AuthError, currentUser, emailAddress, guardPermission, hashPassword, hashToken, revokeUserSessions,
  verifyPassword, validatePassword,
} from './auth.mjs';
import { tienePermiso, ROLES, ROLES_PORTAL } from './permisos.mjs';
import { FORMAS_PAGO } from './contrato-legal.mjs';
import { hoyElSalvador } from './contratos-por-vencer.mjs';

const MAX_PRODUCT_BODY_BYTES = 7_400_000;
const MAX_IMAGE_BYTES = 1_100_000;
const MAX_IMAGES = 6;
const DAY_MS = 86_400_000;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const ESTADOS_PEDIDO = ['PENDIENTE', 'APROBADO', 'EN_ENTREGA', 'COMPLETADO', 'CANCELADO', 'RECHAZADO'];
const ESTADOS_ACTIVOS = ['PENDIENTE', 'APROBADO', 'EN_ENTREGA'];
const TRANSICIONES = Object.freeze({
  PENDIENTE: ['APROBADO', 'RECHAZADO', 'CANCELADO'],
  APROBADO: ['EN_ENTREGA', 'CANCELADO'],
  EN_ENTREGA: ['COMPLETADO'],
  COMPLETADO: [], CANCELADO: [], RECHAZADO: [],
});
const ESTADOS_PUBLICACION = ['BORRADOR', 'PENDIENTE', 'ACTIVO', 'RECHAZADO', 'ARCHIVADO'];
export const TIPOS_MAQUINARIA = Object.freeze(['Excavadora', 'Retroexcavadora', 'Tractor de oruga', 'Cargador frontal',
  'Compactador', 'Motoniveladora', 'Camión de volteo', 'Grúa', 'Minicargador', 'Manipulador telescópico',
  'Mezcladora de concreto', 'Otro']);
const STAFF = ['admin', 'empleado'];

const fail = (status, code, message, fields) => { throw new AuthError(status, code, message, fields); };
const invalid = (message, fields) => fail(400, 'VALIDATION_ERROR', message, fields);
const cents = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const fixed = (value) => cents(value).toFixed(2);
const num = (value) => (value === null || value === undefined ? null : Number(value));

function text(value, { field, min = 0, max, required = false, multiline = false, fields }) {
  const result = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
  if (!result) {
    if (required) fields[field] = 'Este campo es obligatorio.';
    return null;
  }
  const control = multiline ? CONTROL : /[\u0000-\u001f\u007f]/;
  if (result.length < min || result.length > max || control.test(result)) {
    fields[field] = min > 0 ? `Usa entre ${min} y ${max} caracteres.` : `Usa un máximo de ${max} caracteres.`;
  }
  return result;
}

function decimal(value, { field, required = false, min = 0, max = 99_999_999, fields }) {
  if (value === '' || value === null || value === undefined) {
    if (required) fields[field] = 'Este campo es obligatorio.';
    return null;
  }
  const raw = String(value).trim();
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(raw) || Number(raw) < min || Number(raw) > max) {
    fields[field] = `Ingresa un monto entre ${min} y ${max} con máximo dos decimales.`;
    return null;
  }
  return Number(raw);
}

function integer(value, { field, required = false, min, max, fields }) {
  if (value === '' || value === null || value === undefined) {
    if (required) fields[field] = 'Este campo es obligatorio.';
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    fields[field] = `Ingresa un número entero entre ${min} y ${max}.`;
    return null;
  }
  return parsed;
}

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) return null;
  return timestamp;
}

async function audit(db, user, accion, entidad, entidadId, detalle = {}) {
  await db.query(`INSERT INTO auditoria (id, usuario_id, accion, entidad, entidad_id, detalle)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
  [randomUUID(), user?.id || null, accion, entidad, entidadId == null ? null : String(entidadId), JSON.stringify(detalle)]);
}

export function temporaryPassword() {
  // Sin caracteres ambiguos (0/O, 1/l/I) para dictarla por teléfono.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(12);
  const chars = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
  return `Ici-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

// ---------------------------------------------------------------- tasas
export async function readConfig(db) {
  const { rows } = await db.query(`SELECT clave, valor, etiqueta, unidad, descripcion, minimo, maximo,
    actualizado_en::text, actualizado_por FROM configuracion ORDER BY clave`);
  const list = rows.map((row) => ({ ...row, valor: Number(row.valor), minimo: Number(row.minimo), maximo: Number(row.maximo) }));
  const defaults = { iva: 13, comision_proveedor: 8, deposito_garantia: 20, flete_base: 85,
    descuento_semanal: 5, descuento_mensual: 12, tarifa_operador: 55 };
  const valores = { ...defaults, ...Object.fromEntries(list.map((row) => [row.clave, row.valor])) };
  return { list, valores };
}

// ---------------------------------------------------------------- productos
function imageUrls(row) {
  const images = Array.isArray(row.imagenes) ? row.imagenes : [];
  const urls = images.map((image, index) => (typeof image === 'string' && image.startsWith('data:')
    ? `/api/portal/imagenes/${row.id}/${index}` : image)).filter((image) => typeof image === 'string');
  if (!urls.length && row.foto_url && !row.foto_url.startsWith('data:')) urls.push(row.foto_url);
  return urls;
}

const PRODUCT_COLUMNS = `m.id, m.nombre, m.tipo, m.descripcion, m.tarifa_diaria, m.disponible, m.ubicacion, m.horometro,
  m.ficha_tecnica, m.foto_url, m.proveedor_id, m.marca, m.modelo, m.anio, m.condicion, m.modalidad, m.precio_venta,
  m.stock, m.sku, m.estado_publicacion, m.motivo_rechazo, m.imagenes, m.especificaciones, m.destacado,
  m.creado_en::text, m.actualizado_en::text, p.empresa AS proveedor_empresa, p.nombre AS proveedor_nombre`;

function productOut(row) {
  const venta = row.modalidad === 'VENTA';
  return {
    id: row.id, nombre: row.nombre, tipo: row.tipo, descripcion: row.descripcion,
    tarifa_diaria: venta ? null : num(row.tarifa_diaria), precio_venta: num(row.precio_venta),
    disponible: row.disponible, ubicacion: row.ubicacion, horometro: num(row.horometro),
    proveedor_id: row.proveedor_id,
    proveedor: row.proveedor_id ? (row.proveedor_empresa || row.proveedor_nombre) : 'Flota ICI',
    marca: row.marca, modelo: row.modelo, anio: num(row.anio), condicion: row.condicion, modalidad: row.modalidad,
    stock: num(row.stock), sku: row.sku, estado_publicacion: row.estado_publicacion, motivo_rechazo: row.motivo_rechazo,
    especificaciones: row.especificaciones || {}, destacado: row.destacado, imagenes: imageUrls(row),
    creado_en: row.creado_en, actualizado_en: row.actualizado_en,
  };
}

async function occupiedRanges(db, machineId) {
  const { rows } = await db.query(`
    SELECT c.fecha_inicio::text, c.fecha_fin::text, 'CONTRATO' AS origen FROM contrato_maquinaria cm
      JOIN contrato c ON c.id = cm.contrato_id WHERE cm.maquinaria_id = $1 AND c.estado = 'CONFIRMADO'
      AND c.fecha_fin >= $2::date
    UNION ALL
    SELECT i.fecha_inicio::text, i.fecha_fin::text, 'PEDIDO' FROM pedido_item i JOIN pedido p ON p.id = i.pedido_id
      WHERE i.maquinaria_id = $1 AND i.modalidad = 'RENTA' AND p.estado = ANY($3::text[]) AND i.fecha_fin >= $2::date
    ORDER BY 1`, [machineId, hoyElSalvador(), ESTADOS_ACTIVOS]);
  return rows;
}

async function findCatalog(db, params) {
  const values = [];
  const p = (value) => { values.push(value); return `$${values.length}`; };
  const where = ["m.estado_publicacion = 'ACTIVO'", 'm.disponible = TRUE'];
  const q = (params.get('q') || '').trim().slice(0, 80);
  if (q) {
    const term = p(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(m.nombre ILIKE ${term} OR m.tipo ILIKE ${term} OR COALESCE(m.marca,'') ILIKE ${term}
      OR COALESCE(m.modelo,'') ILIKE ${term} OR m.descripcion ILIKE ${term})`);
  }
  const tipo = (params.get('tipo') || '').trim();
  if (tipo) where.push(`lower(m.tipo) = lower(${p(tipo.slice(0, 80))})`);
  const modalidad = params.get('modalidad');
  if (modalidad === 'RENTA') where.push("m.modalidad IN ('RENTA','AMBAS')");
  if (modalidad === 'VENTA') where.push("m.modalidad IN ('VENTA','AMBAS')");
  const condicion = params.get('condicion');
  if (['NUEVO', 'USADO', 'REACONDICIONADO'].includes(condicion)) where.push(`m.condicion = ${p(condicion)}`);
  const ciudad = (params.get('ciudad') || '').trim();
  if (ciudad) where.push(`(m.ubicacion IS NULL OR lower(m.ubicacion) = lower(${p(ciudad.slice(0, 100))}))`);
  const order = {
    precio_asc: 'COALESCE(m.tarifa_diaria, m.precio_venta) ASC, m.id',
    precio_desc: 'COALESCE(m.precio_venta, m.tarifa_diaria) DESC, m.id',
    recientes: 'm.creado_en DESC, m.id DESC',
  }[params.get('orden')] || 'm.destacado DESC, m.id';
  const { rows } = await db.query(`SELECT ${PRODUCT_COLUMNS} FROM maquinaria m LEFT JOIN usuario p ON p.id = m.proveedor_id
    WHERE ${where.join(' AND ')} ORDER BY ${order}`, values);
  const { rows: tipos } = await db.query(`SELECT tipo, COUNT(*)::int AS total FROM maquinaria
    WHERE estado_publicacion = 'ACTIVO' AND disponible = TRUE GROUP BY tipo ORDER BY tipo`);
  return { productos: rows.map(productOut), tipos };
}

async function productById(db, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(`SELECT ${PRODUCT_COLUMNS} FROM maquinaria m LEFT JOIN usuario p ON p.id = m.proveedor_id
    WHERE m.id = $1${forUpdate ? ' FOR UPDATE OF m' : ''}`, [id]);
  return rows[0] || null;
}

function validImage(type, bytes) {
  if (type === 'jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return type === 'webp' && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
}

function validateImages(list, existing, productId, fields) {
  if (list === undefined) return existing;
  if (!Array.isArray(list) || list.length > MAX_IMAGES) {
    fields.imagenes = `Agrega hasta ${MAX_IMAGES} imágenes.`;
    return existing;
  }
  const result = [];
  for (const item of list) {
    if (typeof item !== 'string') { fields.imagenes = 'Una imagen no es válida.'; break; }
    const stored = /^\/api\/portal\/imagenes\/(\d+)\/(\d)$/.exec(item);
    if (stored) {
      // Referencia a una imagen ya guardada de este mismo producto.
      const original = Number(stored[1]) === productId ? existing[Number(stored[2])] : undefined;
      if (typeof original !== 'string') { fields.imagenes = 'Una imagen guardada ya no existe.'; break; }
      result.push(original);
      continue;
    }
    if (/^\/assets\/img\/[a-z0-9/_-]+\.(?:jpe?g|png|webp)$/i.test(item)) { result.push(item); continue; }
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(item);
    if (!match) { fields.imagenes = 'Usa imágenes JPEG, PNG o WebP.'; break; }
    const bytes = Buffer.from(match[2], 'base64');
    if (!validImage(match[1], bytes)) { fields.imagenes = 'El contenido de una imagen no coincide con su formato.'; break; }
    if (bytes.length > MAX_IMAGE_BYTES) { fields.imagenes = 'Cada imagen debe pesar menos de 1 MB después de optimizarse.'; break; }
    result.push(`data:image/${match[1]};base64,${match[2]}`);
  }
  return result;
}

export function validateProduct(body, { existing = null, user }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Revisa los datos del producto.');
  const fields = {};
  const base = existing || {};
  const pick = (name) => (Object.hasOwn(body, name) ? body[name] : base[name]);
  const nombre = text(pick('nombre'), { field: 'nombre', min: 3, max: 120, required: true, fields });
  const tipo = text(pick('tipo'), { field: 'tipo', min: 2, max: 80, required: true, fields });
  const descripcion = text(pick('descripcion'), { field: 'descripcion', min: 20, max: 4000, required: true, multiline: true, fields });
  const marca = text(pick('marca'), { field: 'marca', min: 1, max: 80, required: true, fields });
  const modelo = text(pick('modelo'), { field: 'modelo', min: 1, max: 80, required: true, fields });
  const sku = text(pick('sku'), { field: 'sku', max: 40, fields });
  if (sku && !/^[A-Za-z0-9._-]+$/.test(sku)) fields.sku = 'Usa letras, números, punto, guion o guion bajo.';
  const ubicacion = text(pick('ubicacion'), { field: 'ubicacion', min: 2, max: 100, required: true, fields });
  const anio = integer(pick('anio'), { field: 'anio', min: 1950, max: new Date().getUTCFullYear() + 1, fields });
  const horometro = integer(pick('horometro'), { field: 'horometro', min: 0, max: 500_000, fields });
  const stock = integer(pick('stock') ?? 1, { field: 'stock', min: 0, max: 999, required: true, fields });
  const condicion = pick('condicion') || 'USADO';
  if (!['NUEVO', 'USADO', 'REACONDICIONADO'].includes(condicion)) fields.condicion = 'Selecciona una condición válida.';
  const modalidad = pick('modalidad') || 'RENTA';
  if (!['RENTA', 'VENTA', 'AMBAS'].includes(modalidad)) fields.modalidad = 'Selecciona renta, venta o ambas.';
  const renta = modalidad !== 'VENTA';
  const venta = modalidad !== 'RENTA';
  const tarifa = decimal(pick('tarifa_diaria'), { field: 'tarifa_diaria', required: renta, min: 1, max: 100_000, fields });
  const precio = decimal(pick('precio_venta'), { field: 'precio_venta', required: venta, min: 100, max: 50_000_000, fields });
  let especificaciones = pick('especificaciones') || {};
  if (typeof especificaciones !== 'object' || Array.isArray(especificaciones) || Object.keys(especificaciones).length > 20 ||
      Object.entries(especificaciones).some(([key, value]) => typeof key !== 'string' || !key.trim() || key.length > 60 ||
        typeof value !== 'string' || value.length > 120 || CONTROL.test(key + value))) {
    fields.especificaciones = 'Agrega hasta 20 especificaciones con nombre y valor cortos.';
    especificaciones = {};
  }
  especificaciones = Object.fromEntries(Object.entries(especificaciones)
    .map(([key, value]) => [key.trim(), String(value).trim()]).filter(([, value]) => value));
  const imagenes = validateImages(body.imagenes, Array.isArray(base.imagenes_raw) ? base.imagenes_raw : [], base.id, fields);
  const accion = body.accion || 'borrador';
  if (!['borrador', 'publicar', 'archivar'].includes(accion)) fields.accion = 'Acción no válida.';
  if (accion === 'publicar' && !imagenes.length) fields.imagenes = 'Agrega al menos una imagen antes de publicar.';
  if (Object.keys(fields).length) invalid('Revisa los datos del producto.', fields);
  let estado;
  if (accion === 'archivar') estado = 'ARCHIVADO';
  else if (accion === 'borrador') estado = 'BORRADOR';
  else if (user.rol === 'proveedor') estado = base.estado_publicacion === 'ACTIVO' ? 'ACTIVO' : 'PENDIENTE';
  else estado = 'ACTIVO';
  return {
    nombre, tipo, descripcion, marca, modelo, sku, ubicacion, anio, horometro, stock, condicion, modalidad,
    // La columna histórica tarifa_diaria es obligatoria. En equipos solo de venta guarda
    // una referencia interna que nunca se muestra ni se cobra.
    tarifa_diaria: renta ? tarifa : Math.max(1, cents(precio / 1000)),
    precio_venta: venta ? precio : null, especificaciones, imagenes, estado_publicacion: estado,
    destacado: user.rol === 'admin' && Object.hasOwn(body, 'destacado') ? body.destacado === true : Boolean(base.destacado),
  };
}

async function saveProduct(db, user, body, id = null) {
  return db.transaction(async (tx) => {
    let existing = null;
    if (id !== null) {
      existing = await productById(tx, id, { forUpdate: true });
      if (!existing) fail(404, 'PRODUCT_NOT_FOUND', 'No se encontró el producto.');
      if (user.rol === 'proveedor' && existing.proveedor_id !== user.id) {
        fail(403, 'FORBIDDEN', 'Solo puedes editar tus propios productos.');
      }
      existing = { ...existing, imagenes_raw: existing.imagenes };
    }
    const input = validateProduct(body, { existing, user });
    const firstUrl = input.imagenes.find((image) => !image.startsWith('data:')) || null;
    const values = [input.nombre, input.tipo, input.descripcion, fixed(input.tarifa_diaria), input.ubicacion, input.horometro,
      input.marca, input.modelo, input.anio, input.condicion, input.modalidad,
      input.precio_venta === null ? null : fixed(input.precio_venta), input.stock, input.sku, input.estado_publicacion,
      JSON.stringify(input.imagenes), JSON.stringify(input.especificaciones), input.destacado, firstUrl];
    let productId = id;
    if (id === null) {
      await tx.exec('LOCK TABLE maquinaria IN SHARE ROW EXCLUSIVE MODE');
      const { rows } = await tx.query('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM maquinaria');
      productId = Number(rows[0].next);
      await tx.query(`INSERT INTO maquinaria (id, nombre, tipo, descripcion, tarifa_diaria, ubicacion, horometro,
        marca, modelo, anio, condicion, modalidad, precio_venta, stock, sku, estado_publicacion, imagenes,
        especificaciones, destacado, foto_url, proveedor_id, disponible)
        VALUES ($20, $1, $2, $3, $4::numeric, $5, $6, $7, $8, $9, $10, $11, $12::numeric, $13, $14, $15, $16::jsonb,
        $17::jsonb, $18, $19, $21, TRUE)`,
      [...values, productId, user.rol === 'proveedor' ? user.id : null]);
    } else {
      await tx.query(`UPDATE maquinaria SET nombre=$1, tipo=$2, descripcion=$3, tarifa_diaria=$4::numeric, ubicacion=$5,
        horometro=$6, marca=$7, modelo=$8, anio=$9, condicion=$10, modalidad=$11, precio_venta=$12::numeric, stock=$13,
        sku=$14, estado_publicacion=$15::varchar, imagenes=$16::jsonb, especificaciones=$17::jsonb, destacado=$18, foto_url=$19,
        motivo_rechazo = CASE WHEN $15::varchar = 'RECHAZADO' THEN motivo_rechazo ELSE NULL END,
        actualizado_en = CURRENT_TIMESTAMP WHERE id = $20`, [...values, id]);
    }
    await audit(tx, user, id === null ? 'producto.crear' : 'producto.editar', 'maquinaria', productId,
      { nombre: input.nombre, estado: input.estado_publicacion });
    return productOut(await productById(tx, productId));
  });
}

// ---------------------------------------------------------------- cotización y pedidos
function validateCart(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.items) || !body.items.length || body.items.length > 20) {
    invalid('Agrega entre 1 y 20 equipos al pedido.', { items: 'Agrega entre 1 y 20 equipos al pedido.' });
  }
  const today = parseDate(hoyElSalvador());
  return body.items.map((item, index) => {
    const fields = {};
    const id = Number(item?.maquinaria_id);
    if (!Number.isInteger(id) || id < 1) fields.maquinaria_id = 'Equipo no válido.';
    const modalidad = item?.modalidad;
    if (!['RENTA', 'COMPRA'].includes(modalidad)) fields.modalidad = 'Selecciona renta o compra.';
    const line = { maquinaria_id: id, modalidad, cantidad: 1, con_operador: item?.con_operador === true };
    if (modalidad === 'COMPRA') {
      line.cantidad = integer(item.cantidad ?? 1, { field: 'cantidad', min: 1, max: 50, required: true, fields });
      line.con_operador = false;
    } else if (modalidad === 'RENTA') {
      const start = parseDate(item.fecha_inicio);
      const end = parseDate(item.fecha_fin);
      if (start === null) fields.fecha_inicio = 'Selecciona la fecha de inicio.';
      if (end === null) fields.fecha_fin = 'Selecciona la fecha de fin.';
      if (start !== null && start < today) fields.fecha_inicio = 'La renta debe iniciar hoy o después.';
      if (start !== null && end !== null && end < start) fields.fecha_fin = 'La fecha de fin debe ser igual o posterior al inicio.';
      if (start !== null && end !== null && (end - start) / DAY_MS + 1 > 365) fields.fecha_fin = 'La renta máxima es de 365 días.';
      Object.assign(line, { fecha_inicio: item.fecha_inicio, fecha_fin: item.fecha_fin,
        dias: start !== null && end !== null ? Math.round((end - start) / DAY_MS) + 1 : null });
    }
    if (Object.keys(fields).length) {
      invalid('Revisa los equipos del pedido.', Object.fromEntries(Object.entries(fields).map(([k, v]) => [`items.${index}.${k}`, v])));
    }
    return line;
  });
}

export async function priceCart(db, lines, { lock = false } = {}) {
  const { valores: tasas } = await readConfig(db);
  const ids = [...new Set(lines.map((line) => line.maquinaria_id))].sort((a, b) => a - b);
  const { rows } = await db.query(`SELECT m.id, m.nombre, m.tipo, m.tarifa_diaria, m.precio_venta, m.modalidad, m.stock,
    m.disponible, m.estado_publicacion, m.proveedor_id, m.imagenes, m.foto_url FROM maquinaria m
    WHERE m.id = ANY($1::integer[]) ORDER BY m.id${lock ? ' FOR UPDATE' : ''}`, [ids]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const result = [];
  for (const line of lines) {
    const machine = byId.get(line.maquinaria_id);
    if (!machine || machine.estado_publicacion !== 'ACTIVO' || !machine.disponible) {
      fail(409, 'PRODUCT_UNAVAILABLE', 'Uno de los equipos ya no está disponible en la tienda.');
    }
    if (line.modalidad === 'RENTA') {
      if (machine.modalidad === 'VENTA') fail(409, 'RENT_NOT_ALLOWED', `${machine.nombre} solo está disponible para compra.`);
      const overlaps = (await occupiedRanges(db, machine.id)).some((range) =>
        range.fecha_inicio <= line.fecha_fin && range.fecha_fin >= line.fecha_inicio);
      const repeated = result.some((other) => other.maquinaria_id === machine.id && other.modalidad === 'RENTA' &&
        other.fecha_inicio <= line.fecha_fin && other.fecha_fin >= line.fecha_inicio);
      if (overlaps || repeated) {
        fail(409, 'DATE_CONFLICT', `${machine.nombre} ya está reservada en esas fechas. Elige otro período.`);
      }
      const tarifa = Number(machine.tarifa_diaria);
      const bruto = cents(tarifa * line.dias);
      const pct = line.dias >= 30 ? tasas.descuento_mensual : line.dias >= 7 ? tasas.descuento_semanal : 0;
      result.push({ ...line, nombre: machine.nombre, tipo: machine.tipo, proveedor_id: machine.proveedor_id,
        imagen: imageUrls(machine)[0] || null, precio_unitario: tarifa, subtotal: bruto,
        descuento: cents(bruto * pct / 100), descuento_pct: pct,
        operador: line.con_operador ? cents(tasas.tarifa_operador * line.dias) : 0 });
    } else {
      if (machine.modalidad === 'RENTA') fail(409, 'SALE_NOT_ALLOWED', `${machine.nombre} solo está disponible para renta.`);
      const reserved = result.filter((other) => other.maquinaria_id === machine.id && other.modalidad === 'COMPRA')
        .reduce((sum, other) => sum + other.cantidad, 0);
      if (line.cantidad + reserved > Number(machine.stock)) {
        fail(409, 'OUT_OF_STOCK', `Solo hay ${machine.stock} unidad(es) disponibles de ${machine.nombre}.`);
      }
      const precio = Number(machine.precio_venta);
      result.push({ ...line, nombre: machine.nombre, tipo: machine.tipo, proveedor_id: machine.proveedor_id,
        imagen: imageUrls(machine)[0] || null, precio_unitario: precio, subtotal: cents(precio * line.cantidad),
        descuento: 0, descuento_pct: 0, operador: 0 });
    }
  }
  const sum = (key) => cents(result.reduce((total, line) => total + line[key], 0));
  const subtotal = sum('subtotal');
  const descuento = sum('descuento');
  const operador = sum('operador');
  const flete = cents(tasas.flete_base * result.reduce((total, line) => total + line.cantidad, 0));
  const base = cents(subtotal - descuento + operador + flete);
  const iva = cents(base * tasas.iva / 100);
  const rentaNeta = cents(result.filter((line) => line.modalidad === 'RENTA')
    .reduce((total, line) => total + line.subtotal - line.descuento, 0));
  const deposito = cents(rentaNeta * tasas.deposito_garantia / 100);
  const tipos = new Set(result.map((line) => line.modalidad));
  return {
    items: result, tasas,
    tipo: tipos.size > 1 ? 'MIXTO' : tipos.has('RENTA') ? 'RENTA' : 'COMPRA',
    totales: { subtotal, descuento, operador, flete, base, iva, deposito, total: cents(base + iva + deposito) },
  };
}

function validateCheckout(body) {
  const fields = {};
  const ciudad = text(body?.ciudad, { field: 'ciudad', min: 2, max: 100, required: true, fields });
  const direccion = text(body?.direccion, { field: 'direccion', min: 5, max: 240, required: true, fields });
  const notas = text(body?.notas, { field: 'notas', max: 1000, multiline: true, fields });
  const metodo = body?.metodo_pago;
  if (!Object.hasOwn(FORMAS_PAGO, metodo || '')) fields.metodo_pago = 'Selecciona una forma de pago.';
  if (Object.keys(fields).length) invalid('Revisa los datos de entrega.', fields);
  return { ciudad, direccion, notas, metodo_pago: metodo };
}

async function createOrder(db, user, body) {
  const lines = validateCart(body);
  const checkout = validateCheckout(body);
  return db.transaction(async (tx) => {
    const quote = await priceCart(tx, lines, { lock: true });
    await tx.exec('LOCK TABLE pedido IN SHARE ROW EXCLUSIVE MODE');
    const { rows } = await tx.query('SELECT COALESCE(MAX(numero), 1000) + 1 AS next FROM pedido');
    const id = randomUUID();
    const t = quote.totales;
    await tx.query(`INSERT INTO pedido (id, numero, cliente_id, tipo, ciudad, direccion, metodo_pago, notas,
      subtotal, descuento, operador, flete, iva, deposito, total, tasas)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10::numeric, $11::numeric, $12::numeric, $13::numeric,
      $14::numeric, $15::numeric, $16::jsonb)`,
    [id, Number(rows[0].next), user.id, quote.tipo, checkout.ciudad, checkout.direccion, checkout.metodo_pago, checkout.notas,
      fixed(t.subtotal), fixed(t.descuento), fixed(t.operador), fixed(t.flete), fixed(t.iva), fixed(t.deposito), fixed(t.total),
      JSON.stringify(quote.tasas)]);
    for (const line of quote.items) {
      await tx.query(`INSERT INTO pedido_item (id, pedido_id, maquinaria_id, nombre, proveedor_id, modalidad, cantidad,
        fecha_inicio, fecha_fin, dias, con_operador, precio_unitario, subtotal)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10, $11, $12::numeric, $13::numeric)`,
      [randomUUID(), id, line.maquinaria_id, line.nombre, line.proveedor_id, line.modalidad, line.cantidad,
        line.fecha_inicio || null, line.fecha_fin || null, line.dias || null, line.con_operador,
        fixed(line.precio_unitario), fixed(line.subtotal)]);
      // Las compras apartan inventario desde que se solicitan; se devuelve si se cancela.
      if (line.modalidad === 'COMPRA') {
        await tx.query('UPDATE maquinaria SET stock = stock - $2 WHERE id = $1', [line.maquinaria_id, line.cantidad]);
      }
    }
    await tx.query(`INSERT INTO pedido_evento (id, pedido_id, estado, nota, usuario_id) VALUES ($1, $2, 'PENDIENTE', $3, $4)`,
      [randomUUID(), id, 'Pedido recibido. Un asesor confirmará disponibilidad y entrega.', user.id]);
    await audit(tx, user, 'pedido.crear', 'pedido', id, { total: t.total, tipo: quote.tipo });
    return orderDetail(tx, user, id);
  });
}

function orderScope(user, values) {
  if (user.rol === 'cliente') { values.push(user.id); return `p.cliente_id = $${values.length}`; }
  if (user.rol === 'proveedor') {
    values.push(user.id);
    return `EXISTS (SELECT 1 FROM pedido_item s WHERE s.pedido_id = p.id AND s.proveedor_id = $${values.length})`;
  }
  return 'TRUE';
}

async function listOrders(db, user, params) {
  const values = [];
  const where = [orderScope(user, values)];
  const estado = params.get('estado');
  if (ESTADOS_PEDIDO.includes(estado)) { values.push(estado); where.push(`p.estado = $${values.length}`); }
  let providerFilter = '';
  if (user.rol === 'proveedor') { values.push(user.id); providerFilter = `AND i.proveedor_id = $${values.length}::uuid`; }
  const { rows } = await db.query(`SELECT p.id, p.numero, p.tipo, p.estado, p.total, p.ciudad, p.creado_en::text,
      p.actualizado_en::text, u.nombre AS cliente, u.empresa AS cliente_empresa,
      (SELECT COUNT(*)::int FROM pedido_item i WHERE i.pedido_id = p.id ${providerFilter}) AS equipos,
      (SELECT COALESCE(SUM(i.subtotal), 0) FROM pedido_item i WHERE i.pedido_id = p.id ${providerFilter}) AS subtotal_items,
      (SELECT string_agg(i.nombre, ', ' ORDER BY i.nombre) FROM pedido_item i WHERE i.pedido_id = p.id ${providerFilter}) AS resumen
    FROM pedido p JOIN usuario u ON u.id = p.cliente_id WHERE ${where.join(' AND ')}
    ORDER BY p.creado_en DESC LIMIT 200`, values);
  return rows.map((row) => ({ ...row, total: Number(row.total), subtotal_items: Number(row.subtotal_items),
    numero_visible: `PED-${row.numero}` }));
}

async function orderDetail(db, user, id) {
  const values = [id];
  const { rows } = await db.query(`SELECT p.*, p.creado_en::text AS creado_en, p.actualizado_en::text AS actualizado_en,
      u.nombre AS cliente, u.correo AS cliente_correo, u.empresa AS cliente_empresa, u.telefono AS cliente_telefono,
      a.nombre AS atendido_por_nombre
    FROM pedido p JOIN usuario u ON u.id = p.cliente_id LEFT JOIN usuario a ON a.id = p.atendido_por
    WHERE p.id = $1 AND ${orderScope(user, values)}`, values);
  const order = rows[0];
  if (!order) fail(404, 'ORDER_NOT_FOUND', 'No se encontró el pedido.');
  const { rows: items } = await db.query(`SELECT i.id, i.maquinaria_id, i.nombre, i.proveedor_id, i.modalidad, i.cantidad,
      i.fecha_inicio::text, i.fecha_fin::text, i.dias, i.con_operador, i.precio_unitario, i.subtotal,
      m.imagenes, m.foto_url, m.tipo, m.marca, m.modelo
    FROM pedido_item i JOIN maquinaria m ON m.id = i.maquinaria_id WHERE i.pedido_id = $1 ORDER BY i.nombre`, [id]);
  const { rows: eventos } = await db.query(`SELECT e.estado, e.nota, e.creado_en::text, u.nombre AS usuario, u.rol
    FROM pedido_evento e LEFT JOIN usuario u ON u.id = e.usuario_id WHERE e.pedido_id = $1 ORDER BY e.creado_en, e.id`, [id]);
  const visibles = user.rol === 'proveedor' ? items.filter((item) => item.proveedor_id === user.id) : items;
  const comision = Number(order.tasas?.comision_proveedor ?? 0);
  const result = {
    id: order.id, numero: order.numero, numero_visible: `PED-${order.numero}`, tipo: order.tipo, estado: order.estado,
    ciudad: order.ciudad, direccion: order.direccion, metodo_pago: order.metodo_pago,
    metodo_pago_texto: FORMAS_PAGO[order.metodo_pago] || order.metodo_pago, notas: order.notas, motivo: order.motivo,
    creado_en: order.creado_en, actualizado_en: order.actualizado_en, atendido_por: order.atendido_por_nombre,
    cliente: { nombre: order.cliente, correo: order.cliente_correo, empresa: order.cliente_empresa, telefono: order.cliente_telefono },
    items: visibles.map((item) => ({
      id: item.id, maquinaria_id: item.maquinaria_id, nombre: item.nombre, modalidad: item.modalidad, cantidad: item.cantidad,
      fecha_inicio: item.fecha_inicio, fecha_fin: item.fecha_fin, dias: num(item.dias), con_operador: item.con_operador,
      precio_unitario: Number(item.precio_unitario), subtotal: Number(item.subtotal), tipo: item.tipo,
      marca: item.marca, modelo: item.modelo, imagen: imageUrls({ ...item, id: item.maquinaria_id })[0] || null,
    })),
    eventos,
    transiciones: STAFF.includes(user.rol) ? TRANSICIONES[order.estado] : [],
    cancelable: user.rol === 'cliente' && order.estado === 'PENDIENTE',
  };
  if (user.rol === 'proveedor') {
    const bruto = cents(result.items.reduce((total, item) => total + item.subtotal, 0));
    result.liquidacion = { bruto, comision_pct: comision, comision: cents(bruto * comision / 100),
      neto: cents(bruto - bruto * comision / 100) };
    delete result.cliente.correo; delete result.cliente.telefono;
  } else {
    result.totales = Object.fromEntries(['subtotal', 'descuento', 'operador', 'flete', 'iva', 'deposito', 'total']
      .map((key) => [key, Number(order[key])]));
    result.tasas = order.tasas;
  }
  return result;
}

async function changeOrderState(db, user, id, nuevo, nota) {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query('SELECT id, estado, cliente_id FROM pedido WHERE id = $1 FOR UPDATE', [id]);
    const order = rows[0];
    if (!order) fail(404, 'ORDER_NOT_FOUND', 'No se encontró el pedido.');
    if (user.rol === 'cliente' && order.cliente_id !== user.id) fail(404, 'ORDER_NOT_FOUND', 'No se encontró el pedido.');
    if (!TRANSICIONES[order.estado].includes(nuevo)) {
      fail(409, 'INVALID_TRANSITION', `Un pedido ${order.estado.toLowerCase().replace('_', ' ')} no puede pasar a ${nuevo.toLowerCase().replace('_', ' ')}.`);
    }
    if (['CANCELADO', 'RECHAZADO'].includes(nuevo)) {
      await tx.query(`UPDATE maquinaria m SET stock = m.stock + i.cantidad FROM pedido_item i
        WHERE i.pedido_id = $1 AND i.modalidad = 'COMPRA' AND m.id = i.maquinaria_id`, [id]);
    }
    await tx.query(`UPDATE pedido SET estado = $2::varchar, actualizado_en = CURRENT_TIMESTAMP,
      atendido_por = CASE WHEN $3::boolean THEN $4::uuid ELSE atendido_por END,
      motivo = CASE WHEN $2::varchar IN ('CANCELADO', 'RECHAZADO') THEN $5::text ELSE motivo END WHERE id = $1`,
    [id, nuevo, STAFF.includes(user.rol), user.id, nota]);
    const mensajes = {
      APROBADO: 'Disponibilidad confirmada. Preparando documentación y traslado.',
      EN_ENTREGA: 'El equipo salió del patio hacia la obra.',
      COMPLETADO: 'Entrega completada y recibida en obra.',
      CANCELADO: 'Pedido cancelado.',
      RECHAZADO: 'Pedido rechazado.',
    };
    await tx.query('INSERT INTO pedido_evento (id, pedido_id, estado, nota, usuario_id) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), id, nuevo, nota || mensajes[nuevo], user.id]);
    await audit(tx, user, 'pedido.estado', 'pedido', id, { de: order.estado, a: nuevo });
    return orderDetail(tx, user, id);
  });
}

// ---------------------------------------------------------------- usuarios
const USER_COLUMNS = `u.id, u.nombre, u.correo, u.rol, u.activo, u.empresa, u.telefono, u.documento,
  u.creado_en::text, u.ultimo_acceso::text,
  (SELECT COUNT(*)::int FROM pedido p WHERE p.cliente_id = u.id) AS pedidos,
  (SELECT COUNT(*)::int FROM maquinaria m WHERE m.proveedor_id = u.id) AS productos`;

function manageableRoles(user) {
  return user.rol === 'admin' ? ROLES : ['cliente', 'proveedor'];
}

function validateUserFields(body, fields) {
  const nombre = text(body?.nombre, { field: 'nombre', min: 2, max: 160, required: true, fields });
  const empresa = text(body?.empresa, { field: 'empresa', max: 160, fields });
  const telefono = text(body?.telefono, { field: 'telefono', max: 30, fields });
  if (telefono && !/^[+\d][\d\s-]{6,29}$/.test(telefono)) fields.telefono = 'Usa un teléfono válido, por ejemplo 2222-0000.';
  const documento = text(body?.documento, { field: 'documento', max: 30, fields });
  return { nombre, empresa, telefono, documento };
}

async function createPortalUser(db, user, body, { selfRegistration = false } = {}) {
  const fields = {};
  const data = validateUserFields(body, fields);
  let correo;
  try { correo = emailAddress(body?.correo); } catch { fields.correo = 'Escribe un correo válido.'; }
  const rol = selfRegistration ? 'cliente' : body?.rol;
  if (!manageableRoles(user || { rol: 'cliente' }).includes(rol)) fields.rol = 'No puedes crear usuarios con ese rol.';
  let clave = body?.clave;
  if (selfRegistration || clave) {
    try { validatePassword(clave); } catch { fields.clave = 'Usa entre 8 y 256 caracteres.'; }
    if (selfRegistration && typeof clave === 'string' && clave.length >= 8 && !(/[A-Za-z]/.test(clave) && /\d/.test(clave))) {
      fields.clave = 'Combina letras y números.';
    }
  }
  if (Object.keys(fields).length) invalid('Revisa los datos del usuario.', fields);
  const temporal = clave ? null : temporaryPassword();
  const hash = await hashPassword(clave || temporal);
  const id = randomUUID();
  try {
    await db.query(`INSERT INTO usuario (id, correo, nombre, clave_hash, rol, empresa, telefono, documento)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [id, correo, data.nombre, hash, rol, data.empresa, data.telefono, data.documento]);
  } catch (error) {
    if (error.code === '23505') fail(409, 'EMAIL_TAKEN', 'Ya existe una cuenta con ese correo.', { correo: 'Ya existe una cuenta con ese correo.' });
    throw error;
  }
  await audit(db, user || { id }, selfRegistration ? 'usuario.registro' : 'usuario.crear', 'usuario', id, { correo, rol });
  const { rows } = await db.query(`SELECT ${USER_COLUMNS} FROM usuario u WHERE u.id = $1`, [id]);
  return { usuario: rows[0], clave_temporal: temporal };
}

async function editPortalUser(db, user, id, body) {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query('SELECT id, rol, activo FROM usuario WHERE id = $1 FOR UPDATE', [id]);
    const target = rows[0];
    if (!target || !manageableRoles(user).includes(target.rol)) fail(404, 'USER_NOT_FOUND', 'No se encontró el usuario.');
    const fields = {};
    const data = validateUserFields(body, fields);
    let rol = target.rol;
    if (body?.rol !== undefined && body.rol !== target.rol) {
      if (user.rol !== 'admin' || !ROLES.includes(body.rol)) fields.rol = 'No puedes asignar ese rol.';
      else if (id === user.id) fields.rol = 'No puedes cambiar tu propio rol.';
      else rol = body.rol;
    }
    const activo = body?.activo === undefined ? target.activo : body.activo === true;
    if (!activo && id === user.id) fields.activo = 'No puedes desactivar tu propia cuenta.';
    if (Object.keys(fields).length) invalid('Revisa los datos del usuario.', fields);
    await tx.query(`UPDATE usuario SET nombre=$2, empresa=$3, telefono=$4, documento=$5, rol=$6, activo=$7 WHERE id=$1`,
      [id, data.nombre, data.empresa, data.telefono, data.documento, rol, activo]);
    if (!activo || rol !== target.rol) await revokeUserSessions(tx, id);
    await audit(tx, user, 'usuario.editar', 'usuario', id,
      { rol: rol !== target.rol ? { de: target.rol, a: rol } : undefined, activo: activo !== target.activo ? activo : undefined });
    const result = await tx.query(`SELECT ${USER_COLUMNS} FROM usuario u WHERE u.id = $1`, [id]);
    return result.rows[0];
  });
}

async function resetPortalPassword(db, user, id) {
  const { rows } = await db.query('SELECT id, rol, correo FROM usuario WHERE id = $1', [id]);
  const target = rows[0];
  if (!target || !manageableRoles(user).includes(target.rol)) fail(404, 'USER_NOT_FOUND', 'No se encontró el usuario.');
  const temporal = temporaryPassword();
  const hash = await hashPassword(temporal);
  await db.transaction(async (tx) => {
    await tx.query('SELECT id FROM usuario WHERE id = $1 FOR UPDATE', [id]);
    await tx.query('UPDATE usuario SET clave_hash = $2 WHERE id = $1', [id, hash]);
    await revokeUserSessions(tx, id);
    await tx.query('UPDATE token_recuperacion SET usado_en = CURRENT_TIMESTAMP WHERE usuario_id = $1 AND usado_en IS NULL', [id]);
    await audit(tx, user, 'usuario.clave_temporal', 'usuario', id, { correo: target.correo });
  });
  return { clave_temporal: temporal };
}

// ---------------------------------------------------------------- tableros
async function dashboard(db, user) {
  const { rows: perfilRows } = await db.query(`SELECT id, nombre, correo, rol, empresa, telefono, documento,
    creado_en::text, ultimo_acceso::text FROM usuario WHERE id = $1`, [user.id]);
  const result = { perfil: perfilRows[0] };
  const count = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].total);
  if (user.rol === 'cliente') {
    result.kpis = {
      activos: await count(`SELECT COUNT(*) AS total FROM pedido WHERE cliente_id = $1 AND estado = ANY($2::text[])`, [user.id, ESTADOS_ACTIVOS]),
      rentas_en_curso: await count(`SELECT COUNT(*) AS total FROM pedido_item i JOIN pedido p ON p.id = i.pedido_id
        WHERE p.cliente_id = $1 AND i.modalidad = 'RENTA' AND p.estado IN ('APROBADO','EN_ENTREGA','COMPLETADO')
        AND i.fecha_inicio <= $2::date AND i.fecha_fin >= $2::date`, [user.id, hoyElSalvador()]),
      invertido: await count(`SELECT COALESCE(SUM(total), 0) AS total FROM pedido WHERE cliente_id = $1
        AND estado NOT IN ('CANCELADO','RECHAZADO')`, [user.id]),
      completados: await count(`SELECT COUNT(*) AS total FROM pedido WHERE cliente_id = $1 AND estado = 'COMPLETADO'`, [user.id]),
    };
    result.pedidos = (await listOrders(db, user, new URLSearchParams())).slice(0, 5);
    result.destacados = (await findCatalog(db, new URLSearchParams())).productos.slice(0, 4);
  } else if (user.rol === 'proveedor') {
    const { rows } = await db.query(`SELECT estado_publicacion AS estado, COUNT(*)::int AS total FROM maquinaria
      WHERE proveedor_id = $1 GROUP BY estado_publicacion`, [user.id]);
    const { valores } = await readConfig(db);
    const bruto = await count(`SELECT COALESCE(SUM(i.subtotal), 0) AS total FROM pedido_item i JOIN pedido p ON p.id = i.pedido_id
      WHERE i.proveedor_id = $1 AND p.estado IN ('APROBADO','EN_ENTREGA','COMPLETADO')`, [user.id]);
    result.kpis = {
      productos: Object.fromEntries(ESTADOS_PUBLICACION.map((estado) => [estado, rows.find((row) => row.estado === estado)?.total || 0])),
      ventas_brutas: bruto, comision_pct: valores.comision_proveedor,
      neto: cents(bruto * (1 - valores.comision_proveedor / 100)),
      pedidos_pendientes: await count(`SELECT COUNT(DISTINCT p.id) AS total FROM pedido p JOIN pedido_item i ON i.pedido_id = p.id
        WHERE i.proveedor_id = $1 AND p.estado = 'PENDIENTE'`, [user.id]),
    };
    result.pedidos = (await listOrders(db, user, new URLSearchParams())).slice(0, 6);
    const { rows: top } = await db.query(`SELECT m.id, m.nombre, COUNT(i.id)::int AS pedidos, COALESCE(SUM(i.subtotal),0) AS monto
      FROM maquinaria m LEFT JOIN pedido_item i ON i.maquinaria_id = m.id
      WHERE m.proveedor_id = $1 GROUP BY m.id, m.nombre ORDER BY monto DESC, m.nombre LIMIT 5`, [user.id]);
    result.top = top.map((row) => ({ ...row, monto: Number(row.monto) }));
  } else {
    const { rows: estados } = await db.query('SELECT estado, COUNT(*)::int AS total FROM pedido GROUP BY estado');
    result.kpis = {
      pedidos: Object.fromEntries(ESTADOS_PEDIDO.map((estado) => [estado, estados.find((row) => row.estado === estado)?.total || 0])),
      por_moderar: await count("SELECT COUNT(*) AS total FROM maquinaria WHERE estado_publicacion = 'PENDIENTE'"),
      clientes: await count("SELECT COUNT(*) AS total FROM usuario WHERE rol = 'cliente' AND activo"),
      proveedores: await count("SELECT COUNT(*) AS total FROM usuario WHERE rol = 'proveedor' AND activo"),
      catalogo: await count("SELECT COUNT(*) AS total FROM maquinaria WHERE estado_publicacion = 'ACTIVO' AND disponible"),
      ingresos: await count("SELECT COALESCE(SUM(total - deposito), 0) AS total FROM pedido WHERE estado IN ('APROBADO','EN_ENTREGA','COMPLETADO')"),
      entregas_hoy: await count(`SELECT COUNT(*) AS total FROM pedido_item i JOIN pedido p ON p.id = i.pedido_id
        WHERE p.estado IN ('APROBADO','EN_ENTREGA') AND i.fecha_inicio = $1::date`, [hoyElSalvador()]),
    };
    result.cola = (await listOrders(db, user, new URLSearchParams({ estado: 'PENDIENTE' }))).slice(0, 6);
    const { rows: moderacion } = await db.query(`SELECT ${PRODUCT_COLUMNS} FROM maquinaria m LEFT JOIN usuario p ON p.id = m.proveedor_id
      WHERE m.estado_publicacion = 'PENDIENTE' ORDER BY m.actualizado_en LIMIT 5`);
    result.moderacion = moderacion.map(productOut);
    if (user.rol === 'admin') result.reportes = await reports(db);
  }
  return result;
}

async function reports(db) {
  const { rows: meses } = await db.query(`SELECT to_char(date_trunc('month', creado_en), 'YYYY-MM') AS mes,
      COALESCE(SUM(total - deposito) FILTER (WHERE estado IN ('APROBADO','EN_ENTREGA','COMPLETADO')), 0) AS ingresos,
      COUNT(*)::int AS pedidos
    FROM pedido WHERE creado_en >= date_trunc('month', CURRENT_TIMESTAMP) - INTERVAL '5 months'
    GROUP BY 1 ORDER BY 1`);
  const series = [];
  const now = new Date();
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const mes = date.toISOString().slice(0, 7);
    const row = meses.find((item) => item.mes === mes);
    series.push({ mes, ingresos: Number(row?.ingresos || 0), pedidos: row?.pedidos || 0 });
  }
  const { rows: categorias } = await db.query(`SELECT m.tipo, COALESCE(SUM(i.subtotal), 0) AS monto, COUNT(i.id)::int AS lineas
    FROM pedido_item i JOIN pedido p ON p.id = i.pedido_id JOIN maquinaria m ON m.id = i.maquinaria_id
    WHERE p.estado IN ('APROBADO','EN_ENTREGA','COMPLETADO') GROUP BY m.tipo ORDER BY monto DESC LIMIT 6`);
  const { rows: roles } = await db.query('SELECT rol, COUNT(*)::int AS total FROM usuario GROUP BY rol ORDER BY rol');
  const { valores } = await readConfig(db);
  const proveedores = Number((await db.query(`SELECT COALESCE(SUM(i.subtotal), 0) AS total FROM pedido_item i
    JOIN pedido p ON p.id = i.pedido_id WHERE i.proveedor_id IS NOT NULL AND p.estado IN ('APROBADO','EN_ENTREGA','COMPLETADO')`)).rows[0].total);
  return {
    series, roles,
    categorias: categorias.map((row) => ({ ...row, monto: Number(row.monto) })),
    comisiones: cents(proveedores * valores.comision_proveedor / 100),
  };
}

// ---------------------------------------------------------------- despacho HTTP
export async function handleRegistrationRoute({ request, response, path, database, json, readJson }) {
  if (path !== '/api/auth/registro') return false;
  if (request.method !== 'POST') fail(405, 'METHOD_NOT_ALLOWED', 'El método no está permitido.');
  const body = await readJson(request);
  const { usuario } = await createPortalUser(database, null, body, { selfRegistration: true });
  json(response, 201, { id: usuario.id, nombre: usuario.nombre, correo: usuario.correo, rol: usuario.rol });
  return true;
}

function sessionTokenHash(request) {
  const values = (request.headers.cookie || '').split(';').map((s) => s.trim()).filter((s) => s.startsWith('sesion='));
  return values.length === 1 ? hashToken(values[0].slice(7)) : null;
}

export async function handlePortalRoute(context) {
  const { request, response, database, json, readJson, ruta, url } = context;
  const user = context.user || await currentUser(database, request);
  if (!user) fail(401, 'UNAUTHENTICATED', 'Inicia sesión para continuar.');
  guardPermission({ user }, ruta.permiso);
  const [param, extra] = ruta.parametros;
  switch (ruta.operacion) {
    case 'portal.resumen': return json(response, 200, await dashboard(database, user));
    case 'portal.reportes': return json(response, 200, await reports(database));
    case 'portal.configuracion.consultar': {
      const { list } = await readConfig(database);
      return json(response, 200, { tasas: list, tipos: TIPOS_MAQUINARIA, formas_pago: FORMAS_PAGO });
    }
    case 'portal.configuracion.editar': {
      const body = await readJson(request);
      const valores = body?.valores;
      if (!valores || typeof valores !== 'object' || Array.isArray(valores)) invalid('Envía las tasas a actualizar.');
      const { list } = await readConfig(database);
      const fields = {};
      const cambios = [];
      for (const [clave, raw] of Object.entries(valores)) {
        const actual = list.find((row) => row.clave === clave);
        if (!actual) { fields[clave] = 'Tasa desconocida.'; continue; }
        const valor = decimal(raw, { field: clave, required: true, min: actual.minimo, max: actual.maximo, fields });
        if (valor !== null && valor !== actual.valor) cambios.push({ clave, de: actual.valor, a: valor });
      }
      if (Object.keys(fields).length) invalid('Revisa las tasas.', fields);
      await database.transaction(async (tx) => {
        for (const cambio of cambios) {
          await tx.query(`UPDATE configuracion SET valor = $2::numeric, actualizado_en = CURRENT_TIMESTAMP, actualizado_por = $3
            WHERE clave = $1`, [cambio.clave, fixed(cambio.a), user.id]);
        }
        if (cambios.length) await audit(tx, user, 'configuracion.editar', 'configuracion', null, { cambios });
      });
      return json(response, 200, { tasas: (await readConfig(database)).list, cambios: cambios.length });
    }
    case 'portal.perfil.editar': {
      const fields = {};
      const data = validateUserFields(await readJson(request), fields);
      if (Object.keys(fields).length) invalid('Revisa tus datos.', fields);
      await database.query('UPDATE usuario SET nombre=$2, empresa=$3, telefono=$4, documento=$5 WHERE id=$1',
        [user.id, data.nombre, data.empresa, data.telefono, data.documento]);
      const { rows } = await database.query(`SELECT id, nombre, correo, rol, empresa, telefono, documento,
        creado_en::text, ultimo_acceso::text FROM usuario WHERE id = $1`, [user.id]);
      await audit(database, user, 'usuario.perfil', 'usuario', user.id);
      return json(response, 200, rows[0]);
    }
    case 'portal.perfil.clave': {
      const body = await readJson(request);
      const fields = {};
      try { validatePassword(body?.nueva); } catch { fields.nueva = 'Usa entre 8 y 256 caracteres.'; }
      if (typeof body?.nueva === 'string' && !(/[A-Za-z]/.test(body.nueva) && /\d/.test(body.nueva))) fields.nueva = 'Combina letras y números.';
      if (body?.nueva === body?.actual) fields.nueva = 'La nueva contraseña debe ser distinta.';
      const { rows } = await database.query('SELECT clave_hash FROM usuario WHERE id = $1', [user.id]);
      if (!await verifyPassword(body?.actual, rows[0]?.clave_hash)) fields.actual = 'La contraseña actual no es correcta.';
      if (Object.keys(fields).length) invalid('Revisa las contraseñas.', fields);
      const hash = await hashPassword(body.nueva);
      await database.transaction(async (tx) => {
        await tx.query('UPDATE usuario SET clave_hash = $2 WHERE id = $1', [user.id, hash]);
        // Cierra las demás sesiones abiertas y conserva la actual.
        await tx.query('DELETE FROM sesion WHERE usuario_id = $1 AND token_hash <> $2', [user.id, sessionTokenHash(request) || '']);
        await audit(tx, user, 'usuario.cambiar_clave', 'usuario', user.id);
      });
      return json(response, 200, { message: 'Contraseña actualizada. Cerramos tus otras sesiones abiertas.' });
    }
    case 'portal.catalogo.listar': return json(response, 200, await findCatalog(database, url.searchParams));
    case 'portal.catalogo.detalle': {
      const row = await productById(database, Number(param));
      const staffOrOwner = row && (STAFF.includes(user.rol) || row.proveedor_id === user.id);
      if (!row || (!staffOrOwner && (row.estado_publicacion !== 'ACTIVO' || !row.disponible))) {
        fail(404, 'PRODUCT_NOT_FOUND', 'No se encontró el equipo.');
      }
      const { rows: related } = await database.query(`SELECT ${PRODUCT_COLUMNS} FROM maquinaria m
        LEFT JOIN usuario p ON p.id = m.proveedor_id WHERE m.estado_publicacion = 'ACTIVO' AND m.disponible
        AND m.id <> $1 ORDER BY (m.tipo = $2) DESC, m.destacado DESC, m.id LIMIT 3`, [row.id, row.tipo]);
      return json(response, 200, { producto: productOut(row), ocupadas: await occupiedRanges(database, row.id),
        relacionados: related.map(productOut) });
    }
    case 'portal.imagen': {
      const { rows } = await database.query(`SELECT imagenes->>$2::int AS imagen, estado_publicacion, proveedor_id
        FROM maquinaria WHERE id = $1`, [Number(param), Number(extra)]);
      const match = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(rows[0]?.imagen || '');
      if (!match) fail(404, 'NOT_FOUND', 'No se encontró la imagen.');
      const bytes = Buffer.from(match[2], 'base64');
      response.writeHead(200, { 'Content-Type': `image/${match[1]}`, 'Content-Length': bytes.length,
        'Cache-Control': 'private, max-age=300' });
      return response.end(bytes);
    }
    case 'portal.cotizar': {
      const quote = await priceCart(database, validateCart(await readJson(request)));
      return json(response, 200, quote);
    }
    case 'portal.pedidos.listar': return json(response, 200, await listOrders(database, user, url.searchParams));
    case 'portal.pedidos.crear': {
      const order = await createOrder(database, user, await readJson(request));
      response.setHeader('Location', `/api/portal/pedidos/${order.id}`);
      return json(response, 201, order);
    }
    case 'portal.pedidos.detalle': return json(response, 200, await orderDetail(database, user, param.toLowerCase()));
    case 'portal.pedidos.cancelar': {
      const body = await readJson(request);
      const motivo = text(body?.motivo, { field: 'motivo', max: 500, multiline: true, fields: {} });
      const { rows } = await database.query('SELECT estado FROM pedido WHERE id = $1 AND cliente_id = $2', [param.toLowerCase(), user.id]);
      if (!rows[0]) fail(404, 'ORDER_NOT_FOUND', 'No se encontró el pedido.');
      if (rows[0].estado !== 'PENDIENTE') fail(409, 'INVALID_TRANSITION', 'Solo puedes cancelar pedidos pendientes de confirmación.');
      return json(response, 200, await changeOrderState(database, user, param.toLowerCase(), 'CANCELADO', motivo || 'Cancelado por el cliente.'));
    }
    case 'portal.pedidos.estado': {
      const body = await readJson(request);
      if (!ESTADOS_PEDIDO.includes(body?.estado)) invalid('Selecciona un estado válido.', { estado: 'Selecciona un estado válido.' });
      const fields = {};
      const nota = text(body?.nota, { field: 'nota', max: 500, multiline: true, fields });
      if (body.estado === 'RECHAZADO' && !nota) fields.nota = 'Explica al cliente el motivo del rechazo.';
      if (Object.keys(fields).length) invalid('Revisa la actualización.', fields);
      return json(response, 200, await changeOrderState(database, user, param.toLowerCase(), body.estado, nota));
    }
    case 'portal.productos.listar': {
      const values = [];
      const where = [];
      if (user.rol === 'proveedor') { values.push(user.id); where.push(`m.proveedor_id = $${values.length}`); }
      const estado = url.searchParams.get('estado');
      if (ESTADOS_PUBLICACION.includes(estado)) { values.push(estado); where.push(`m.estado_publicacion = $${values.length}`); }
      const { rows } = await database.query(`SELECT ${PRODUCT_COLUMNS},
        (SELECT COUNT(*)::int FROM pedido_item i WHERE i.maquinaria_id = m.id) AS pedidos
        FROM maquinaria m LEFT JOIN usuario p ON p.id = m.proveedor_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY m.actualizado_en DESC, m.id DESC`, values);
      return json(response, 200, rows.map((row) => ({ ...productOut(row), pedidos: row.pedidos })));
    }
    case 'portal.productos.detalle': {
      const row = await productById(database, Number(param));
      if (!row || (user.rol === 'proveedor' && row.proveedor_id !== user.id)) fail(404, 'PRODUCT_NOT_FOUND', 'No se encontró el producto.');
      return json(response, 200, productOut(row));
    }
    case 'portal.productos.crear': {
      const product = await saveProduct(database, user, await readJson(request, MAX_PRODUCT_BODY_BYTES));
      return json(response, 201, product);
    }
    case 'portal.productos.editar':
      return json(response, 200, await saveProduct(database, user, await readJson(request, MAX_PRODUCT_BODY_BYTES), Number(param)));
    case 'portal.productos.moderar': {
      const body = await readJson(request);
      if (!['aprobar', 'rechazar'].includes(body?.accion)) invalid('Selecciona aprobar o rechazar.');
      const fields = {};
      const motivo = text(body.motivo, { field: 'motivo', max: 500, multiline: true, fields });
      if (body.accion === 'rechazar' && !motivo) fields.motivo = 'Indica al proveedor qué debe corregir.';
      if (Object.keys(fields).length) invalid('Revisa la moderación.', fields);
      const estado = body.accion === 'aprobar' ? 'ACTIVO' : 'RECHAZADO';
      const { rows } = await database.query(`UPDATE maquinaria SET estado_publicacion = $2, motivo_rechazo = $3,
        actualizado_en = CURRENT_TIMESTAMP WHERE id = $1 AND estado_publicacion = 'PENDIENTE' RETURNING id`,
      [Number(param), estado, body.accion === 'rechazar' ? motivo : null]);
      if (!rows[0]) fail(409, 'NOT_PENDING', 'El producto ya no está pendiente de revisión.');
      await audit(database, user, `producto.${body.accion}`, 'maquinaria', param, { motivo });
      return json(response, 200, productOut(await productById(database, Number(param))));
    }
    case 'portal.usuarios.listar': {
      const roles = manageableRoles(user);
      const { rows } = await database.query(`SELECT ${USER_COLUMNS} FROM usuario u WHERE u.rol = ANY($1::text[])
        ORDER BY u.creado_en DESC`, [roles]);
      return json(response, 200, { usuarios: rows, roles_permitidos: roles });
    }
    case 'portal.usuarios.crear': {
      const result = await createPortalUser(database, user, await readJson(request));
      return json(response, 201, result);
    }
    case 'portal.usuarios.editar':
      return json(response, 200, await editPortalUser(database, user, param.toLowerCase(), await readJson(request)));
    case 'portal.usuarios.clave':
      return json(response, 200, await resetPortalPassword(database, user, param.toLowerCase()));
    case 'portal.auditoria': {
      const { rows } = await database.query(`SELECT a.id, a.accion, a.entidad, a.entidad_id, a.detalle, a.creado_en::text,
        u.nombre AS usuario, u.rol FROM auditoria a LEFT JOIN usuario u ON u.id = a.usuario_id
        ORDER BY a.creado_en DESC LIMIT 200`);
      return json(response, 200, rows);
    }
    default: fail(404, 'NOT_FOUND', 'No se encontró el recurso solicitado.');
  }
  return undefined;
}

export { ROLES_PORTAL, tienePermiso };
