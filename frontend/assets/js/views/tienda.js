import { icon } from '../icons.js';
import {
  api, esc, money, money0, number, toast, empty, skeletonCards, field, showFieldErrors, debounce,
  today, addDays, daysBetween, date, MODALIDAD, CONDICION,
} from '../ui.js';

export async function loadConfig(ctx) {
  ctx.config ??= await api('/api/portal/configuracion');
  return ctx.config;
}

function priceBlock(product) {
  if (product.modalidad === 'VENTA') return `<div class="product-price"><strong>${money0(product.precio_venta)}</strong><span>precio de venta</span></div>`;
  const rent = `<div class="product-price"><strong>${money0(product.tarifa_diaria)}</strong><span>por día</span></div>`;
  return product.modalidad === 'AMBAS' ? `${rent}<span class="small muted" style="margin-top:-6px">o cómprala en ${money0(product.precio_venta)}</span>` : rent;
}

export function productCard(product) {
  return `<a class="product" href="#/producto/${product.id}">
    <div class="product-media">
      ${product.imagenes[0] ? `<img src="${esc(product.imagenes[0])}" alt="${esc(product.nombre)}" loading="lazy">` : `<div class="empty">${icon('image', 'icon icon-lg')}</div>`}
      <div class="tags">${product.destacado ? `<span class="badge featured">${icon('star', 'icon icon-sm')}Destacado</span>` : ''}
        <span class="badge">${esc(MODALIDAD[product.modalidad])}</span></div>
    </div>
    <div class="product-body">
      <div class="meta">${esc(product.marca || '')}${product.anio ? ` · ${product.anio}` : ''} · ${icon('mapPin', 'icon icon-sm')}${esc(product.ubicacion || 'El Salvador')}</div>
      <h3>${esc(product.nombre)}</h3>
      ${priceBlock(product)}
      <div class="product-foot"><span>${esc(CONDICION[product.condicion] || '')}${product.horometro ? ` · ${number(product.horometro)} h` : ''}</span><span>${esc(product.proveedor)}</span></div>
    </div></a>`;
}

// ------------------------------------------------------------------ catálogo
export async function catalog(ctx) {
  const root = ctx.view;
  const state = {
    q: sessionStorage.getItem('ces.busqueda') || '',
    tipo: ctx.query.get('tipo') || '',
    modalidad: ctx.query.get('modalidad') || '',
    orden: '',
    condicion: '',
  };
  sessionStorage.removeItem('ces.busqueda');
  const search = document.querySelector('[data-search] input');
  if (search) search.value = state.q;
  root.innerHTML = `
    <div class="page-head"><div><span class="eyebrow">Catálogo</span><h1 style="margin-top:6px">Maquinaria disponible</h1>
      <p>Equipo de nuestra flota propia y de proveedores verificados. Las tarifas no incluyen IVA; el flete y el depósito se calculan al cotizar.</p></div>
      <span class="badge b-neutral" data-count></span></div>
    <div class="store-toolbar">
      <div class="row-between wrap">
        <div class="segmented" role="group" aria-label="Modalidad">
          ${[['', 'Todo'], ['RENTA', 'Renta'], ['VENTA', 'Venta']].map(([value, label]) => `<button type="button" data-modalidad="${value}" aria-pressed="${state.modalidad === value}">${label}</button>`).join('')}
        </div>
        <div class="row wrap">
          <select class="select" data-condicion aria-label="Condición" style="min-height:40px;width:auto;border-radius:999px">
            <option value="">Cualquier condición</option><option value="NUEVO">Nuevo</option><option value="USADO">Usado</option><option value="REACONDICIONADO">Reacondicionado</option></select>
          <select class="select" data-orden aria-label="Ordenar" style="min-height:40px;width:auto;border-radius:999px">
            <option value="">Destacados primero</option><option value="precio_asc">Precio: menor a mayor</option><option value="precio_desc">Precio: mayor a menor</option><option value="recientes">Más recientes</option></select>
        </div>
      </div>
      <div class="chips" data-tipos role="group" aria-label="Tipo de maquinaria"></div>
      <div data-active-search></div>
    </div>
    <div data-results>${skeletonCards(6)}</div>`;

  const results = root.querySelector('[data-results]');
  let controller;
  async function load() {
    controller?.abort();
    controller = new AbortController();
    const params = new URLSearchParams(Object.entries(state).filter(([, value]) => value));
    results.innerHTML = skeletonCards(6);
    root.querySelector('[data-active-search]').innerHTML = state.q
      ? `<span class="chip" aria-pressed="true">${icon('search', 'icon icon-sm')}“${esc(state.q)}” <button type="button" data-clear-q aria-label="Quitar búsqueda" style="border:0;background:transparent;color:inherit;display:grid">${icon('x', 'icon icon-sm')}</button></span>` : '';
    try {
      const data = await api(`/api/portal/catalogo?${params}`, { signal: controller.signal });
      if (!ctx.isCurrent()) return;
      const total = data.tipos.reduce((sum, row) => sum + row.total, 0);
      root.querySelector('[data-tipos]').innerHTML = [['', 'Todos', total], ...data.tipos.map((row) => [row.tipo, row.tipo, row.total])]
        .map(([value, label, n]) => `<button class="chip" type="button" data-tipo="${esc(value)}" aria-pressed="${state.tipo === value}">${esc(label)}<span class="n">${n}</span></button>`).join('');
      root.querySelector('[data-count]').textContent = `${data.productos.length} equipo${data.productos.length === 1 ? '' : 's'}`;
      results.innerHTML = data.productos.length ? `<div class="products">${data.productos.map(productCard).join('')}</div>`
        : `<div class="card">${empty({ iconName: 'search', title: 'Sin coincidencias', text: 'Prueba con otro tipo de equipo o quita algún filtro.',
          action: '<button class="btn btn-secondary" type="button" data-reset>Limpiar filtros</button>' })}</div>`;
    } catch (error) {
      if (error.name !== 'AbortError') results.innerHTML = `<div class="notice error">${icon('alert')}${esc(error.message)}</div>`;
    }
  }
  root.addEventListener('click', (event) => {
    const mod = event.target.closest('[data-modalidad]');
    if (mod) { state.modalidad = mod.dataset.modalidad; root.querySelectorAll('[data-modalidad]').forEach((b) => b.setAttribute('aria-pressed', String(b === mod))); load(); }
    const tipo = event.target.closest('[data-tipo]');
    if (tipo) { state.tipo = tipo.dataset.tipo; load(); }
    if (event.target.closest('[data-clear-q]')) { state.q = ''; if (search) search.value = ''; load(); }
    if (event.target.closest('[data-reset]')) {
      Object.assign(state, { q: '', tipo: '', modalidad: '', orden: '', condicion: '' });
      root.querySelectorAll('select').forEach((select) => { select.value = ''; });
      root.querySelectorAll('[data-modalidad]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modalidad === '')));
      load();
    }
  });
  root.querySelector('[data-orden]').addEventListener('change', (event) => { state.orden = event.target.value; load(); });
  root.querySelector('[data-condicion]').addEventListener('change', (event) => { state.condicion = event.target.value; load(); });
  await load();
  return () => controller?.abort();
}

// ------------------------------------------------------------------ calendario de disponibilidad
function createCalendar(host, { busy, onChange }) {
  const minDay = today();
  const busyDays = new Set();
  for (const range of busy) {
    for (let day = range.fecha_inicio; day <= range.fecha_fin; day = addDays(day, 1)) busyDays.add(day);
  }
  const state = { month: minDay.slice(0, 7), start: null, end: null };
  const crosses = (a, b) => { for (let d = a; d <= b; d = addDays(d, 1)) if (busyDays.has(d)) return true; return false; };
  function render() {
    const [year, month] = state.month.split('-').map(Number);
    const first = new Date(Date.UTC(year, month - 1, 1));
    const offset = (first.getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const raw = new Intl.DateTimeFormat('es-SV', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
    const label = raw.charAt(0).toUpperCase() + raw.slice(1);
    const cells = [];
    for (let i = 0; i < offset; i += 1) cells.push('<span></span>');
    for (let d = 1; d <= daysInMonth; d += 1) {
      const iso = `${state.month}-${String(d).padStart(2, '0')}`;
      const isBusy = busyDays.has(iso);
      const past = iso < minDay;
      const edge = iso === state.start || iso === state.end;
      const inRange = state.start && state.end && iso > state.start && iso < state.end;
      cells.push(`<button type="button" data-day="${iso}" class="${isBusy ? 'busy' : ''} ${edge ? 'edge' : ''} ${inRange ? 'in-range' : ''} ${iso === minDay ? 'today' : ''}"
        ${isBusy || past ? 'disabled' : ''} aria-label="${iso}${isBusy ? ', ocupado' : ''}" aria-pressed="${edge}">${d}</button>`);
    }
    const prevDisabled = state.month <= minDay.slice(0, 7);
    host.innerHTML = `<div class="calendar">
      <div class="calendar-head"><button class="icon-btn" type="button" data-nav="-1" aria-label="Mes anterior" ${prevDisabled ? 'disabled' : ''}>${icon('chevronLeft')}</button>
        <strong>${esc(label)}</strong><button class="icon-btn" type="button" data-nav="1" aria-label="Mes siguiente">${icon('chevronRight')}</button></div>
      <div class="calendar-grid">${['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d) => `<span class="dow">${d}</span>`).join('')}${cells.join('')}</div>
      <div class="legend"><span><i style="background:var(--azul)"></i>Tu selección</span><span><i style="background:var(--danger-bg);border:1px solid #F3C3BE"></i>Ocupado</span><span><i style="box-shadow:inset 0 0 0 1.5px var(--celeste)"></i>Hoy</span></div></div>`;
  }
  host.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      const [y, m] = state.month.split('-').map(Number);
      const next = new Date(Date.UTC(y, m - 1 + Number(nav.dataset.nav), 1));
      state.month = next.toISOString().slice(0, 7);
      render();
      return;
    }
    const day = event.target.closest('[data-day]')?.dataset.day;
    if (!day) return;
    if (!state.start || state.end || day < state.start) { state.start = day; state.end = null; }
    else if (crosses(state.start, day)) { toast('El rango incluye días ocupados. Elige otras fechas.', 'error'); state.start = day; state.end = null; }
    else state.end = day;
    render();
    onChange({ start: state.start, end: state.end || state.start, complete: Boolean(state.end) });
  });
  render();
  return { set(start, end) { state.start = start; state.end = end; state.month = start.slice(0, 7); render(); } };
}

function quoteHtml(quote) {
  const t = quote.totales;
  const line = (label, value, cls = '') => `<div class="line ${cls}"><span>${label}</span><span>${value}</span></div>`;
  return `<div class="quote">
    ${line('Subtotal', money(t.subtotal))}
    ${t.descuento ? line(`Descuento por duración`, `−${money(t.descuento)}`) : ''}
    ${t.operador ? line('Operador certificado', money(t.operador)) : ''}
    ${line('Flete a obra', money(t.flete))}
    ${line(`IVA (${quote.tasas.iva} %)`, money(t.iva))}
    ${t.deposito ? line(`Depósito reembolsable (${quote.tasas.deposito_garantia} %)`, money(t.deposito)) : ''}
    ${line('Total estimado', money(t.total), 'total')}</div>`;
}

// ------------------------------------------------------------------ ficha de producto
export async function productDetail(ctx, [id]) {
  const { producto: p, ocupadas, relacionados } = await api(`/api/portal/catalogo/${id}`);
  const root = ctx.view;
  ctx.setTitle(p.nombre, p.tipo);
  const buyer = ctx.can('pedidos.crear');
  const canRent = p.modalidad !== 'VENTA';
  const canBuy = p.modalidad !== 'RENTA';
  const specs = Object.entries(p.especificaciones || {});
  const facts = [['Marca', p.marca], ['Modelo', p.modelo], ['Año', p.anio], ['Condición', CONDICION[p.condicion]],
    ['Horómetro', p.horometro != null ? `${number(p.horometro)} h` : null], ['Ubicación', p.ubicacion], ['SKU', p.sku], ['Vendido por', p.proveedor]]
    .filter(([, value]) => value != null && value !== '');
  root.innerHTML = `
    <a class="btn btn-ghost btn-sm" href="#/catalogo" style="justify-self:start">${icon('arrowLeft', 'icon icon-sm')}Volver al catálogo</a>
    <div class="pdp">
        <div class="gallery">
          <div class="gallery-main"><img data-main src="${esc(p.imagenes[0] || '')}" alt="${esc(p.nombre)}"></div>
          ${p.imagenes.length > 1 ? `<div class="gallery-thumbs">${p.imagenes.map((src, i) => `<button type="button" data-thumb="${esc(src)}" aria-current="${i === 0}" aria-label="Ver foto ${i + 1}"><img src="${esc(src)}" alt=""></button>`).join('')}</div>` : ''}
        </div>
      <div class="stack pdp-details" style="gap:28px">
        <section class="stack"><h2>Descripción</h2><p style="color:var(--ink-2);line-height:1.7">${esc(p.descripcion)}</p></section>
        ${specs.length ? `<section class="stack"><h2>Ficha técnica</h2><dl class="specs">${specs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section>` : ''}
        <section class="stack"><h2>Datos del equipo</h2><dl class="specs">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section>
      </div>
      <aside class="buybox" data-buybox>
        <div class="stack-sm"><div class="row wrap">${p.destacado ? `<span class="badge featured b-pendiente">${icon('star', 'icon icon-sm')}Destacado</span>` : ''}
          <span class="badge b-${canRent && canBuy ? 'neutral' : canRent ? 'renta' : 'venta'}">${esc(MODALIDAD[p.modalidad])}</span>
          ${p.estado_publicacion !== 'ACTIVO' ? `<span class="badge b-borrador">${esc(p.estado_publicacion)}</span>` : ''}</div>
          <h1 style="font-size:24px">${esc(p.nombre)}</h1>
          <p class="small muted row" style="gap:6px">${icon('mapPin', 'icon icon-sm')}${esc(p.ubicacion || 'El Salvador')} · ${esc(p.proveedor)}</p></div>
        <div class="row wrap" style="gap:18px;align-items:baseline">
          ${canRent ? `<div><span class="price">${money0(p.tarifa_diaria)}</span><span class="muted"> /día</span></div>` : ''}
          ${canBuy ? `<div><span class="${canRent ? 'strong' : 'price'}" style="${canRent ? 'font-size:18px;color:var(--azul)' : ''}">${money0(p.precio_venta)}</span><span class="muted"> compra</span></div>` : ''}
        </div>
        ${buyer ? `
          ${canRent && canBuy ? `<div class="segmented" role="group" aria-label="¿Rentar o comprar?" style="width:100%">
            <button type="button" data-mode="RENTA" aria-pressed="true" style="flex:1">${icon('calendar', 'icon icon-sm')} Rentar</button>
            <button type="button" data-mode="COMPRA" aria-pressed="false" style="flex:1">${icon('tag', 'icon icon-sm')} Comprar</button></div>` : ''}
          <div data-rent ${canRent ? '' : 'hidden'} class="stack">
            <div><p class="label" style="margin-bottom:8px">Elige las fechas de renta</p><div data-calendar></div></div>
            <p class="small strong" data-range style="color:var(--azul)">Selecciona el primer y último día.</p>
            <label class="check"><input type="checkbox" data-operador> Incluir operador certificado <span class="muted small" data-operador-rate></span></label>
          </div>
          <div data-buy ${!canRent ? '' : 'hidden'} class="stack">
            <div class="row-between"><span class="label">Cantidad</span>
              <div class="qty"><button type="button" data-qty="-1" aria-label="Menos">${icon('minus', 'icon icon-sm')}</button><span data-qty-value>1</span><button type="button" data-qty="1" aria-label="Más">${icon('plus', 'icon icon-sm')}</button></div></div>
            <p class="small ${p.stock ? 'muted' : ''}" style="${p.stock ? '' : 'color:var(--danger)'}">${p.stock ? `${p.stock} unidad${p.stock === 1 ? '' : 'es'} disponible${p.stock === 1 ? '' : 's'} para entrega inmediata` : 'Agotado por ahora'}</p>
          </div>
          <div data-quote><p class="small muted">${canRent ? 'Elige fechas para ver la cotización completa.' : ''}</p></div>
          <div class="stack-sm">
            <button class="btn btn-lg btn-block" type="button" data-add disabled>${icon('cart', 'icon icon-sm')}Agregar al carrito</button>
            <button class="btn btn-amarillo btn-block" type="button" data-buy-now disabled>Reservar y pagar ahora</button></div>
          <p class="small muted row" style="gap:8px">${icon('shield', 'icon icon-sm')}Un asesor confirma disponibilidad y entrega antes de cobrar.</p>`
        : `<div class="notice">${icon('info')}<p>Vista de catálogo. Solo las cuentas de cliente pueden rentar o comprar.</p></div>
           ${ctx.can('productos.gestionar') && (ctx.user.rol === 'admin' || p.proveedor_id === ctx.user.id) ? `<a class="btn btn-secondary" href="#/productos/${p.id}">${icon('edit', 'icon icon-sm')}Editar producto</a>` : ''}`}
      </aside>
    </div>
    ${relacionados.length ? `<section class="stack"><div class="section-title"><h2>También te puede servir</h2><a class="btn btn-ghost btn-sm" href="#/catalogo">Ver catálogo</a></div>
      <div class="products">${relacionados.map(productCard).join('')}</div></section>` : ''}`;

  root.querySelectorAll('[data-thumb]').forEach((button) => button.addEventListener('click', () => {
    root.querySelector('[data-main]').src = button.dataset.thumb;
    root.querySelectorAll('[data-thumb]').forEach((b) => b.setAttribute('aria-current', String(b === button)));
  }));
  if (!buyer) return undefined;

  const config = await loadConfig(ctx);
  const rate = config.tasas.find((row) => row.clave === 'tarifa_operador');
  if (rate) root.querySelector('[data-operador-rate]').textContent = `(+${money0(rate.valor)}/día)`;
  const state = { mode: canRent ? 'RENTA' : 'COMPRA', start: null, end: null, complete: false, qty: 1, operador: false, quote: null };
  const quoteBox = root.querySelector('[data-quote]');
  const addButton = root.querySelector('[data-add]');
  const nowButton = root.querySelector('[data-buy-now]');
  const item = () => (state.mode === 'RENTA'
    ? { maquinaria_id: p.id, modalidad: 'RENTA', fecha_inicio: state.start, fecha_fin: state.end, con_operador: state.operador }
    : { maquinaria_id: p.id, modalidad: 'COMPRA', cantidad: state.qty });
  const ready = () => (state.mode === 'RENTA' ? Boolean(state.start) : p.stock >= state.qty && p.stock > 0);
  let quoteController;
  const requote = debounce(async () => {
    addButton.disabled = true; nowButton.disabled = true;
    if (!ready()) { quoteBox.innerHTML = `<p class="small muted">${state.mode === 'RENTA' ? 'Elige fechas para ver la cotización completa.' : 'Sin existencias.'}</p>`; return; }
    quoteController?.abort();
    quoteController = new AbortController();
    quoteBox.innerHTML = '<div class="skeleton" style="height:150px"></div>';
    try {
      state.quote = await api('/api/portal/cotizar', { method: 'POST', body: { items: [item()] }, signal: quoteController.signal });
      quoteBox.innerHTML = quoteHtml(state.quote);
      addButton.disabled = false; nowButton.disabled = false;
    } catch (error) {
      if (error.name === 'AbortError') return;
      const detail = Object.values(error.fields || {})[0];
      quoteBox.innerHTML = `<div class="notice error">${icon('alert')}<p>${esc(detail || error.message)}</p></div>`;
    }
  }, 220);

  if (canRent) {
    createCalendar(root.querySelector('[data-calendar]'), { busy: ocupadas, onChange: ({ start, end, complete }) => {
      Object.assign(state, { start, end, complete });
      const days = daysBetween(start, end);
      root.querySelector('[data-range]').textContent = complete
        ? `${date(start)} → ${date(end)} · ${days} día${days === 1 ? '' : 's'}`
        : `Inicio ${date(start)} · elige el último día (o deja 1 día)`;
      requote();
    } });
  }
  root.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => {
    state.mode = button.dataset.mode;
    root.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    root.querySelector('[data-rent]').hidden = state.mode !== 'RENTA';
    root.querySelector('[data-buy]').hidden = state.mode !== 'COMPRA';
    nowButton.textContent = state.mode === 'RENTA' ? 'Reservar y pagar ahora' : 'Comprar ahora';
    requote();
  }));
  root.querySelector('[data-operador]').addEventListener('change', (event) => { state.operador = event.target.checked; requote(); });
  root.querySelectorAll('[data-qty]').forEach((button) => button.addEventListener('click', () => {
    state.qty = Math.min(Math.max(1, state.qty + Number(button.dataset.qty)), Math.max(1, p.stock));
    root.querySelector('[data-qty-value]').textContent = state.qty;
    requote();
  }));
  const add = (goToCart) => {
    ctx.cart.add({ ...item(), nombre: p.nombre, imagen: p.imagenes[0] || null, tipo: p.tipo, stock: p.stock,
      tarifa_diaria: p.tarifa_diaria, precio_venta: p.precio_venta });
    if (goToCart) ctx.go('carrito');
    else toast(`${p.nombre} se agregó al carrito.`, 'ok');
  };
  addButton.addEventListener('click', () => add(false));
  nowButton.addEventListener('click', () => add(true));
  if (!canRent) requote();
  return () => quoteController?.abort();
}

// ------------------------------------------------------------------ carrito y pago
export async function cartView(ctx) {
  const root = ctx.view;
  const config = await loadConfig(ctx);
  ctx.setTitle('Carrito', 'Tu pedido');
  let quoteController;
  const draft = {};
  try { Object.assign(draft, JSON.parse(sessionStorage.getItem('ces.checkout') || '{}')); } catch { /* sin borrador */ }

  function render() {
    const items = ctx.cart.items();
    if (!items.length) {
      root.innerHTML = `<div class="card">${empty({ iconName: 'cart', title: 'Tu carrito está vacío',
        text: 'Agrega equipos desde el catálogo para rentar o comprar.', action: '<a class="btn" href="#/catalogo">Explorar catálogo</a>' })}</div>`;
      return;
    }
    root.innerHTML = `
      <div class="page-head"><div><span class="eyebrow">Paso 1 de 2</span><h1 style="margin-top:6px">Revisa tu pedido</h1>
        <p>Los precios se confirman con las tasas vigentes. Puedes ajustar fechas o cantidades aquí mismo.</p></div>
        <button class="btn btn-ghost" type="button" data-clear>${icon('trash', 'icon icon-sm')}Vaciar carrito</button></div>
      <div class="split">
        <section class="card"><div class="card-head"><h3>${items.length} equipo${items.length === 1 ? '' : 's'}</h3></div>
          ${items.map((item) => `<div class="cart-line" data-key="${item.key}">
            ${item.imagen ? `<img src="${esc(item.imagen)}" alt="">` : '<div class="thumb"></div>'}
            <div class="stack-sm" style="min-width:0">
              <div class="row wrap" style="gap:8px"><strong>${esc(item.nombre)}</strong><span class="badge b-${item.modalidad === 'RENTA' ? 'renta' : 'venta'}">${esc(MODALIDAD[item.modalidad])}</span></div>
              ${item.modalidad === 'RENTA' ? `<div class="row wrap">
                  <input class="input" type="date" data-start value="${esc(item.fecha_inicio)}" min="${today()}" aria-label="Inicio" style="width:auto;min-height:38px">
                  <span class="muted">→</span>
                  <input class="input" type="date" data-end value="${esc(item.fecha_fin)}" min="${esc(item.fecha_inicio)}" aria-label="Fin" style="width:auto;min-height:38px">
                  <span class="small muted">${daysBetween(item.fecha_inicio, item.fecha_fin)} día${daysBetween(item.fecha_inicio, item.fecha_fin) === 1 ? '' : 's'}</span></div>
                <label class="check small"><input type="checkbox" data-operador ${item.con_operador ? 'checked' : ''}> Con operador certificado</label>`
              : `<div class="row"><div class="qty"><button type="button" data-qty="-1" aria-label="Menos">${icon('minus', 'icon icon-sm')}</button><span>${item.cantidad}</span>
                <button type="button" data-qty="1" aria-label="Más">${icon('plus', 'icon icon-sm')}</button></div><span class="small muted">${money0(item.precio_venta)} c/u</span></div>`}
              <p class="small" data-line-error style="color:var(--danger)" hidden></p>
            </div>
            <button class="icon-btn" type="button" data-remove aria-label="Quitar ${esc(item.nombre)}">${icon('trash')}</button>
          </div>`).join('')}
        </section>
        <aside class="stack">
          <form class="card card-pad stack" data-checkout novalidate>
            <div><span class="eyebrow">Paso 2 de 2</span><h3 style="margin-top:4px">Entrega y pago</h3></div>
            ${field({ name: 'ciudad', label: 'Ciudad de la obra', value: draft.ciudad || '', required: true, attrs: 'maxlength="100" autocomplete="address-level2" placeholder="Ej. San Salvador"' })}
            ${field({ name: 'direccion', label: 'Dirección de entrega', value: draft.direccion || '', required: true, attrs: 'maxlength="240" placeholder="Colonia, calle, referencia de acceso"' })}
            ${field({ name: 'metodo_pago', label: 'Forma de pago', value: draft.metodo_pago || 'TRANSFERENCIA', required: true,
              options: Object.entries(config.formas_pago) })}
            ${field({ name: 'notas', label: 'Notas para el equipo de entrega', type: 'textarea', value: draft.notas || '', attrs: 'maxlength="1000" rows="3" placeholder="Horario de acceso, contacto en obra, requisitos de seguridad"' })}
            <div data-quote><div class="skeleton" style="height:180px"></div></div>
            <p class="notice error" data-error hidden></p>
            <button class="btn btn-lg btn-block" type="submit" data-submit disabled>${icon('checkCircle', 'icon icon-sm')}Confirmar pedido</button>
            <p class="small muted" style="text-align:center">No se realiza ningún cobro hasta confirmar disponibilidad.</p>
          </form>
        </aside>
      </div>`;
    requote();
  }

  async function requote() {
    const items = ctx.cart.items();
    const box = root.querySelector('[data-quote]');
    const submit = root.querySelector('[data-submit]');
    if (!box) return;
    quoteController?.abort();
    quoteController = new AbortController();
    submit.disabled = true;
    root.querySelectorAll('[data-line-error]').forEach((node) => { node.hidden = true; });
    try {
      const quote = await api('/api/portal/cotizar', { method: 'POST', signal: quoteController.signal,
        body: { items: items.map(({ maquinaria_id, modalidad, cantidad, fecha_inicio, fecha_fin, con_operador }) =>
          ({ maquinaria_id, modalidad, cantidad, fecha_inicio, fecha_fin, con_operador })) } });
      box.innerHTML = quoteHtml(quote);
      submit.disabled = false;
    } catch (error) {
      if (error.name === 'AbortError') return;
      const index = Number(Object.keys(error.fields || {})[0]?.split('.')[1]);
      const detail = Object.values(error.fields || {})[0] || error.message;
      const line = Number.isInteger(index) ? root.querySelectorAll('.cart-line')[index]?.querySelector('[data-line-error]') : null;
      if (line) { line.hidden = false; line.textContent = detail; }
      box.innerHTML = `<div class="notice error">${icon('alert')}<p>${esc(detail)}</p></div>`;
    }
  }

  root.addEventListener('click', async (event) => {
    const key = event.target.closest('[data-key]')?.dataset.key;
    if (event.target.closest('[data-remove]')) { ctx.cart.remove(key); render(); }
    const qty = event.target.closest('[data-qty]');
    if (qty) {
      const item = ctx.cart.items().find((row) => row.key === key);
      ctx.cart.update(key, { cantidad: Math.max(1, item.cantidad + Number(qty.dataset.qty)) });
      render();
    }
    if (event.target.closest('[data-clear]')) { ctx.cart.clear(); render(); }
  });
  root.addEventListener('change', (event) => {
    const key = event.target.closest('[data-key]')?.dataset.key;
    if (!key) {
      const form = event.target.closest('[data-checkout]');
      if (form) sessionStorage.setItem('ces.checkout', JSON.stringify(Object.fromEntries(new FormData(form))));
      return;
    }
    const item = ctx.cart.items().find((row) => row.key === key);
    if (event.target.matches('[data-operador]')) ctx.cart.update(key, { con_operador: event.target.checked });
    if (event.target.matches('[data-start]')) {
      const start = event.target.value;
      ctx.cart.update(key, { fecha_inicio: start, fecha_fin: item.fecha_fin < start ? start : item.fecha_fin });
    }
    if (event.target.matches('[data-end]')) ctx.cart.update(key, { fecha_fin: event.target.value });
    render();
  });
  root.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-checkout]');
    if (!form) return;
    event.preventDefault();
    const submit = form.querySelector('[data-submit]');
    const errorBox = form.querySelector('[data-error]');
    errorBox.hidden = true;
    submit.disabled = true;
    submit.innerHTML = '<span class="spinner"></span> Enviando pedido…';
    const data = Object.fromEntries(new FormData(form));
    try {
      const order = await api('/api/portal/pedidos/nuevo', { method: 'POST', body: { ...data,
        items: ctx.cart.items().map(({ maquinaria_id, modalidad, cantidad, fecha_inicio, fecha_fin, con_operador }) =>
          ({ maquinaria_id, modalidad, cantidad, fecha_inicio, fecha_fin, con_operador })) } });
      ctx.cart.clear();
      sessionStorage.removeItem('ces.checkout');
      toast(`Pedido ${order.numero_visible} recibido. Te avisaremos cuando se apruebe.`, 'ok');
      ctx.go(`pedido/${order.id}`);
    } catch (error) {
      showFieldErrors(form, error.fields);
      errorBox.hidden = false;
      errorBox.textContent = Object.values(error.fields || {})[0] || error.message;
      submit.disabled = false;
      submit.innerHTML = `${icon('checkCircle', 'icon icon-sm')}Confirmar pedido`;
    }
  });
  render();
  return () => quoteController?.abort();
}
