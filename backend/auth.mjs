import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { permisosParaRol, tienePermiso, ROLES } from './permisos.mjs';

const derive = promisify(scrypt);
// OWASP scrypt profile: N=2^16, r=8, p=2. No password or session token is stored in clear text.
const PARAMS = { N: 65_536, r: 8, p: 2, maxmem: 128 * 1024 * 1024 };
export const SESSION_SECONDS = 28_800;
export const hashToken = token => createHash('sha256').update(token).digest('hex');
export const publicUser = ({ id, nombre, correo, rol }) => ({ id, nombre, correo, rol });
export class AuthError extends Error {
  constructor(status, code, message, fields) {
    super(message); Object.assign(this, { status, code, fields });
  }
}
export function emailAddress(value) {
  const correo = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (correo.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    throw new AuthError(400, 'VALIDATION_ERROR', 'Escribe un correo válido.', { correo: 'Escribe un correo válido.' });
  }
  return correo;
}
export function validatePassword(clave) {
  if (typeof clave !== 'string' || clave.length < 8 || clave.length > 256) {
    throw new AuthError(400, 'VALIDATION_ERROR', 'Revisa la contraseña.', { clave: 'Usa entre 8 y 256 caracteres.' });
  }
  return clave;
}
export async function hashPassword(clave) {
  validatePassword(clave);
  const salt = randomBytes(16).toString('hex');
  const key = await derive(clave, salt, 64, PARAMS);
  return `scrypt$65536$8$2$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(clave, hash) {
  if (typeof clave !== 'string' || clave.length > 256 || typeof hash !== 'string') return false;
  const parts = hash.split('$');
  if (parts.length !== 6 || parts.slice(0, 4).join('$') !== 'scrypt$65536$8$2' ||
      !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{128}$/.test(parts[5])) return false;
  const actual = await derive(clave, parts[4], 64, PARAMS);
  return timingSafeEqual(actual, Buffer.from(parts[5], 'hex'));
}
let dummyHash;
const dummyPasswordHash = () => dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
export async function createUser(database, { correo, nombre, clave, rol = 'residente' }) {
  correo = emailAddress(correo);
  if (typeof nombre !== 'string' || !nombre.trim() || nombre.trim().length > 160 || !ROLES.includes(rol)) {
    throw new AuthError(400, 'VALIDATION_ERROR', 'Revisa el nombre y el rol del usuario.');
  }
  const claveHash = await hashPassword(clave);
  const { rows } = await database.query(`INSERT INTO usuario (id, correo, nombre, clave_hash, rol)
    VALUES ($1,$2,$3,$4,$5) RETURNING id,nombre,correo,rol`, [randomUUID(), correo, nombre.trim(), claveHash, rol]);
  return rows[0];
}
export async function revokeUserSessions(database, usuarioId) {
  await database.query('DELETE FROM sesion WHERE usuario_id=$1', [usuarioId]);
}
function sessionToken(request) {
  const values = (request.headers.cookie || '').split(';').map(s => s.trim()).filter(s => s.startsWith('sesion='));
  const token = values.length === 1 ? values[0].slice(7) : '';
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
export async function currentUser(database, request) {
  const token = sessionToken(request);
  if (!token) return null;
  const { rows } = await database.query(`SELECT u.id,u.nombre,u.correo,u.rol FROM sesion s
    JOIN usuario u ON u.id=s.usuario_id WHERE s.token_hash=$1 AND s.expira_en>CURRENT_TIMESTAMP AND u.activo=TRUE`, [hashToken(token)]);
  return rows[0] || null;
}
function cookie(token, secure, seconds = SESSION_SECONDS) {
  return `sesion=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
}
export async function handleAuthRoutes({ request, response, path, database, json, readJson, secureCookies }) {
  const methods = { '/api/auth/login': 'POST', '/api/auth/logout': 'POST', '/api/auth/sesion': 'GET' };
  if (!Object.hasOwn(methods, path)) return false;
  if (request.method !== methods[path]) throw new AuthError(405, 'METHOD_NOT_ALLOWED', 'El método no está permitido.');
  if (path === '/api/auth/login') {
    const body = await readJson(request);
    const correo = emailAddress(body?.correo);
    if (typeof body?.clave !== 'string' || !body.clave || body.clave.length > 256) {
      throw new AuthError(400, 'VALIDATION_ERROR', 'Escribe tu contraseña.', { clave: 'Escribe tu contraseña.' });
    }
    const { rows } = await database.query('SELECT * FROM usuario WHERE correo=$1', [correo]);
    const user = rows[0];
    const verified = await verifyPassword(body.clave, user?.clave_hash || await dummyPasswordHash());
    if (!verified || !user?.activo) throw new AuthError(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.');
    const token = randomBytes(32).toString('base64url');
    await database.transaction(async tx => {
      // Serialize with password resets: a login checked against an old hash cannot recreate a revoked session.
      const locked = await tx.query('SELECT clave_hash,activo FROM usuario WHERE id=$1 FOR UPDATE', [user.id]);
      if (!locked.rows[0]?.activo || locked.rows[0].clave_hash !== user.clave_hash) {
        throw new AuthError(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.');
      }
      const oldToken = sessionToken(request);
      if (oldToken) await tx.query('DELETE FROM sesion WHERE token_hash=$1', [hashToken(oldToken)]);
      await tx.query(`INSERT INTO sesion (id,usuario_id,token_hash,expira_en)
        VALUES ($1,$2,$3,CURRENT_TIMESTAMP + INTERVAL '8 hours')`, [randomUUID(), user.id, hashToken(token)]);
      await tx.query('UPDATE usuario SET ultimo_acceso=CURRENT_TIMESTAMP WHERE id=$1', [user.id]);
    });
    response.setHeader('Set-Cookie', cookie(token, secureCookies));
    json(response, 200, publicUser(user));
  } else if (path === '/api/auth/logout') {
    const token = sessionToken(request);
    if (token) await database.query('DELETE FROM sesion WHERE token_hash=$1', [hashToken(token)]);
    response.setHeader('Set-Cookie', cookie('', secureCookies, 0));
    json(response, 200, { ok: true });
  } else {
    const user = await currentUser(database, request);
    if (!user) throw new AuthError(401, 'UNAUTHENTICATED', 'Inicia sesión para continuar.');
    json(response, 200, { ...publicUser(user), permisos: permisosParaRol(user.rol) });
  }
  return true;
}
const PUBLIC_FILES = new Set(['/login.html','/login.js','/auth-form.js','/recuperar.html','/recuperar.js',
  '/restablecer.html','/restablecer.js','/registro.html','/registro.js','/styles.css','/favicon.svg']);
// Recursos estáticos sin datos (marca, estilos, iconos, fotos de catálogo).
const PUBLIC_PREFIXES = ['/assets/'];
export async function guardSession(context) {
  const { request, response, path, database } = context;
  if (path === '/api/health' || path.startsWith('/api/auth/') || PUBLIC_FILES.has(path) ||
      (PUBLIC_PREFIXES.some(prefix => path.startsWith(prefix)) && !path.includes('..'))) return false;
  response.setHeader('Cache-Control', 'no-store');
  const user = await currentUser(database, request);
  if (user) {
    context.user = user;
    return false;
  }
  if (['GET', 'HEAD'].includes(request.method) && ['/', '/index.html', '/app.html'].includes(path)) {
    response.writeHead(302, { Location: '/login.html' }); response.end(); return true;
  }
  throw new AuthError(401, 'UNAUTHENTICATED', 'Inicia sesión para continuar.');
}
export function guardPermission({ user }, permiso) {
  if (!user) throw new AuthError(401, 'UNAUTHENTICATED', 'Inicia sesión para continuar.');
  if (!tienePermiso(user.rol, permiso)) {
    throw new AuthError(403, 'FORBIDDEN', 'No tienes permiso para realizar esta acción.');
  }
}
export function checkRequestOrigin(request, { secureCookies, appUrl }) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method) || !request.headers.origin) return;
  const expected = appUrl ? new URL(appUrl).origin : `${secureCookies ? 'https' : 'http'}://${request.headers.host}`;
  if (request.headers.origin !== expected) throw new AuthError(403, 'INVALID_ORIGIN', 'El origen de la solicitud no está permitido.');
}
