import { icon } from '../icons.js';
import { api, esc, money, money0, number, badge, date, relative, toast, ROLES, empty, MODALIDAD } from '../ui.js';

const kpi = ({ label, value, foot = '', ico, feature = false }) => `<div class="kpi ${feature ? 'feature' : ''}">
  <div class="kpi-top"><span>${esc(label)}</span><span class="kpi-icon">${icon(ico)}</span></div>
  <div class="kpi-value">${value}</div>${foot ? `<div class="kpi-foot">${foot}</div>` : ''}</div>`;

const ORDER_STEPS = ['PENDIENTE', 'APROBADO', 'EN_ENTREGA', 'COMPLETADO'];
export function steps(estado) {
  const index = ORDER_STEPS.indexOf(estado);
  const labels = ['Recibido', 'Aprobado', 'En camino', 'Entregado'];
  return `<div class="steps" aria-label="Progreso del pedido">${labels.map((label, i) =>
    `<div class="${index >= 0 && i < index ? 'done' : i === index ? (estado === 'COMPLETADO' ? 'done' : 'current') : ''}">${label}</div>`).join('')}</div>`;
}

export function orderRow(order, { showClient = false } = {}) {
  return `<a class="list-item" href="#/pedido/${order.id}">
    <span class="kpi-icon" style="width:42px;height:42px;border-radius:14px;display:grid;place-items:center;background:var(--azul-050);color:var(--azul)">${icon(order.tipo === 'COMPRA' ? 'package' : order.tipo === 'MIXTO' ? 'layers' : 'calendar')}</span>
    <div class="grow"><div class="title">${esc(order.numero_visible)} · ${esc(order.resumen || 'Pedido')}</div>
      <div class="small muted">${showClient ? `${esc(order.cliente_empresa || order.cliente)} · ` : ''}${esc(date(order.creado_en))} · ${esc(order.ciudad)}</div></div>
    <div style="text-align:right;display:grid;gap:6px;justify-items:end">${badge(order.estado)}<span class="strong mono small">${money(order.total ?? order.subtotal_items)}</span></div></a>`;
}

function productMini(product) {
  return `<a class="list-item" href="#/producto/${product.id}">
    <img class="thumb" src="${esc(product.imagenes[0] || '')}" alt="" loading="lazy">
    <div class="grow"><div class="title">${esc(product.nombre)}</div><div class="small muted">${esc(product.tipo)} · ${esc(product.ubicacion || 'El Salvador')}</div></div>
    <span class="strong mono small" style="color:var(--azul)">${product.tarifa_diaria ? `${money0(product.tarifa_diaria)}/día` : money0(product.precio_venta)}</span></a>`;
}

const firstName = (name) => String(name || '').split(' ')[0];

// Una sola serie: barras azules, extremo redondeado anclado a la base, sin leyenda.
function revenueChart(series) {
  const width = 640; const height = 240; const pad = { top: 16, right: 8, bottom: 28, left: 56 };
  const max = Math.max(...series.map((point) => point.ingresos), 1);
  const nice = 10 ** Math.floor(Math.log10(max));
  const top = Math.ceil(max / nice) * nice;
  const innerW = width - pad.left - pad.right; const innerH = height - pad.top - pad.bottom;
  const band = innerW / series.length; const barW = Math.min(44, band * 0.5);
  const y = (value) => pad.top + innerH - (value / top) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const month = (mes) => new Intl.DateTimeFormat('es-SV', { month: 'short' }).format(new Date(`${mes}-15T12:00:00`));
  const bars = series.map((point, i) => {
    const x = pad.left + band * i + (band - barW) / 2;
    const h = Math.max(0, pad.top + innerH - y(point.ingresos));
    const r = Math.min(4, h);
    const path = h ? `M${x},${pad.top + innerH} V${y(point.ingresos) + r} Q${x},${y(point.ingresos)} ${x + r},${y(point.ingresos)} H${x + barW - r} Q${x + barW},${y(point.ingresos)} ${x + barW},${y(point.ingresos) + r} V${pad.top + innerH} Z` : '';
    return `<g data-i="${i}"><rect class="hit" x="${pad.left + band * i}" y="${pad.top}" width="${band}" height="${innerH}" fill="transparent"/>
      <path class="bar" d="${path}"/><text x="${x + barW / 2}" y="${height - 8}" text-anchor="middle" class="axis-label">${esc(month(point.mes))}</text></g>`;
  }).join('');
  const table = `<table class="sr-only"><caption>Ingresos por mes</caption><tr><th>Mes</th><th>Ingresos</th><th>Pedidos</th></tr>${series.map((p) =>
    `<tr><td>${esc(p.mes)}</td><td>${money(p.ingresos)}</td><td>${p.pedidos}</td></tr>`).join('')}</table>`;
  return `<div class="chart" data-chart><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Ingresos de los últimos seis meses">
    <g class="grid">${ticks.map((t) => `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(t)}" y2="${y(t)}"/>`).join('')}</g>
    <g class="axis">${ticks.map((t) => `<text x="${pad.left - 10}" y="${y(t) + 4}" text-anchor="end">${esc(money0(t).replace('US', ''))}</text>`).join('')}
    ${bars}</g></svg><div class="tip" hidden></div>${table}</div>`;
}

function bindChart(root, series) {
  const chart = root.querySelector('[data-chart]');
  if (!chart) return;
  const tip = chart.querySelector('.tip');
  const svg = chart.querySelector('svg');
  chart.querySelectorAll('g[data-i]').forEach((group) => {
    const point = series[Number(group.dataset.i)];
    const show = () => {
      chart.querySelectorAll('.bar').forEach((bar) => bar.classList.remove('is-active'));
      group.querySelector('.bar').classList.add('is-active');
      const box = group.querySelector('.hit').getBoundingClientRect();
      const host = chart.getBoundingClientRect();
      const barTop = group.querySelector('.bar').getBoundingClientRect().top;
      tip.innerHTML = `<strong>${money(point.ingresos)}</strong>${point.pedidos} pedido${point.pedidos === 1 ? '' : 's'} · ${esc(new Intl.DateTimeFormat('es-SV', { month: 'long', year: 'numeric' }).format(new Date(`${point.mes}-15T12:00:00`)))}`;
      tip.style.left = `${box.left - host.left + box.width / 2}px`;
      tip.style.top = `${Math.min(barTop, box.bottom - 30) - host.top}px`;
      tip.hidden = false;
    };
    group.addEventListener('mouseenter', show);
    group.addEventListener('click', show);
  });
  svg.addEventListener('mouseleave', () => { tip.hidden = true; chart.querySelectorAll('.bar').forEach((bar) => bar.classList.remove('is-active')); });
  chart.querySelectorAll('.axis-label').forEach((label) => { label.setAttribute('fill', 'var(--muted)'); label.setAttribute('font-size', '11'); });
}

function quickApprove(root, ctx) {
  root.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-approve]');
    if (!button) return;
    event.preventDefault();
    button.disabled = true;
    try {
      await api(`/api/portal/pedidos/${button.dataset.approve}/estado`, { method: 'POST', body: { estado: 'APROBADO' } });
      toast('Pedido aprobado. El cliente ya puede ver el avance.', 'ok');
      ctx.refreshCounters();
      button.closest('.list-item').remove();
    } catch (error) { toast(error.message, 'error'); button.disabled = false; }
  });
}

function staffQueue(data) {
  return `<div class="split">
    <section class="card"><div class="card-head"><div><h3>Cola de aprobación</h3><p class="small muted">Pedidos recibidos que esperan confirmación de disponibilidad.</p></div>
      <a class="btn btn-ghost btn-sm" href="#/pedidos?estado=PENDIENTE">Ver todos</a></div>
      <div class="list">${data.cola.length ? data.cola.map((order) => `<div class="list-item">
        <a class="grow" href="#/pedido/${order.id}" style="text-decoration:none;color:inherit"><div class="title">${esc(order.numero_visible)} · ${esc(order.resumen)}</div>
          <div class="small muted">${esc(order.cliente_empresa || order.cliente)} · ${esc(relative(order.creado_en))} · ${money(order.total)}</div></a>
        <button class="btn btn-sm" type="button" data-approve="${order.id}">${icon('check', 'icon icon-sm')}Aprobar</button></div>`).join('')
        : empty({ iconName: 'checkCircle', title: 'Todo al día', text: 'No hay pedidos esperando aprobación.' })}</div></section>
    <section class="card"><div class="card-head"><div><h3>Moderación de catálogo</h3><p class="small muted">Productos de proveedores por revisar.</p></div>
      <a class="btn btn-ghost btn-sm" href="#/moderacion">Revisar</a></div>
      <div class="list">${data.moderacion.length ? data.moderacion.map((product) => `<a class="list-item" href="#/moderacion">
        <img class="thumb" src="${esc(product.imagenes[0] || '')}" alt=""><div class="grow"><div class="title">${esc(product.nombre)}</div>
        <div class="small muted">${esc(product.proveedor)} · ${esc(MODALIDAD[product.modalidad])}</div></div>${badge('PENDIENTE', 'En revisión')}</a>`).join('')
        : empty({ iconName: 'shield', title: 'Sin pendientes', text: 'Todos los productos están revisados.' })}</div></section>
  </div>`;
}

export async function dashboard(ctx) {
  const data = await api('/api/portal/resumen');
  const { user } = ctx;
  const root = ctx.view;
  if (user.rol === 'cliente') {
    const k = data.kpis;
    ctx.setTitle('Inicio', `Hola, ${user.nombre}`);
    root.innerHTML = `
      <section class="hero">
        <div class="hero-copy"><span class="eyebrow on-dark">${esc(data.perfil.empresa || 'Tu cuenta ICI')}</span>
          <h1>tu obra,<b>sin pausas</b></h1>
          <p>Renta por día, semana o mes con fechas garantizadas, o compra equipo con entrega directa en tu proyecto.</p>
          <div class="row wrap" style="margin-top:6px"><a class="btn btn-amarillo" href="#/catalogo">${icon('store', 'icon icon-sm')}Explorar catálogo</a>
          <a class="btn btn-secondary" href="#/pedidos" style="background:transparent;color:var(--blanco);border-color:rgba(255,255,255,.4)">Ver mis pedidos</a></div></div>
        <div class="hero-media"><img src="/assets/img/maquinaria/excavadora-cat-336.jpg" alt="Excavadora trabajando en obra"></div>
      </section>
      <div class="kpis">
        ${kpi({ label: 'Pedidos activos', value: number(k.activos), foot: 'Pendientes, aprobados o en camino', ico: 'clipboard', feature: true })}
        ${kpi({ label: 'Equipos en tu obra hoy', value: number(k.rentas_en_curso), foot: 'Rentas vigentes', ico: 'excavator' })}
        ${kpi({ label: 'Inversión acumulada', value: money0(k.invertido), foot: 'Pedidos no cancelados', ico: 'dollar' })}
        ${kpi({ label: 'Pedidos entregados', value: number(k.completados), foot: 'Historial completo', ico: 'checkCircle' })}
      </div>
      <div class="split">
        <section class="card"><div class="card-head"><h3>Pedidos recientes</h3><a class="btn btn-ghost btn-sm" href="#/pedidos">Ver todos</a></div>
          <div class="list">${data.pedidos.length ? data.pedidos.map((order) => `<div>${orderRow(order)}<div style="padding:0 24px 16px">${steps(order.estado)}</div></div>`).join('')
            : empty({ iconName: 'clipboard', title: 'Aún no tienes pedidos', text: 'Explora el catálogo y cotiza en segundos.', action: '<a class="btn" href="#/catalogo">Ir al catálogo</a>' })}</div></section>
        <section class="card"><div class="card-head"><h3>Destacados para ti</h3><a class="btn btn-ghost btn-sm" href="#/catalogo">Catálogo</a></div>
          <div class="list">${data.destacados.map(productMini).join('')}</div></section>
      </div>`;
    return undefined;
  }
  if (user.rol === 'proveedor') {
    const k = data.kpis;
    ctx.setTitle('Resumen de tu tienda', data.perfil.empresa || 'Proveedor');
    const estados = [['ACTIVO', 'Publicados', 'checkCircle'], ['PENDIENTE', 'En revisión', 'clock'], ['BORRADOR', 'Borradores', 'file'], ['RECHAZADO', 'Por corregir', 'alert']];
    const maxTop = Math.max(...data.top.map((row) => row.monto), 1);
    root.innerHTML = `
      <div class="page-head"><div><span class="eyebrow">Panel de proveedor</span><h1 style="margin-top:6px">${esc(user.nombre)}</h1>
        <p>Publica tu maquinaria, controla tu inventario y sigue cada venta o renta con su liquidación neta.</p></div>
        <a class="btn btn-lg" href="#/productos/nuevo">${icon('plus', 'icon icon-sm')}Agregar producto</a></div>
      <div class="kpis">
        ${kpi({ label: 'Ventas y rentas brutas', value: money0(k.ventas_brutas), foot: 'Pedidos aprobados o entregados', ico: 'trend', feature: true })}
        ${kpi({ label: 'Tu ingreso neto', value: money0(k.neto), foot: `Después de la comisión de ${number(k.comision_pct)} %`, ico: 'dollar' })}
        ${kpi({ label: 'Productos publicados', value: number(k.productos.ACTIVO), foot: `${number(k.productos.PENDIENTE)} en revisión`, ico: 'package' })}
        ${kpi({ label: 'Pedidos por atender', value: number(k.pedidos_pendientes), foot: 'Esperando aprobación de ICI', ico: 'clipboard' })}
      </div>
      <div class="pipeline">${estados.map(([estado, label, ico]) => `<a href="#/productos?estado=${estado}">
        <span class="row" style="gap:8px">${icon(ico, 'icon icon-sm')}${esc(label)}</span><strong>${number(k.productos[estado])}</strong></a>`).join('')}</div>
      <div class="split">
        <section class="card"><div class="card-head"><h3>Pedidos con tus equipos</h3><a class="btn btn-ghost btn-sm" href="#/pedidos">Ver todos</a></div>
          <div class="list">${data.pedidos.length ? data.pedidos.map((order) => orderRow({ ...order, total: order.subtotal_items }, { showClient: true })).join('')
            : empty({ iconName: 'clipboard', title: 'Sin pedidos todavía', text: 'Cuando un cliente rente o compre tu equipo aparecerá aquí.' })}</div></section>
        <section class="card card-pad"><h3 style="margin-bottom:18px">Tus equipos más solicitados</h3>
          <div class="bar-list">${data.top.map((row) => `<div class="bar-row"><div class="row-between small"><span class="strong">${esc(row.nombre)}</span>
            <span class="mono muted">${money0(row.monto)}</span></div><div class="track"><div class="fill" style="width:${Math.max(2, (row.monto / maxTop) * 100)}%"></div></div></div>`).join('')
            || '<p class="muted">Publica tu primer producto para ver estadísticas.</p>'}</div></section>
      </div>`;
    return undefined;
  }
  // Empleado y administración
  const k = data.kpis;
  ctx.counters.pending = k.pedidos.PENDIENTE;
  ctx.counters.moderation = k.por_moderar;
  const pipeline = `<div class="pipeline">${[['PENDIENTE', 'Por aprobar'], ['APROBADO', 'Aprobados'], ['EN_ENTREGA', 'En entrega'], ['COMPLETADO', 'Completados']]
    .map(([estado, label]) => `<a href="#/pedidos?estado=${estado}"><span>${esc(label)}</span><strong>${number(k.pedidos[estado])}</strong></a>`).join('')}</div>`;
  if (user.rol === 'admin') {
    const r = data.reportes;
    ctx.setTitle('Panel ejecutivo', 'Administración');
    const maxCat = Math.max(...r.categorias.map((row) => row.monto), 1);
    const totalUsers = r.roles.reduce((sum, row) => sum + row.total, 0);
    root.innerHTML = `
      <div class="page-head"><div><span class="eyebrow">Administración</span><h1 style="margin-top:6px">Así va el negocio</h1>
        <p>Ingresos, operación y gobierno de la plataforma en una sola vista.</p></div>
        <div class="row wrap"><a class="btn btn-secondary" href="#/tasas">${icon('percent', 'icon icon-sm')}Ajustar tasas</a><a class="btn" href="#/usuarios">${icon('users', 'icon icon-sm')}Usuarios</a></div></div>
      <div class="kpis">
        ${kpi({ label: 'Ingresos confirmados', value: money0(k.ingresos), foot: 'Sin depósitos reembolsables', ico: 'trend', feature: true })}
        ${kpi({ label: 'Comisiones de proveedores', value: money0(r.comisiones), foot: 'Generadas por ventas de terceros', ico: 'percent' })}
        ${kpi({ label: 'Pedidos activos', value: number(k.pedidos.PENDIENTE + k.pedidos.APROBADO + k.pedidos.EN_ENTREGA), foot: `${number(k.entregas_hoy)} entregas programadas hoy`, ico: 'truck' })}
        ${kpi({ label: 'Catálogo publicado', value: number(k.catalogo), foot: `${number(k.por_moderar)} productos por revisar`, ico: 'package' })}
      </div>
      <div class="split">
        <section class="card card-pad"><div class="row-between" style="margin-bottom:12px"><div><h3>Ingresos por mes</h3><p class="small muted">Pedidos aprobados, en entrega o completados · últimos 6 meses</p></div></div>
          ${revenueChart(r.series)}</section>
        <section class="card card-pad stack"><div><h3>Ventas por categoría</h3><p class="small muted">Monto de equipos en pedidos confirmados</p></div>
          <div class="bar-list">${r.categorias.map((row) => `<div class="bar-row"><div class="row-between small"><span class="strong">${esc(row.tipo)}</span>
            <span class="mono muted">${money0(row.monto)}</span></div><div class="track"><div class="fill" style="width:${Math.max(2, (row.monto / maxCat) * 100)}%"></div></div></div>`).join('') || '<p class="muted">Sin ventas confirmadas aún.</p>'}</div>
          <hr class="divider"><div><h3>Usuarios por rol</h3><p class="small muted">${number(totalUsers)} cuentas registradas</p></div>
          <div class="row wrap">${r.roles.map((row) => `<span class="badge b-neutral">${esc(ROLES[row.rol] || row.rol)} · ${row.total}</span>`).join('')}</div></section>
      </div>
      ${pipeline}
      ${staffQueue(data)}`;
    bindChart(root, r.series);
  } else {
    ctx.setTitle('Panel de operación', 'Empleado');
    root.innerHTML = `
      <div class="page-head"><div><span class="eyebrow">Operación diaria</span><h1 style="margin-top:6px">Buen día, ${esc(user.nombre)}</h1>
        <p>Aprueba pedidos, coordina entregas, revisa publicaciones y da de alta a clientes y proveedores.</p></div>
        <div class="row wrap"><a class="btn btn-secondary" href="/">${icon('hardhat', 'icon icon-sm')}Contratos de obra</a><a class="btn" href="#/usuarios">${icon('plus', 'icon icon-sm')}Nuevo cliente o proveedor</a></div></div>
      <div class="kpis">
        ${kpi({ label: 'Pedidos por aprobar', value: number(k.pedidos.PENDIENTE), foot: 'Responde en menos de 2 horas', ico: 'clipboard', feature: true })}
        ${kpi({ label: 'Entregas hoy', value: number(k.entregas_hoy), foot: 'Rentas que inician hoy', ico: 'truck' })}
        ${kpi({ label: 'Productos por moderar', value: number(k.por_moderar), foot: 'Publicaciones de proveedores', ico: 'shield' })}
        ${kpi({ label: 'Clientes activos', value: number(k.clientes), foot: `${number(k.proveedores)} proveedores activos`, ico: 'users' })}
      </div>
      ${pipeline}
      ${staffQueue(data)}`;
  }
  quickApprove(root, ctx);
  return undefined;
}
