import { icon, LOGO } from './icons.js';
import { api, esc, createCart, ROLES, toast, initials } from './ui.js';
import { dashboard } from './views/inicio.js';
import { catalog, productDetail, cartView } from './views/tienda.js';
import { ordersList, orderDetail } from './views/pedidos.js';
import { productsList, productEditor, moderation } from './views/productos.js';
import { usersView, ratesView, auditView, profileView } from './views/gestion.js';

const shell = document.getElementById('shell');
const sidebar = document.getElementById('sidebar');
const topbar = document.getElementById('topbar');
let view = document.getElementById('view');

// Rutas del portal: cada una declara el permiso que necesita.
const ROUTES = [
  { path: /^\/inicio$/, render: dashboard, title: 'Inicio' },
  { path: /^\/catalogo$/, render: catalog, permiso: 'tienda.consultar', title: 'Catálogo' },
  { path: /^\/producto\/(\d+)$/, render: productDetail, permiso: 'tienda.consultar', title: 'Equipo' },
  { path: /^\/carrito$/, render: cartView, permiso: 'pedidos.crear', title: 'Carrito' },
  { path: /^\/pedidos$/, render: ordersList, permiso: 'pedidos.consultar', title: 'Pedidos' },
  { path: /^\/pedido\/([0-9a-f-]{36})$/, render: orderDetail, permiso: 'pedidos.consultar', title: 'Pedido' },
  { path: /^\/productos$/, render: productsList, permiso: 'productos.consultar', title: 'Productos' },
  { path: /^\/productos\/(nuevo|\d+)$/, render: productEditor, permiso: 'productos.gestionar', title: 'Editor de producto' },
  { path: /^\/moderacion$/, render: moderation, permiso: 'productos.moderar', title: 'Moderación' },
  { path: /^\/usuarios$/, render: usersView, permiso: 'usuarios.crear', title: 'Usuarios' },
  { path: /^\/tasas$/, render: ratesView, permiso: 'configuracion.editar', title: 'Tasas y configuración' },
  { path: /^\/auditoria$/, render: auditView, permiso: 'auditoria.consultar', title: 'Auditoría' },
  { path: /^\/perfil$/, render: profileView, title: 'Mi perfil' },
];

const NAV = {
  cliente: [
    { group: 'Comprar y rentar', items: [
      ['inicio', 'home', 'Inicio'], ['catalogo', 'store', 'Catálogo'], ['carrito', 'cart', 'Carrito', 'cart'], ['pedidos', 'clipboard', 'Mis pedidos'],
    ] },
  ],
  proveedor: [
    { group: 'Mi tienda', items: [
      ['inicio', 'home', 'Resumen'], ['productos', 'package', 'Mis productos'], ['productos/nuevo', 'plus', 'Agregar producto'], ['pedidos', 'clipboard', 'Pedidos'],
    ] },
    { group: 'Mercado', items: [['catalogo', 'store', 'Catálogo público']] },
  ],
  empleado: [
    { group: 'Operación', items: [
      ['inicio', 'home', 'Panel de operación'], ['pedidos', 'clipboard', 'Pedidos', 'pending'], ['moderacion', 'shield', 'Moderación', 'moderation'],
      ['productos', 'package', 'Inventario'],
    ] },
    { group: 'Cuentas', items: [['usuarios', 'users', 'Clientes y proveedores']] },
    { group: 'Mercado', items: [['catalogo', 'store', 'Catálogo'], ['/', 'hardhat', 'Contratos de obra', null, true]] },
  ],
  admin: [
    { group: 'Dirección', items: [['inicio', 'home', 'Panel ejecutivo'], ['pedidos', 'clipboard', 'Pedidos', 'pending'], ['productos', 'package', 'Productos'],
      ['moderacion', 'shield', 'Moderación', 'moderation']] },
    { group: 'Gobierno', items: [['usuarios', 'users', 'Usuarios y roles'], ['tasas', 'percent', 'Tasas'], ['auditoria', 'history', 'Auditoría']] },
    { group: 'Mercado', items: [['catalogo', 'store', 'Catálogo'], ['/', 'hardhat', 'Contratos de obra', null, true]] },
  ],
};

const ctx = {
  user: null,
  permisos: new Set(),
  counters: { pending: 0, moderation: 0 },
  can(permiso) { return !permiso || this.permisos.has(permiso); },
  go(path) { location.hash = `#/${path.replace(/^\/+/, '')}`; },
  setTitle(title, crumb) {
    document.title = `${title} · ICI Maquinaria`;
    topbar.querySelector('[data-title]').textContent = title;
    topbar.querySelector('[data-crumb]').textContent = crumb || ROLES[ctx.user.rol];
  },
  view,
};

function renderSidebar() {
  const current = (location.hash.replace(/^#\//, '') || 'inicio').split('?')[0];
  const groups = NAV[ctx.user.rol] || [];
  // El enlace más específico que contiene la ruta actual queda resaltado.
  const matches = (path) => current === path || current.startsWith(`${path}/`) ||
    (path === 'pedidos' && current.startsWith('pedido/')) || (path === 'catalogo' && current.startsWith('producto/'));
  const activePath = groups.flatMap((group) => group.items.map((item) => item[0]))
    .filter(matches).sort((a, b) => b.length - a.length)[0];
  const pill = (key) => {
    if (key === 'cart') { const n = ctx.cart?.count() || 0; return n ? `<span class="pill">${n}</span>` : ''; }
    const n = ctx.counters[key] || 0;
    return key && n ? `<span class="pill">${n}</span>` : '';
  };
  sidebar.innerHTML = `
    <a class="brand" href="#/inicio" aria-label="ICI Maquinaria, inicio">${LOGO}<small>Maquinaria<br>pesada</small></a>
    <div class="role-card"><span class="avatar">${esc(initials(ctx.user.nombre))}</span>
      <div style="min-width:0"><strong>${esc(ctx.user.nombre)}</strong><span>${esc(ROLES[ctx.user.rol])}</span></div></div>
    ${groups.map((group) => `<nav class="nav-group" aria-label="${esc(group.group)}"><div class="nav-group-title">${esc(group.group)}</div>
      ${group.items.map(([path, ico, label, counter, external]) => {
        const active = !external && path === activePath;
        return `<a class="nav-link" href="${external ? path : `#/${path}`}" ${active ? 'aria-current="page"' : ''}>${icon(ico)}<span>${esc(label)}</span>${pill(counter)}</a>`;
      }).join('')}</nav>`).join('')}
    <div class="sidebar-foot">
      <a class="nav-link" href="#/perfil" ${current === 'perfil' ? 'aria-current="page"' : ''}>${icon('settings')}<span>Mi perfil</span></a>
      <button class="nav-link" type="button" data-logout style="border:0;background:transparent;width:100%;text-align:left">${icon('logout')}<span>Cerrar sesión</span></button>
    </div>`;
}

function renderTopbar() {
  const cliente = ctx.can('pedidos.crear');
  topbar.innerHTML = `
    <button class="icon-btn menu-toggle" type="button" data-menu aria-label="Abrir menú" aria-expanded="false">${icon('menu')}</button>
    <div class="crumbs"><small data-crumb></small><strong data-title>ICI Maquinaria</strong></div>
    ${ctx.can('tienda.consultar') ? `<form class="search" role="search" data-search>
      <div class="input-group">${icon('search')}<input class="input" name="q" type="search" placeholder="Buscar excavadoras, grúas, marcas…" aria-label="Buscar en el catálogo"></div></form>` : '<div style="margin-left:auto"></div>'}
    <div class="topbar-actions">
      ${cliente ? `<a class="icon-btn" href="#/carrito" aria-label="Ver carrito">${icon('cart')}<span class="count-dot" data-cart-count hidden></span></a>` : ''}
      <a class="icon-btn" href="#/perfil" aria-label="Mi perfil"><span class="avatar" style="width:34px;height:34px;font-size:12px">${esc(initials(ctx.user.nombre))}</span></a>
    </div>`;
  updateCartCount();
}

function updateCartCount() {
  const node = topbar.querySelector('[data-cart-count]');
  if (!node || !ctx.cart) return;
  const n = ctx.cart.count();
  node.textContent = n;
  node.hidden = !n;
}

async function refreshCounters() {
  if (!ctx.can('pedidos.gestionar')) return;
  try {
    const resumen = await api('/api/portal/resumen');
    ctx.counters.pending = resumen.kpis?.pedidos?.PENDIENTE || 0;
    ctx.counters.moderation = resumen.kpis?.por_moderar || 0;
    renderSidebar();
  } catch { /* los contadores son informativos */ }
}
ctx.refreshCounters = refreshCounters;

let cleanup;
let renderToken = 0;
async function route() {
  const [path, qs = ''] = (location.hash.replace(/^#/, '') || '/inicio').split('?');
  ctx.query = new URLSearchParams(qs);
  const match = ROUTES.map((r) => ({ r, m: r.path.exec(path) })).find(({ m }) => m);
  shell.classList.remove('nav-open');
  if (!match) { ctx.go('inicio'); return; }
  if (!ctx.can(match.r.permiso)) {
    toast('No tienes permiso para abrir esa sección.', 'error');
    ctx.go('inicio');
    return;
  }
  cleanup?.();
  cleanup = undefined;
  const token = ++renderToken;
  ctx.isCurrent = () => token === renderToken;
  renderSidebar();
  ctx.setTitle(match.r.title);
  // Contenedor nuevo por vista: los listeners de la vista anterior no se acumulan.
  const fresh = view.cloneNode(false);
  view.replaceWith(fresh);
  view = fresh;
  ctx.view = fresh;
  view.innerHTML = '<div class="row" style="justify-content:center;padding:80px 0;color:var(--azul)"><span class="spinner"></span> Cargando…</div>';
  view.classList.remove('view-enter');
  try {
    const result = await match.r.render(ctx, match.m.slice(1));
    if (token !== renderToken) return;
    if (typeof result === 'function') cleanup = result;
    void view.offsetWidth;
    view.classList.add('view-enter');
    window.scrollTo({ top: 0 });
  } catch (error) {
    if (token !== renderToken || error.status === 401) return;
    view.innerHTML = `<div class="card">${`<div class="empty"><div class="empty-icon">${icon('alert', 'icon icon-lg')}</div>
      <h3>No pudimos cargar esta sección</h3><p>${esc(error.message)}</p>
      <button class="btn btn-secondary" type="button" data-retry>${icon('refresh', 'icon icon-sm')}Reintentar</button></div>`}</div>`;
    view.querySelector('[data-retry]').addEventListener('click', route);
  }
}

async function start() {
  let session;
  try {
    session = await api('/api/auth/sesion');
  } catch { return; }
  if (!session.permisos.includes('portal.acceder')) {
    // Residentes y gerentes de obra trabajan en la operación de contratos.
    location.replace('/');
    return;
  }
  ctx.user = session;
  ctx.permisos = new Set(session.permisos);
  if (ctx.can('pedidos.crear')) {
    ctx.cart = createCart(session.id);
    ctx.cart.subscribe(() => { updateCartCount(); renderSidebar(); });
  }
  renderTopbar();
  renderSidebar();

  topbar.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-search]');
    if (!form) return;
    event.preventDefault();
    const q = new FormData(form).get('q').trim();
    sessionStorage.setItem('ici.busqueda', q);
    if (location.hash === '#/catalogo') route(); else ctx.go('catalogo');
  });
  document.addEventListener('click', async (event) => {
    if (event.target.closest('[data-menu]')) {
      const open = shell.classList.toggle('nav-open');
      event.target.closest('[data-menu]').setAttribute('aria-expanded', String(open));
      document.querySelector('.scrim')?.remove();
      if (open) {
        const scrim = Object.assign(document.createElement('div'), { className: 'scrim' });
        scrim.addEventListener('click', () => { shell.classList.remove('nav-open'); scrim.remove(); });
        document.body.append(scrim);
      }
    }
    if (event.target.closest('.sidebar a')) document.querySelector('.scrim')?.remove();
    if (event.target.closest('[data-logout]')) {
      try { await fetch('/api/auth/logout', { method: 'POST' }); } finally { location.replace('/login.html'); }
    }
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
  await route();
  refreshCounters();
}

start();
