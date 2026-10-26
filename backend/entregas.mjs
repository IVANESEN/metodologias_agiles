// HU9a: programación de entrega y transportista. Supuestos documentados: un solo
// flete por contrato y fecha de entrega entre hoy (El Salvador) y la fecha de fin
// del contrato. Este módulo no importa app.mjs ni lanza ApiError: devuelve
// { fields } o { noEncontrado } y la ruta decide la respuesta HTTP.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HORA_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const TRANSPORTISTA_MIN = 2;
export const TRANSPORTISTA_MAX = 160;

// Fechas y horas salen como texto desde SQL, sin depender de la zona del servidor.
const COLUMNAS = `contrato_id, fecha_entrega::text AS fecha_entrega,
  to_char(hora_desde, 'HH24:MI') AS hora_desde, to_char(hora_hasta, 'HH24:MI') AS hora_hasta,
  transportista, to_char(actualizado_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS actualizado_en`;

function fechaValida(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function validarHora(value, faltante) {
  if (value === undefined || value === null || value === '') return faltante;
  if (typeof value !== 'string' || !HORA_PATTERN.test(value)) return 'Usa el formato HH:MM de 24 horas.';
  return null;
}

/** Devuelve { datos } normalizados o { fields } con un mensaje por campo. */
export function validarEntrega(body, hoy) {
  const entrada = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const fields = {};
  if (typeof entrada.contrato_id !== 'string' || !UUID_PATTERN.test(entrada.contrato_id)) {
    fields.contrato_id = 'El identificador del contrato no es válido.';
  }
  if (!fechaValida(entrada.fecha_entrega)) {
    fields.fecha_entrega = 'Indica una fecha de entrega válida.';
  } else if (entrada.fecha_entrega < hoy) {
    fields.fecha_entrega = 'La fecha de entrega no puede ser anterior a hoy.';
  }
  const errorDesde = validarHora(entrada.hora_desde, 'Indica la hora de inicio de la ventana de entrega.');
  const errorHasta = validarHora(entrada.hora_hasta, 'Indica la hora final de la ventana de entrega.');
  if (errorDesde) fields.hora_desde = errorDesde;
  if (errorHasta) fields.hora_hasta = errorHasta;
  if (!errorDesde && !errorHasta && entrada.hora_hasta <= entrada.hora_desde) {
    fields.hora_hasta = 'La hora final debe ser posterior a la hora de inicio.';
  }
  const transportista = typeof entrada.transportista === 'string' ? entrada.transportista.trim() : '';
  if (transportista.length < TRANSPORTISTA_MIN) {
    fields.transportista = 'Indica el transportista (al menos 2 caracteres).';
  } else if (transportista.length > TRANSPORTISTA_MAX) {
    fields.transportista = `El transportista admite como máximo ${TRANSPORTISTA_MAX} caracteres.`;
  }
  if (Object.keys(fields).length) return { fields };
  return { datos: {
    contrato_id: entrada.contrato_id.toLowerCase(), fecha_entrega: entrada.fecha_entrega,
    hora_desde: entrada.hora_desde, hora_hasta: entrada.hora_hasta, transportista,
  } };
}

const mismaEntrega = (actual, datos) => actual.fecha_entrega === datos.fecha_entrega &&
  actual.hora_desde === datos.hora_desde && actual.hora_hasta === datos.hora_hasta &&
  actual.transportista === datos.transportista;

/**
 * Crea o reprograma la entrega. Bloquea la fila del contrato para validar la fecha
 * de fin y serializar dos reprogramaciones simultáneas del mismo contrato.
 * Devuelve { creada, entrega }, { noEncontrado } o { fields }.
 */
export async function guardarEntrega(database, datos, hoy) {
  try {
    return await database.transaction(async (tx) => {
      const contrato = await tx.query('SELECT fecha_fin::text AS fecha_fin FROM contrato WHERE id = $1 FOR UPDATE',
        [datos.contrato_id]);
      if (!contrato.rows[0]) return { noEncontrado: true };
      const fechaFin = contrato.rows[0].fecha_fin;
      if (fechaFin < hoy) {
        return { fields: { fecha_entrega: `El contrato terminó el ${fechaFin}; ya no se puede programar su entrega.` } };
      }
      if (datos.fecha_entrega > fechaFin) {
        return { fields: { fecha_entrega: `La entrega debe ser a más tardar el ${fechaFin}, fecha de fin del contrato.` } };
      }
      const valores = [datos.contrato_id, datos.fecha_entrega, datos.hora_desde, datos.hora_hasta, datos.transportista];
      const actual = await tx.query(`SELECT ${COLUMNAS} FROM entrega_programada WHERE contrato_id = $1`, [datos.contrato_id]);
      if (actual.rows[0]) {
        // Un reintento idéntico no cambia nada, ni siquiera la fecha de actualización.
        if (mismaEntrega(actual.rows[0], datos)) return { creada: false, entrega: actual.rows[0] };
        const { rows } = await tx.query(`UPDATE entrega_programada SET fecha_entrega = $2, hora_desde = $3,
          hora_hasta = $4, transportista = $5, actualizado_en = CURRENT_TIMESTAMP
          WHERE contrato_id = $1 RETURNING ${COLUMNAS}`, valores);
        return { creada: false, entrega: rows[0] };
      }
      const { rows } = await tx.query(`INSERT INTO entrega_programada
        (contrato_id, fecha_entrega, hora_desde, hora_hasta, transportista)
        VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNAS}`, valores);
      return { creada: true, entrega: rows[0] };
    });
  } catch (error) {
    // Última barrera: las restricciones de la base rechazan lo que la validación no vio.
    if (error.code === '23514') return { fields: { general: 'La entrega no cumple las restricciones de almacenamiento.' } };
    throw error;
  }
}

/** Devuelve { estado, entrega } o { noEncontrado }. */
export async function consultarEntrega(database, contratoId) {
  const contrato = await database.query('SELECT id FROM contrato WHERE id = $1', [contratoId]);
  if (!contrato.rows[0]) return { noEncontrado: true };
  const { rows } = await database.query(`SELECT ${COLUMNAS} FROM entrega_programada WHERE contrato_id = $1`, [contratoId]);
  return rows[0] ? { estado: 'PROGRAMADA', entrega: rows[0] } : { estado: 'SIN_PROGRAMAR', entrega: null };
}
