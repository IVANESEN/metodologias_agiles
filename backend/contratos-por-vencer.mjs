// Contratos por vencer (HU4a). Un contrato "vence" si su fecha_fin cae entre
// hoy y hoy + N días, ambos incluidos; los ya vencidos y los más lejanos quedan
// fuera. No se filtra por fecha_inicio: un contrato que aún no inicia también
// cuenta si su fecha_fin cae en el umbral. "Hoy" se calcula en
// America/El_Salvador (UTC-6, sin horario de verano) y no con la fecha del
// servidor, que corre en UTC: pasadas las 6 p. m. en El Salvador el día UTC ya
// es el siguiente y el conteo se correría un día.
export const DIAS_POR_DEFECTO = 7;
export const DIAS_MAXIMO = 365;

const DIA_EL_SALVADOR = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/El_Salvador', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function hoyElSalvador(fecha = new Date()) {
  const partes = Object.fromEntries(DIA_EL_SALVADOR.formatToParts(fecha).map(({ type, value }) => [type, value]));
  return `${partes.year}-${partes.month}-${partes.day}`;
}

// Recibe el texto de ?dias= (null si no viene) y devuelve { dias } o { error }.
// La ruta es quien lanza el ApiError, para no importar app.mjs desde aquí.
export function validarDias(valor) {
  if (valor === null || valor === undefined) return { dias: DIAS_POR_DEFECTO };
  if (typeof valor !== 'string' || !/^[1-9]\d{0,2}$/.test(valor) || Number(valor) > DIAS_MAXIMO) {
    return { error: `Indica un número entero de días entre 1 y ${DIAS_MAXIMO}.` };
  }
  return { dias: Number(valor) };
}

// Dos consultas fijas (contratos y luego sus máquinas), sin una consulta por
// contrato. Las fechas y los días restantes los calcula la base.
export async function buscarPorVencer(database, { hoy, dias }) {
  const { rows } = await database.query(
    `SELECT id, cliente, ciudad, fecha_inicio::text, fecha_fin::text,
       (fecha_fin - $1::date)::integer AS dias_restantes
     FROM contrato
     WHERE estado = 'CONFIRMADO' AND fecha_fin >= $1::date AND fecha_fin <= $1::date + $2::integer
     ORDER BY fecha_fin, creado_en, id`,
    [hoy, dias],
  );
  if (!rows.length) return [];
  const machines = await database.query(
    `SELECT contrato_id, maquinaria_id, maquinaria_nombre FROM contrato_maquinaria
     WHERE contrato_id = ANY($1::uuid[]) ORDER BY maquinaria_id`,
    [rows.map((row) => row.id)],
  );
  const porContrato = new Map(rows.map((row) => [row.id, []]));
  for (const machine of machines.rows) {
    porContrato.get(machine.contrato_id)?.push({
      maquinaria_id: Number(machine.maquinaria_id), maquinaria_nombre: machine.maquinaria_nombre,
    });
  }
  return rows.map((row) => ({
    id: row.id, cliente: row.cliente, ciudad: row.ciudad,
    fecha_inicio: row.fecha_inicio, fecha_fin: row.fecha_fin,
    dias_restantes: Number(row.dias_restantes), maquinarias: porContrato.get(row.id),
  }));
}
