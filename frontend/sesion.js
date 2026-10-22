const originalFetch = window.fetch.bind(window);
const permissions = new Set();
let authenticated = false;
let redirecting = false;

export function hasPermission(permission) {
  return authenticated && permissions.has(permission);
}

export function showPermissionNotice(message = 'No tienes permiso para realizar esta acción.') {
  const notice = document.getElementById('permission-notice');
  if (notice) { notice.textContent = message; notice.hidden = false; }
}

export function requirePermission(permission) {
  if (hasPermission(permission)) return true;
  showPermissionNotice();
  return false;
}

function login() {
  if (redirecting) return;
  redirecting = true;
  authenticated = false;
  permissions.clear();
  // Remove customer data before navigating, including pages restored from history.
  document.querySelector('main')?.replaceChildren();
  location.replace('/login.html');
}

window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  const target = new URL(args[0] instanceof Request ? args[0].url : args[0], location.href);
  if (target.origin === location.origin && target.pathname.startsWith('/api/')) {
    if (response.status === 401) login();
    else if (response.status === 403) showPermissionNotice();
  }
  return response;
};

function checkSection() {
  const id = location.hash.slice(1);
  const section = document.getElementById(id);
  if (!section?.dataset.permission || hasPermission(section.dataset.permission)) return;
  const fallback = [...document.querySelectorAll('[data-permission][id]')]
    .find(node => hasPermission(node.dataset.permission) && !node.hidden);
  const target = new URL(location.href);
  target.hash = fallback?.id || '';
  window.history.replaceState(null, '', target);
  showPermissionNotice('No tienes permiso para acceder a esta sección.');
  fallback?.scrollIntoView({ block: 'start' });
}

async function loadSession() {
  const status = document.getElementById('session-status');
  const main = document.querySelector('main');
  let permissionDenied = false;
  try {
    const response = await originalFetch('/api/auth/sesion', { cache: 'no-store' });
    if (response.status === 401) { login(); return null; }
    permissionDenied = response.status === 403;
    if (!response.ok) throw new Error('sesión');
    const user = await response.json();
    if (!user || typeof user.nombre !== 'string' || !Array.isArray(user.permisos)
      || !user.permisos.every(permission => typeof permission === 'string')) throw new Error('sesión');
    for (const permission of user.permisos) permissions.add(permission);
    authenticated = true;
    for (const node of document.querySelectorAll('[data-permission]')) node.hidden = !hasPermission(node.dataset.permission);

    const container = document.createElement('div'); container.id = 'session-user'; container.className = 'session-user';
    const name = document.createElement('span'); name.textContent = user.nombre;
    const close = document.createElement('button'); close.type = 'button'; close.className = 'retry-button'; close.textContent = 'Cerrar sesión';
    close.addEventListener('click', async () => {
      close.disabled = true;
      try {
        const result = await window.fetch('/api/auth/logout', { method: 'POST' });
        if (!result.ok) throw new Error('No se pudo cerrar la sesión.');
        login();
      } catch { name.textContent = 'No se pudo cerrar la sesión. Inténtalo de nuevo.'; close.disabled = false; }
    });
    container.append(name, close); document.querySelector('.header-inner').append(container);
    if (status) status.hidden = true;
    if (main) main.hidden = false;
    checkSection();
    window.addEventListener('hashchange', checkSection);
    return user;
  } catch {
    authenticated = false;
    permissions.clear();
    if (main) main.hidden = true;
    for (const node of document.querySelectorAll('[data-permission]')) node.hidden = true;
    if (status) {
      status.setAttribute('role', 'alert');
      status.textContent = permissionDenied ? 'No tienes permiso para acceder a esta aplicación.' : 'No se pudo comprobar la sesión. Recarga la página.';
      status.hidden = false;
    }
    return null;
  }
}

window.addEventListener('pageshow', event => {
  if (event.persisted) {
    authenticated = false;
    permissions.clear();
    document.querySelector('main')?.replaceChildren();
    location.reload();
  }
});

// Los módulos concurrentes comparten una consulta y esperan antes de iniciar paneles.
export const sessionReady = loadSession();
