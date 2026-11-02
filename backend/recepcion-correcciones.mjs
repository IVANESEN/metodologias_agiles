import { randomUUID } from 'node:crypto';
import { AuthError, guardPermission } from './auth.mjs';
import { validarFotografia } from './imagenes.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const columns = 'id, recepcion_id, version, fotos, motivo, usuario_id, creado_en::text';
const fail = (status, code, message) => { throw new AuthError(status, code, message); };

export async function historialEvidencia(db, id) {
  const { rows } = await db.query(`SELECT id, contrato_id, maquinaria_id, horometro, fotos,
    fecha_recepcion::text FROM recepcion_maquinaria WHERE id = $1`, [id]);
  if (!rows[0]) fail(404, 'RECEPTION_NOT_FOUND', 'No se encontró la recepción.');
  const corrections = await db.query(`SELECT ${columns} FROM recepcion_correccion
    WHERE recepcion_id = $1 ORDER BY version`, [id]);
  return { original: rows[0], correcciones: corrections.rows, version: corrections.rows.length };
}

/** El original nunca se sobrescribe; la versión esperada evita correcciones perdidas. */
export async function corregirEvidencia(db, receptionId, body, user) {
  guardPermission({ user }, 'contratos.modificaciones.autorizar');
  receptionId = receptionId.toLowerCase();
  if (!body || !UUID.test(body.id || '') || !Number.isInteger(body.version) || body.version < 0 ||
      typeof body.motivo !== 'string' || body.motivo.trim().length < 10 || body.motivo.trim().length > 500 ||
      /[\u0000-\u001f\u007f]/.test(body.motivo) || !Array.isArray(body.fotos) || body.fotos.length < 1 || body.fotos.length > 5) {
    fail(400, 'VALIDATION_ERROR', 'Indica id UUID, versión actual, entre 1 y 5 fotos y un motivo de 10 a 500 caracteres.');
  }
  try { for (const photo of body.fotos) await validarFotografia(photo); }
  catch (error) { fail(400, 'INVALID_PHOTO', error.message); }
  const correctionId = body.id.toLowerCase();
  const reason = body.motivo.trim();
  return db.transaction(async tx => {
    const original = await tx.query('SELECT id, fotos FROM recepcion_maquinaria WHERE id = $1 FOR UPDATE', [receptionId]);
    if (!original.rows[0]) fail(404, 'RECEPTION_NOT_FOUND', 'No se encontró la recepción.');
    const previous = await tx.query(`SELECT ${columns} FROM recepcion_correccion WHERE id = $1`, [correctionId]);
    if (previous.rows[0]) {
      const p = previous.rows[0];
      if (p.recepcion_id !== receptionId || p.usuario_id !== user.id || p.version !== body.version + 1 ||
          p.motivo !== reason || JSON.stringify(p.fotos) !== JSON.stringify(body.fotos)) {
        fail(409, 'CORRECTION_ID_CONFLICT', 'El identificador pertenece a otra corrección.');
      }
      return { correccion: p, replayed: true };
    }
    const { rows } = await tx.query(`SELECT version, fotos FROM recepcion_correccion
      WHERE recepcion_id = $1 ORDER BY version DESC LIMIT 1`, [receptionId]);
    if ((rows[0]?.version || 0) !== body.version) fail(409, 'EVIDENCE_VERSION_CONFLICT', 'La evidencia cambió. Consulta su historial antes de corregirla.');
    let invalid = false;
    for (const photo of rows[0]?.fotos || original.rows[0].fotos) {
      try { await validarFotografia(photo); } catch { invalid = true; }
    }
    if (!invalid) fail(409, 'VALID_EVIDENCE', 'La evidencia vigente es legible. Esta operación solo corrige fotografías inválidas.');
    const inserted = await tx.query(`INSERT INTO recepcion_correccion
      (id, recepcion_id, version, fotos, motivo, usuario_id) VALUES ($1,$2,$3,$4::jsonb,$5,$6)
      ON CONFLICT (id) DO NOTHING RETURNING ${columns}`,
    [correctionId, receptionId, body.version + 1, JSON.stringify(body.fotos), reason, user.id]);
    if (!inserted.rows[0]) fail(409, 'CORRECTION_ID_CONFLICT', 'El identificador pertenece a otra corrección.');
    await tx.query(`INSERT INTO auditoria (id, usuario_id, accion, entidad, entidad_id, detalle)
      VALUES ($1,$2,'recepcion.corregir','recepcion',$3,$4::jsonb)`,
    [randomUUID(), user.id, receptionId, JSON.stringify({ correccion_id: correctionId, version: body.version + 1, motivo: reason })]);
    return { correccion: inserted.rows[0], replayed: false };
  });
}
