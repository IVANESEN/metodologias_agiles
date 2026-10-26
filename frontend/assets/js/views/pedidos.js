import { icon } from '../icons.js';
import { api, esc, money, badge, date, dateTime, relative, toast, empty, modal, confirmDialog, ESTADOS, MODALIDAD } from '../ui.js';
import { steps } from './inicio.js';

const FILTERS = [['', 'Todos'], ['PENDIENTE', 'Pendientes'], ['APROBADO', 'Aprobados'], ['EN_ENTREGA', 'En entrega'],
  ['COMPLETADO', 'Completados'], ['CANCELADO', 'Cancelados'], ['RECHAZADO', 'Rechazados']];
const TIPO = { COMPRA: ['package', 'Compra'], RENTA: ['calendar', 'Renta'], MIXTO: ['layers', 'Renta y compra'] };

export async function ordersList(ctx) {
  const root = ctx.view;
  const rol = ctx.user.rol;
  const staff = ctx.can('pedidos.gestionar');
  const title = rol === 'cliente' ? 'Mis pedidos' : rol === 'proveedor' ? 'Pedidos con tus equipos' : 'Pedidos';
  ctx.setTitle(title);
  const state = { estado: ctx.query.get('estado') || '', q: '' };
  root.innerHTML = `
    <div class="page-head"><div><span class="eyebrow">${staff ? 'Operación' : 'Seguimiento'}</span><h1 style="margin-top:6px">${esc(title)}</h1>
      <p>${rol === 'cliente' ? 'Sigue cada renta y compra desde la solicitud hasta la entrega en tu obra.'
        : rol === 'proveedor' ? 'Montos de tus equipos antes de la comisión de la plataforma. Abre un pedido para ver tu liquidación.'
          : 'Aprueba, despacha y cierra pedidos. Cada cambio queda registrado y el cliente lo ve al instante.'}</p></div>
      ${rol === 'cliente' ? `<a class="btn" href="#/catalogo">${icon('plus', 'icon icon-sm')}Nuevo pedido</a>` : ''}</div>
    <div class="row-between wrap">
      <div class="chips" role="group" aria-label="Filtrar por estado">${FILTERS.map(([value, label]) =>
        `<button class="chip" type="button" data-estado="${value}" aria-pressed="${state.estado === value}">${esc(label)}</button>`).join('')}</div>
      <div class="input-group" style="width:min(320px,100%)">${icon('search')}<input class="input" type="search" data-q placeholder="${rol === 'cliente' ? 'Buscar por número o equipo' : 'Buscar por número, cliente o equipo'}" aria-label="Buscar pedidos" style="min-height:40px;border-radius:999px"></div>
    </div>
    <section class="card" data-results><div class="card-body"><div class="skeleton" style="height:220px"></div></div></section>`;
  const results = root.querySelector('[data-results]');
  let orders = [];
  function paint() {
    const q = state.q.toLowerCase();
    const rows = orders.filter((order) => !q || [order.numero_visible, order.cliente, order.cliente_empresa, order.resumen]
      .some((value) => String(value || '').toLowerCase().includes(q)));
    if (!rows.length) {
      results.innerHTML = empty({ iconName: 'clipboard', title: 'No hay pedidos aquí', text: state.estado ? 'Prueba con otro estado.' : 'Cuando haya pedidos aparecerán en esta lista.' });
      return;
    }
    results.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr>
      <th>Pedido</th>${rol !== 'cliente' ? '<th>Cliente</th>' : ''}<th class="hide-sm">Fecha</th><th class="hide-sm">Tipo</th><th>Estado</th><th class="num">${rol === 'proveedor' ? 'Tus equipos' : 'Total'}</th></tr></thead>
      <tbody>${rows.map((order) => `<tr class="clickable" data-href="#/pedido/${order.id}" tabindex="0">
        <td><div class="strong" style="color:var(--azul)">${esc(order.numero_visible)}</div><div class="small muted" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(order.resumen || '')}</div></td>
        ${rol !== 'cliente' ? `<td><div class="strong">${esc(order.cliente_empresa || order.cliente)}</div><div class="small muted">${esc(order.ciudad)}</div></td>` : ''}
        <td class="hide-sm"><div>${esc(date(order.creado_en))}</div><div class="small muted">${esc(relative(order.creado_en))}</div></td>
        <td class="hide-sm"><span class="row small" style="gap:6px">${icon(TIPO[order.tipo][0], 'icon icon-sm')}${esc(TIPO[order.tipo][1])}</span></td>
        <td>${badge(order.estado)}</td>
        <td class="num strong">${money(rol === 'proveedor' ? order.subtotal_items : order.total)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  async function load() {
    results.innerHTML = '<div class="card-body"><div class="skeleton" style="height:220px"></div></div>';
    orders = await api(`/api/portal/pedidos${state.estado ? `?estado=${state.estado}` : ''}`);
    if (ctx.isCurrent()) paint();
  }
  root.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-estado]');
    if (chip) {
      state.estado = chip.dataset.estado;
      root.querySelectorAll('[data-estado]').forEach((b) => b.setAttribute('aria-pressed', String(b === chip)));
      history.replaceState(null, '', `#/pedidos${state.estado ? `?estado=${state.estado}` : ''}`);
      load().catch((error) => toast(error.message, 'error'));
    }
    const row = event.target.closest('[data-href]');
    if (row) location.hash = row.dataset.href;
  });
  root.addEventListener('keydown', (event) => {
    const row = event.target.closest('[data-href]');
    if (row && event.key === 'Enter') location.hash = row.dataset.href;
  });
  root.querySelector('[data-q]').addEventListener('input', (event) => { state.q = event.target.value; paint(); });
  await load();
  return undefined;
}

const ACTIONS = {
  APROBADO: { label: 'Aprobar pedido', ico: 'check', className: '' },
  EN_ENTREGA: { label: 'Marcar en entrega', ico: 'truck', className: 'btn-celeste' },
  COMPLETADO: { label: 'Confirmar entrega', ico: 'checkCircle', className: '' },
  RECHAZADO: { label: 'Rechazar', ico: 'xCircle', className: 'btn-danger', note: true },
  CANCELADO: { label: 'Cancelar', ico: 'x', className: 'btn-danger', note: true },
};

function eventIcon(estado) {
  return { PENDIENTE: 'clipboard', APROBADO: 'check', EN_ENTREGA: 'truck', COMPLETADO: 'checkCircle', CANCELADO: 'x', RECHAZADO: 'xCircle' }[estado] || 'info';
}

export async function orderDetail(ctx, [id]) {
  const root = ctx.view;
  async function render() {
    const order = await api(`/api/portal/pedidos/${id}`);
    if (!ctx.isCurrent()) return;
    ctx.setTitle(order.numero_visible, ESTADOS[order.estado]);
    const proveedor = ctx.user.rol === 'proveedor';
    const staff = ctx.can('pedidos.gestionar');
    const closed = ['CANCELADO', 'RECHAZADO'].includes(order.estado);
    const t = order.totales;
    const line = (label, value, cls = '') => `<div class="line ${cls}"><span>${label}</span><span>${value}</span></div>`;
    root.innerHTML = `
      <a class="btn btn-ghost btn-sm" href="#/pedidos" style="justify-self:start">${icon('arrowLeft', 'icon icon-sm')}Todos los pedidos</a>
      <div class="page-head"><div>
          <div class="row wrap" style="gap:10px"><h1>${esc(order.numero_visible)}</h1>${badge(order.estado)}</div>
          <p>${esc(TIPO[order.tipo][1])} · solicitado el ${esc(dateTime(order.creado_en))}${order.atendido_por ? ` · atendido por ${esc(order.atendido_por)}` : ''}</p></div>
        <div class="row wrap">
          ${staff ? order.transiciones.map((estado) => { const a = ACTIONS[estado]; return `<button class="btn ${a.className}" type="button" data-transition="${estado}">${icon(a.ico, 'icon icon-sm')}${esc(a.label)}</button>`; }).join('') : ''}
          ${order.cancelable ? `<button class="btn btn-danger" type="button" data-cancel>${icon('x', 'icon icon-sm')}Cancelar pedido</button>` : ''}
          <button class="btn btn-secondary" type="button" data-print>${icon('file', 'icon icon-sm')}Imprimir</button>
        </div></div>
      ${closed ? `<div class="notice error">${icon('alert')}<div><strong>Pedido ${esc(ESTADOS[order.estado].toLowerCase())}.</strong> ${esc(order.motivo || '')}</div></div>`
        : `<div class="card card-pad">${steps(order.estado)}</div>`}
      <div class="split">
        <div class="stack">
          <section class="card"><div class="card-head"><h3>Equipos${proveedor ? ' de tu tienda' : ''}</h3><span class="small muted">${order.items.length} línea${order.items.length === 1 ? '' : 's'}</span></div>
            ${order.items.map((item) => `<div class="cart-line">
              ${item.imagen ? `<img src="${esc(item.imagen)}" alt="">` : '<div class="thumb"></div>'}
              <div class="stack-sm" style="min-width:0"><div class="row wrap" style="gap:8px"><a class="strong" href="#/producto/${item.maquinaria_id}" style="color:var(--ink);text-decoration:none">${esc(item.nombre)}</a>
                <span class="badge b-${item.modalidad === 'RENTA' ? 'renta' : 'venta'}">${esc(MODALIDAD[item.modalidad])}</span></div>
                <p class="small muted">${item.modalidad === 'RENTA'
                  ? `${esc(date(item.fecha_inicio))} → ${esc(date(item.fecha_fin))} · ${item.dias} día${item.dias === 1 ? '' : 's'} · ${money(item.precio_unitario)}/día${item.con_operador ? ' · con operador' : ''}`
                  : `${item.cantidad} unidad${item.cantidad === 1 ? '' : 'es'} · ${money(item.precio_unitario)} c/u`}</p></div>
              <strong class="mono">${money(item.subtotal)}</strong></div>`).join('')}
          </section>
          <section class="card card-pad"><h3 style="margin-bottom:18px">Historial</h3>
            <ol class="timeline">${order.eventos.map((evento) => `<li class="${['CANCELADO', 'RECHAZADO'].includes(evento.estado) ? 'bad' : 'done'}">
              <span class="node">${icon(eventIcon(evento.estado), 'icon icon-sm')}</span>
              <div><div class="row wrap" style="gap:8px"><strong>${esc(ESTADOS[evento.estado])}</strong><span class="small muted">${esc(dateTime(evento.creado_en))}</span></div>
                <p class="small" style="color:var(--ink-2)">${esc(evento.nota || '')}</p>${evento.usuario ? `<p class="small muted">${esc(evento.usuario)}</p>` : ''}</div></li>`).join('')}</ol>
          </section>
        </div>
        <aside class="stack">
          ${proveedor ? `<section class="card card-pad stack"><h3>Tu liquidación</h3><div class="quote">
              ${line('Monto de tus equipos', money(order.liquidacion.bruto))}
              ${line(`Comisión de la plataforma (${order.liquidacion.comision_pct} %)`, `−${money(order.liquidacion.comision)}`)}
              ${line('Recibes', money(order.liquidacion.neto), 'total')}</div>
              <p class="small muted">Se liquida cuando el pedido se marca como entregado.</p></section>`
          : `<section class="card card-pad stack"><h3>Resumen de pago</h3><div class="quote">
              ${line('Subtotal', money(t.subtotal))}${t.descuento ? line('Descuento por duración', `−${money(t.descuento)}`) : ''}
              ${t.operador ? line('Operador certificado', money(t.operador)) : ''}${line('Flete a obra', money(t.flete))}
              ${line(`IVA (${order.tasas.iva} %)`, money(t.iva))}${t.deposito ? line('Depósito reembolsable', money(t.deposito)) : ''}
              ${line('Total', money(t.total), 'total')}</div>
              <p class="small muted row" style="gap:6px">${icon('dollar', 'icon icon-sm')}${esc(order.metodo_pago_texto)}</p></section>`}
          <section class="card card-pad stack-sm"><h3 style="margin-bottom:6px">Entrega</h3>
            <p class="row" style="gap:8px;align-items:flex-start">${icon('mapPin', 'icon icon-sm')}<span><strong>${esc(order.ciudad)}</strong><br><span class="muted">${esc(order.direccion)}</span></span></p>
            ${order.notas ? `<p class="small" style="color:var(--ink-2);padding:12px;border-radius:12px;background:var(--section)">${esc(order.notas)}</p>` : ''}</section>
          ${ctx.user.rol !== 'cliente' ? `<section class="card card-pad stack-sm"><h3 style="margin-bottom:6px">Cliente</h3>
            <p class="strong">${esc(order.cliente.empresa || order.cliente.nombre)}</p><p class="small muted">${esc(order.cliente.nombre)}</p>
            ${order.cliente.correo ? `<a class="small row" style="gap:6px" href="mailto:${esc(order.cliente.correo)}">${icon('mail', 'icon icon-sm')}${esc(order.cliente.correo)}</a>` : ''}
            ${order.cliente.telefono ? `<a class="small row" style="gap:6px" href="tel:${esc(order.cliente.telefono)}">${icon('phone', 'icon icon-sm')}${esc(order.cliente.telefono)}</a>` : ''}</section>` : ''}
        </aside>
      </div>`;
  }
  root.addEventListener('click', async (event) => {
    if (event.target.closest('[data-print]')) window.print();
    const transition = event.target.closest('[data-transition]')?.dataset.transition;
    const cancel = event.target.closest('[data-cancel]');
    if (!transition && !cancel) return;
    const action = transition ? ACTIONS[transition] : { note: true, label: 'Cancelar pedido' };
    let nota = '';
    if (action.note) {
      const result = await modal({ title: action.label, body: `<div class="field"><label for="m-nota">${transition === 'RECHAZADO' ? 'Motivo para el cliente' : 'Motivo (opcional)'}</label>
        <textarea class="textarea" id="m-nota" maxlength="500" rows="3" placeholder="Ej. El equipo está en mantenimiento esas fechas."></textarea></div>`,
      actions: [{ label: 'Volver', value: null }, { label: action.label, className: 'btn-danger', onClick: (body) => body.querySelector('#m-nota').value.trim() || ' ' }] });
      if (result === null) return;
      nota = result.trim();
    } else if (!await confirmDialog({ title: action.label, message: 'El cliente verá el cambio de estado inmediatamente.', confirm: action.label })) return;
    try {
      if (cancel) await api(`/api/portal/pedidos/${id}/cancelar`, { method: 'POST', body: { motivo: nota } });
      else await api(`/api/portal/pedidos/${id}/estado`, { method: 'POST', body: { estado: transition, nota } });
      toast('Pedido actualizado.', 'ok');
      ctx.refreshCounters?.();
      await render();
    } catch (error) { toast(Object.values(error.fields || {})[0] || error.message, 'error'); }
  });
  await render();
  return undefined;
}
