const originalFetch = window.fetch.bind(window);
let redirecting = false;
function login() {
  if (redirecting) return;
  redirecting = true;
  // Remove contract and customer data before navigating, including pages restored from history.
  document.querySelector('main')?.replaceChildren();
  location.replace('/login.html');
}
window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  const target = new URL(args[0] instanceof Request ? args[0].url : args[0], location.href);
  if (response.status === 401 && target.origin === location.origin && target.pathname.startsWith('/api/')) login();
  return response;
};
async function loadSession() {
  try {
    const response = await originalFetch('/api/auth/sesion', { cache: 'no-store' });
    if (response.status === 401) return login();
    if (!response.ok) throw new Error('No se pudo comprobar la sesión. Recarga la página.');
    const user = await response.json();
    if (document.getElementById('session-user')) return;
    const container = document.createElement('div'); container.id = 'session-user'; container.className = 'session-user';
    const name = document.createElement('span'); name.textContent = user.nombre;
    const close = document.createElement('button'); close.type = 'button'; close.className = 'retry-button'; close.textContent = 'Cerrar sesión';
    close.addEventListener('click', async () => {
      close.disabled = true;
      try {
        const result = await originalFetch('/api/auth/logout', { method: 'POST' });
        if (!result.ok) throw new Error('No se pudo cerrar la sesión.');
        login();
      } catch { name.textContent = 'No se pudo cerrar la sesión. Inténtalo de nuevo.'; close.disabled = false; }
    });
    container.append(name, close); document.querySelector('.header-inner').append(container);
  } catch {
    const error = document.createElement('p'); error.setAttribute('role', 'alert');
    error.textContent = 'No se pudo comprobar la sesión. Recarga la página.';
    document.querySelector('main')?.replaceChildren(error);
  }
}
window.addEventListener('pageshow', event => { if (event.persisted) { document.querySelector('main')?.replaceChildren(); location.reload(); } });
await loadSession();
