import { randomBytes, randomUUID } from 'node:crypto';
import { AuthError, emailAddress, hashPassword, validatePassword, revokeUserSessions, hashToken } from './auth.mjs';
import { createMailer } from './mailer.mjs';

const GENERIC_MESSAGE = 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.';
const invalidToken = () => new AuthError(400, 'INVALID_TOKEN', 'El enlace no es válido, venció o ya fue usado.');
class DeliveryError extends Error {}

function recoveryOrigin(request, appUrl, secureCookies) {
  // Production links cannot trust arbitrary Host / X-Forwarded-Host headers.
  if (secureCookies && !appUrl) throw new AuthError(503, 'RECOVERY_UNAVAILABLE', 'La recuperación no está disponible temporalmente.');
  let url;
  try { url = new URL(appUrl || `http://${request.headers.host}`); } catch { throw new AuthError(503, 'RECOVERY_UNAVAILABLE', 'La recuperación no está disponible temporalmente.'); }
  if (!['http:', 'https:'].includes(url.protocol) || (secureCookies && url.protocol !== 'https:') || url.username || url.password) {
    throw new AuthError(503, 'RECOVERY_UNAVAILABLE', 'La recuperación no está disponible temporalmente.');
  }
  return url.origin;
}

export async function handleRecoveryRoutes({ request, response, path, database, json, readJson, mailer, appUrl, secureCookies }) {
  if (!['/api/auth/recuperar', '/api/auth/restablecer'].includes(path)) return false;
  if (request.method !== 'POST') throw new AuthError(405, 'METHOD_NOT_ALLOWED', 'El método no está permitido.');
  const body = await readJson(request);
  if (path === '/api/auth/recuperar') {
    const correo = emailAddress(body?.correo);
    const delivery = mailer || createMailer();
    if (delivery.available === false) throw new AuthError(503, 'RECOVERY_UNAVAILABLE', 'La recuperación no está disponible temporalmente.');
    const origin = recoveryOrigin(request, appUrl, secureCookies);
    try {
      await database.transaction(async tx => {
        // Lock the user first, as login and password reset do, to serialize replacement links.
        const { rows } = await tx.query('SELECT id,activo FROM usuario WHERE correo=$1 FOR UPDATE', [correo]);
        if (!rows[0]?.activo) return;
        const userId = rows[0].id;
        const token = randomBytes(32).toString('base64url');
        await tx.query('UPDATE token_recuperacion SET usado_en=CURRENT_TIMESTAMP WHERE usuario_id=$1 AND usado_en IS NULL', [userId]);
        await tx.query(`INSERT INTO token_recuperacion (id,usuario_id,token_hash,expira_en)
          VALUES ($1,$2,$3,CURRENT_TIMESTAMP + INTERVAL '30 minutes')`, [randomUUID(), userId, hashToken(token)]);
        const link = `${origin}/restablecer.html?token=${token}`;
        try { await delivery.send({ to: correo, subject: 'Restablece tu contraseña', text: `Abre este enlace en los próximos 30 minutos:\n${link}\nSi no solicitaste el cambio, ignora este mensaje.` }); }
        catch { throw new DeliveryError(); }
      });
    } catch (error) {
      if (!(error instanceof DeliveryError)) throw error;
      // Keep the same public response even if the provider fails, and roll back token changes.
      console.error('No se pudo enviar un correo de recuperación. Revisa el proveedor configurado.');
    }
    json(response, 202, { message: GENERIC_MESSAGE });
  } else {
    validatePassword(body?.clave);
    const token = body?.token;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalidToken();
    const digest = hashToken(token);
    const { rows } = await database.query('SELECT usuario_id FROM token_recuperacion WHERE token_hash=$1', [digest]);
    if (!rows[0]) throw invalidToken();
    const userId = rows[0].usuario_id;
    const newHash = await hashPassword(body.clave);
    await database.transaction(async tx => {
      const locked = await tx.query('SELECT activo FROM usuario WHERE id=$1 FOR UPDATE', [userId]);
      if (!locked.rows[0]?.activo) throw invalidToken();
      const consumed = await tx.query(`UPDATE token_recuperacion SET usado_en=CURRENT_TIMESTAMP
        WHERE token_hash=$1 AND usado_en IS NULL AND expira_en>clock_timestamp() RETURNING usuario_id`, [digest]);
      if (!consumed.rows.length) throw invalidToken();
      await tx.query('UPDATE usuario SET clave_hash=$1 WHERE id=$2', [newHash, userId]);
      await revokeUserSessions(tx, userId);
      await tx.query('UPDATE token_recuperacion SET usado_en=CURRENT_TIMESTAMP WHERE usuario_id=$1 AND usado_en IS NULL', [userId]);
    });
    json(response, 200, { message: 'Contraseña actualizada. Inicia sesión con tu nueva contraseña.' });
  }
  return true;
}
