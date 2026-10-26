import { icon } from './icons.js';

export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.error?.message || 'No se pudo completar la solicitud.');
    this.status = status;
    this.code = payload?.error?.code;
    this.fields = payload?.error?.fields || {};
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method, cache: 'no-store', signal,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError(0, { error: { message: 'Sin conexión con el servidor. Revisa tu red e inténtalo de nuevo.' } });
  }
  if (response.status === 401) {
    location.replace('/login.html');
    throw new ApiError(401, { error: { message: 'Tu sesión terminó.' } });
  }
  const payload = (response.headers.get('content-type') || '').includes('json') ? await response.json() : null;
  if (!response.ok) throw new ApiError(response.status, payload);
  return payload;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);

const usd = new Intl.NumberFormat('es-SV', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const usd0 = new Intl.NumberFormat('es-SV', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const money = (value) => usd.format(Number(value || 0));
export const money0 = (value) => usd0.format(Number(value || 0));
export const number = (value) => new Intl.NumberFormat('es-SV').format(Number(value || 0));

export function date(value, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!value) return '—';
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  return new Intl.DateTimeFormat('es-SV', { timeZone: 'America/El_Salvador', ...options }).format(new Date(iso));
}
export const dateTime = (value) => date(value, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function relative(value) {
  if (!value) return 'Nunca';
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  if (Math.abs(diff) < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (Math.abs(diff) < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  if (Math.abs(diff) < 2592000) return rtf.format(-Math.round(diff / 86400), 'day');
  return date(value);
}

export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/El_Salvador' }).format(new Date());
}
export function addDays(iso, days) {
  const value = new Date(`${iso}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export const daysBetween = (start, end) => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;

export const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

export const ESTADOS = {
  PENDIENTE: 'Pendiente', APROBADO: 'Aprobado', EN_ENTREGA: 'En entrega', COMPLETADO: 'Completado',
  CANCELADO: 'Cancelado', RECHAZADO: 'Rechazado',
  BORRADOR: 'Borrador', ACTIVO: 'Publicado', ARCHIVADO: 'Archivado',
};
export const ROLES = { admin: 'Administración', empleado: 'Empleado', proveedor: 'Proveedor', cliente: 'Cliente',
  gerente: 'Gerente de obra', residente: 'Residente de obra' };
export const MODALIDAD = { RENTA: 'Renta', VENTA: 'Venta', AMBAS: 'Renta y venta', COMPRA: 'Compra' };
export const CONDICION = { NUEVO: 'Nuevo', USADO: 'Usado', REACONDICIONADO: 'Reacondicionado' };

export function badge(estado, label = ESTADOS[estado] || estado) {
  const key = String(estado).toLowerCase();
  const pendiente = estado === 'PENDIENTE';
  return `<span class="badge b-${esc(key)}">${pendiente ? icon('clock', 'icon icon-sm') : '<span class="dot"></span>'}${esc(label)}</span>`;
}

let toastHost;
export function toast(message, kind = 'info') {
  toastHost ??= Object.assign(document.body.appendChild(document.createElement('div')), { className: 'toasts' });
  toastHost.setAttribute('role', 'status');
  toastHost.setAttribute('aria-live', 'polite');
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.innerHTML = `${icon(kind === 'error' ? 'alert' : kind === 'ok' ? 'checkCircle' : 'info')}<div>${esc(message)}</div>`;
  toastHost.append(node);
  setTimeout(() => node.remove(), 4800);
}

export function modal({ title, body, actions = [], size }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ${size ? `style="width:min(${size}px,100%)"` : ''}>
      <div class="modal-head"><h2 id="modal-title">${esc(title)}</h2>
        <button class="icon-btn" type="button" data-close aria-label="Cerrar">${icon('x')}</button></div>
      <div class="modal-body"></div><div class="modal-foot"></div></div>`;
    const bodyNode = backdrop.querySelector('.modal-body');
    if (typeof body === 'string') bodyNode.innerHTML = body; else if (body) bodyNode.append(body);
    const foot = backdrop.querySelector('.modal-foot');
    const previous = document.activeElement;
    const close = (value) => { backdrop.remove(); document.removeEventListener('keydown', onKey); previous?.focus?.(); resolve(value); };
    const onKey = (event) => { if (event.key === 'Escape') close(null); };
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `btn ${action.className || 'btn-secondary'}`;
      button.innerHTML = action.label;
      button.addEventListener('click', async () => {
        if (!action.onClick) return close(action.value);
        button.disabled = true;
        try {
          const result = await action.onClick(bodyNode, close);
          if (result !== false) close(result ?? action.value);
        } finally { if (backdrop.isConnected) button.disabled = false; }
      });
      foot.append(button);
    }
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop || event.target.closest('[data-close]')) close(null); });
    document.addEventListener('keydown', onKey);
    document.body.append(backdrop);
    (backdrop.querySelector('input, select, textarea') || backdrop.querySelector('.modal-foot .btn:last-child'))?.focus();
  });
}

export function confirmDialog({ title, message, confirm = 'Confirmar', danger = false }) {
  return modal({ title, body: `<p class="muted">${esc(message)}</p>`, actions: [
    { label: 'Cancelar', value: false },
    { label: confirm, value: true, className: danger ? 'btn-danger' : '' },
  ] }).then(Boolean);
}

export function showFieldErrors(form, fields = {}) {
  for (const node of form.querySelectorAll('[data-error-for]')) { node.hidden = true; node.textContent = ''; }
  for (const node of form.querySelectorAll('[aria-invalid]')) node.removeAttribute('aria-invalid');
  let first;
  for (const [name, message] of Object.entries(fields)) {
    const input = form.querySelector(`[name="${CSS.escape(name)}"]`);
    const slot = form.querySelector(`[data-error-for="${CSS.escape(name)}"]`);
    if (input) { input.setAttribute('aria-invalid', 'true'); first ??= input; }
    if (slot) { slot.hidden = false; slot.innerHTML = `${icon('alert', 'icon icon-sm')}${esc(message)}`; }
  }
  first?.focus();
}

export function field({ name, label, type = 'text', value = '', hint = '', required = false, attrs = '', options, prefix }) {
  const id = `f-${name}`;
  let control;
  if (options) {
    control = `<select class="select" id="${id}" name="${name}" ${required ? 'required' : ''} ${attrs}>${options.map(([v, text]) =>
      `<option value="${esc(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select>`;
  } else if (type === 'textarea') {
    control = `<textarea class="textarea" id="${id}" name="${name}" ${required ? 'required' : ''} ${attrs}>${esc(value)}</textarea>`;
  } else if (prefix) {
    control = `<div class="input-group"><span class="input-prefix">${esc(prefix)}</span><input class="input with-prefix" id="${id}" name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${attrs}></div>`;
  } else {
    control = `<input class="input" id="${id}" name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${attrs}>`;
  }
  return `<div class="field"><label for="${id}">${esc(label)}${required ? ' <span aria-hidden="true" style="color:var(--danger)">*</span>' : ''}</label>${control}
    ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}<p class="error" data-error-for="${name}" hidden></p></div>`;
}

export function empty({ iconName = 'package', title, text = '', action = '' }) {
  return `<div class="empty"><div class="empty-icon">${icon(iconName, 'icon icon-lg')}</div><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${action}</div>`;
}

export function skeletonCards(count = 6) {
  return `<div class="products">${Array.from({ length: count }, () => `<div class="card" style="overflow:hidden">
    <div class="skeleton" style="aspect-ratio:4/3;border-radius:0"></div><div class="card-pad stack-sm">
    <div class="skeleton" style="height:14px;width:40%"></div><div class="skeleton" style="height:20px;width:80%"></div>
    <div class="skeleton" style="height:22px;width:50%"></div></div></div>`).join('')}</div>`;
}

// Carrito por usuario en este navegador. El servidor recalcula precios y disponibilidad.
export function createCart(userId) {
  const key = `ici.carrito.${userId}`;
  const listeners = new Set();
  const read = () => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } };
  const write = (items) => {
    try { localStorage.setItem(key, JSON.stringify(items)); } catch { /* almacenamiento no disponible */ }
    listeners.forEach((listener) => listener(items));
  };
  return {
    items: read,
    count: () => read().reduce((total, item) => total + (item.modalidad === 'COMPRA' ? item.cantidad : 1), 0),
    add(item) {
      const items = read();
      const same = items.find((other) => other.maquinaria_id === item.maquinaria_id && other.modalidad === 'COMPRA' && item.modalidad === 'COMPRA');
      if (same) same.cantidad += item.cantidad; else items.push({ ...item, key: crypto.randomUUID() });
      write(items);
    },
    update(keyId, patch) { write(read().map((item) => (item.key === keyId ? { ...item, ...patch } : item))); },
    remove(keyId) { write(read().filter((item) => item.key !== keyId)); },
    clear() { write([]); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

// Optimiza fotos en el navegador antes de enviarlas (máx. 1600 px, JPEG).
export async function compressImage(file, { maxSide = 1600, quality = 0.82, maxBytes = 1_000_000 } = {}) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Usa imágenes JPEG, PNG o WebP.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let q = quality;
  let dataUrl = canvas.toDataURL('image/jpeg', q);
  while (dataUrl.length * 0.75 > maxBytes && q > 0.45) { q -= 0.08; dataUrl = canvas.toDataURL('image/jpeg', q); }
  if (dataUrl.length * 0.75 > maxBytes) throw new Error('La imagen es demasiado pesada incluso optimizada.');
  return dataUrl;
}

export function debounce(fn, wait = 250) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
}
