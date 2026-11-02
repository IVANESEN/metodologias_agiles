// La entrega, la finalización de la renta y la devolución son hitos distintos.
// Ninguno recorta el período pactado: sólo cancelar/rechazar libera la reserva.
// Todas las entradas comparten intervalos cerrados [inicio, fin].
export const RENTAL_ORDER_STATES = Object.freeze([
  'PENDIENTE', 'APROBADO', 'EN_ENTREGA', 'COMPLETADO', 'FINALIZADO', 'DEVUELTO',
]);
const occupiedStatesSql = RENTAL_ORDER_STATES.map((state) => `'${state}'`).join(', ');

export function rentalEligibility(machine) {
  return Boolean(machine && machine.disponible && machine.estado_publicacion === 'ACTIVO' &&
    ['RENTA', 'AMBAS'].includes(machine.modalidad));
}

export function dateRangesOverlap(first, second) {
  return first.fecha_inicio <= second.fecha_fin && first.fecha_fin >= second.fecha_inicio;
}

// Los identificadores y parámetros provienen del código, nunca de una petición.
export function rentalEligibilitySql(alias = 'm', { includeAvailability = true } = {}) {
  return `${alias}.estado_publicacion = 'ACTIVO' AND ${alias}.modalidad IN ('RENTA', 'AMBAS')` +
    (includeAvailability ? ` AND ${alias}.disponible = TRUE` : '');
}

export function unoccupiedSql(alias, startParameter, endParameter) {
  return `NOT EXISTS (
    SELECT 1 FROM contrato_maquinaria cm JOIN contrato c ON c.id = cm.contrato_id
    WHERE cm.maquinaria_id = ${alias}.id AND c.estado = 'CONFIRMADO'
      AND c.fecha_inicio <= ${endParameter}::date AND c.fecha_fin >= ${startParameter}::date
  ) AND NOT EXISTS (
    SELECT 1 FROM pedido_item pi JOIN pedido p ON p.id = pi.pedido_id
    WHERE pi.maquinaria_id = ${alias}.id AND pi.modalidad = 'RENTA'
      AND p.estado IN (${occupiedStatesSql})
      AND pi.fecha_inicio <= ${endParameter}::date AND pi.fecha_fin >= ${startParameter}::date
  )`;
}

export async function occupiedRanges(db, machineId, { from = null } = {}) {
  const { rows } = await db.query(`
    SELECT c.fecha_inicio::text, c.fecha_fin::text, 'CONTRATO' AS origen
      FROM contrato_maquinaria cm JOIN contrato c ON c.id = cm.contrato_id
      WHERE cm.maquinaria_id = $1 AND c.estado = 'CONFIRMADO'
        AND ($2::date IS NULL OR c.fecha_fin >= $2::date)
    UNION ALL
    SELECT i.fecha_inicio::text, i.fecha_fin::text, 'PEDIDO' AS origen
      FROM pedido_item i JOIN pedido p ON p.id = i.pedido_id
      WHERE i.maquinaria_id = $1 AND i.modalidad = 'RENTA' AND p.estado = ANY($3::text[])
        AND ($2::date IS NULL OR i.fecha_fin >= $2::date)
    ORDER BY 1, 2`, [machineId, from, RENTAL_ORDER_STATES]);
  return rows;
}

// Ejecutar tras bloquear maquinaria por id ascendente dentro de la transacción
// que guarda el contrato/pedido. La consulta fresca observa al escritor anterior.
export async function overlappingMachine(db, ids, start, end) {
  const { rows } = await db.query(`SELECT m.id AS maquinaria_id FROM maquinaria m
    WHERE m.id = ANY($1::integer[]) AND NOT (${unoccupiedSql('m', '$2', '$3')})
    ORDER BY m.id LIMIT 1`, [ids, start, end]);
  return rows[0] || null;
}
