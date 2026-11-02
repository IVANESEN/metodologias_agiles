import { createHash, randomUUID } from 'node:crypto';
import { AuthError, guardPermission } from './auth.mjs';

const fail = (status, code, message) => { throw new AuthError(status, code, message); };
const COLUMNS = 'id, contrato_id, orden, estado, intentos, ultimo_error, proveedor_id, usuario_id, creado_en::text, actualizado_en::text';
const orderKey = order => createHash('sha256').update(JSON.stringify(order)).digest('hex');

// El equipo debe elegir canal y destino. No se reutiliza el correo de recuperación.
// El adaptador real debe garantizar idempotencia duradera con esta misma clave.
export function createMemoryDispatchAdapter({ failFirst = false } = {}) {
  const received = new Map();
  const attempts = [];
  return {
    available: true, idempotent: true, channel: 'SIMULADO', received, attempts,
    async send({ idempotencyKey, order }) {
      attempts.push(idempotencyKey);
      if (failFirst && attempts.length === 1) throw new Error('SIMULATED_FAILURE');
      if (!received.has(idempotencyKey)) received.set(idempotencyKey, { id: randomUUID(), order: structuredClone(order) });
      return { id: received.get(idempotencyKey).id };
    },
  };
}

async function loadOrder(tx, contractId) {
  const { rows } = await tx.query(`SELECT id, cliente, ciudad, fecha_inicio::text, fecha_fin::text
    FROM contrato WHERE id = $1 FOR UPDATE`, [contractId]);
  if (!rows[0]) fail(404, 'CONTRACT_NOT_FOUND', 'No se encontró el contrato.');
  const schedule = await tx.query(`SELECT fecha_entrega::text, to_char(hora_desde,'HH24:MI') AS hora_desde,
    to_char(hora_hasta,'HH24:MI') AS hora_hasta, transportista,
    to_char(actualizado_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS actualizado_en,
    to_char(actualizado_en AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS revision
    FROM entrega_programada WHERE contrato_id = $1`, [contractId]);
  if (!schedule.rows[0]) fail(409, 'DELIVERY_NOT_SCHEDULED', 'Programa fecha, ventana y transportista antes de enviar el despacho.');
  const equipment = await tx.query(`SELECT maquinaria_id, maquinaria_nombre FROM contrato_maquinaria
    WHERE contrato_id = $1 ORDER BY maquinaria_id`, [contractId]);
  const { revision, ...entrega } = schedule.rows[0];
  return { contrato: rows[0], entrega, revision_programacion: revision, carga: equipment.rows };
}

/**
 * El bloqueo del contrato serializa envío/reprogramación. Se mantiene durante
 * el envío (adaptador debe tener timeout <=10s). La clave sobre el contenido
 * evita duplicación externa incluso si el proceso cae antes del commit.
 */
export async function enviarDespacho(db, contractId, body, user, adapter) {
  guardPermission({ user }, 'entregas.programar');
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      (body.reintentar !== undefined && typeof body.reintentar !== 'boolean')) fail(400, 'VALIDATION_ERROR', 'Envía reintentar como booleano.');
  return db.transaction(async tx => {
    const order = await loadOrder(tx, contractId);
    const id = orderKey(order);
    await tx.query(`INSERT INTO despacho_notificacion (id, contrato_id, orden, estado, usuario_id)
      VALUES ($1,$2,$3::jsonb,'PENDIENTE',$4) ON CONFLICT (id) DO NOTHING`, [id, contractId, JSON.stringify(order), user.id]);
    const current = (await tx.query(`SELECT ${COLUMNS} FROM despacho_notificacion WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (current.estado === 'ENVIADO' || (current.estado === 'FALLIDO' && !body.reintentar)) return { notificacion: current, replayed: true };
    let providerId = null;
    let errorMessage = null;
    if (!adapter?.available || !adapter.idempotent || typeof adapter.send !== 'function') {
      errorMessage = 'Canal de despacho sin configurar: acuerden canal, destino e idempotencia del proveedor.';
    } else {
      try {
        const signal = AbortSignal.timeout(10_000);
        // El proveedor debe respetar signal; la espera también se corta aquí si
        // su implementación ignora la cancelación. El retry conserva la clave.
        let timeout;
        const expired = new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('DISPATCH_TIMEOUT')), 10_000);
          timeout.unref();
        });
        let result;
        try { result = await Promise.race([adapter.send({ idempotencyKey: id, order, signal }), expired]); }
        finally { clearTimeout(timeout); }
        if (typeof result?.id !== 'string' || !result.id || result.id.length > 160) throw new Error('INVALID_RECEIPT');
        providerId = result.id;
      } catch {
        // No guardar excepciones del proveedor: pueden contener credenciales.
        errorMessage = 'No se confirmó el envío. Reintenta con la misma clave; el proveedor debe evitar duplicados.';
      }
    }
    const state = errorMessage ? 'FALLIDO' : 'ENVIADO';
    const number = current.intentos + 1;
    await tx.query(`INSERT INTO despacho_intento (id, notificacion_id, numero, estado, error, usuario_id)
      VALUES ($1,$2,$3,$4,$5,$6)`, [randomUUID(), id, number, state, errorMessage, user.id]);
    const saved = await tx.query(`UPDATE despacho_notificacion SET estado=$2, intentos=$3, ultimo_error=$4,
      proveedor_id=$5, actualizado_en=CURRENT_TIMESTAMP WHERE id=$1 RETURNING ${COLUMNS}`,
    [id, state, number, errorMessage, providerId]);
    return { notificacion: saved.rows[0], replayed: false };
  });
}

export async function consultarDespachos(db, contractId) {
  return db.transaction(async tx => {
    if (!(await tx.query('SELECT id FROM contrato WHERE id=$1 FOR UPDATE', [contractId])).rows[0]) fail(404, 'CONTRACT_NOT_FOUND', 'No se encontró el contrato.');
    const scheduled = (await tx.query('SELECT contrato_id FROM entrega_programada WHERE contrato_id=$1', [contractId])).rows[0];
    // La UI recibe la clave vigente calculada con la revisión completa, sin
    // comparar marcas de tiempo truncadas ni confundir una orden histórica.
    const currentKey = scheduled ? orderKey(await loadOrder(tx, contractId)) : null;
    const { rows } = await tx.query(`SELECT ${COLUMNS} FROM despacho_notificacion WHERE contrato_id=$1 ORDER BY creado_en,id`, [contractId]);
    const attempts = await tx.query(`SELECT i.id, i.notificacion_id, i.numero, i.estado, i.error, i.usuario_id, i.creado_en::text
      FROM despacho_intento i JOIN despacho_notificacion n ON n.id=i.notificacion_id WHERE n.contrato_id=$1 ORDER BY i.creado_en,i.numero`, [contractId]);
    return { notificaciones: rows, intentos: attempts.rows, vigente_id: currentKey };
  });
}
