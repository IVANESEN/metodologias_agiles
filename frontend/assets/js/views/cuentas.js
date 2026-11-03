import { api, esc, money, dateTime, modal, field, toast } from '../ui.js';

export function accountRows(rows, canRegister) {
  return rows.map((r, index) => `<tr><td><strong>${esc(r.numero)}</strong><div class="small muted">${esc(r.origen)}</div></td>
    <td>${esc(r.contraparte)}${r.es_empresa ? '<div class="small muted">Alquiler de Constructora</div>' : ''}</td>
    <td class="num">${money(r.total)}${r.bruto != null ? `<div class="small muted">Bruto ${money(r.bruto)} · Comisión ${money(r.comision)}</div>` : ''}</td>
    <td class="num">${money(r.abonado)}</td><td class="num strong">${money(r.saldo)}</td>
    <td><details><summary>${r.movimientos.length} movimientos</summary>${r.movimientos.map(m =>
      `<p class="small">${esc(dateTime(m.creado_en))} · ${money(m.monto)}<br>${esc(m.metodo || 'Histórico')} · ${esc(m.referencia || 'Sin referencia histórica')}</p>`).join('') || '<p class="small muted">Sin abonos registrados.</p>'}</details>
    ${canRegister && r.saldo > 0 ? `<button class="btn btn-sm" data-pay="${index}" type="button">Registrar ${r.tipo_movimiento === 'COBRO_CLIENTE' ? 'cobro' : 'pago'}</button>` : ''}
    ${canRegister && r.origen === 'PEDIDO' && r.tipo_movimiento === 'COBRO_CLIENTE' && !r.movimientos.length ? `<button class="btn btn-sm btn-secondary" data-link="${index}" type="button">Vincular contrato</button>` : ''}</td></tr>`).join('');
}

export async function accountsView(ctx) {
  const root = ctx.view;
  const provider = ctx.user.rol === 'proveedor';
  const employee = ctx.user.rol === 'empleado';
  const canRegister = ctx.can('cuentas.registrar');
  ctx.setTitle(provider ? 'Mi estado de cuenta' : employee ? 'Estado de cuenta de la empresa' : 'Cuentas por cobrar y pagar');
  let all = [];
  async function load() {
    const data = await api('/api/portal/cuentas');
    if (!ctx.isCurrent()) return;
    all = [...data.cobros, ...data.pagos];
    const groups = [];
    if (!provider && !employee) groups.push(['Cuentas por cobrar', data.cobros, data.resumen.cobros]);
    groups.push([provider ? 'Pagos pendientes de recibir' : 'Cuentas por pagar', data.pagos, data.resumen.pagos]);
    let offset = 0;
    root.innerHTML = `<div class="page-head"><div><h1>Estado de cuenta${employee ? ' de Constructora El Salvador' : ''}</h1>
      <p>${provider ? 'Consulta las operaciones de tus equipos y los abonos recibidos.' : employee ? 'Consulta las obligaciones de los alquileres solicitados por los empleados de Constructora.' : 'Registra los cobros a clientes y los pagos a proveedores por separado.'}</p></div></div>
      <p class="notice">Las obligaciones del portal aparecen después de aprobar el pedido. La comisión se calcula con la tasa guardada en esa operación. Los movimientos registran comprobantes; no realizan transferencias bancarias.</p>
      ${groups.map(([title, rows, summary]) => {
        const table = accountRows(rows, canRegister).replace(/data-(pay|link)="(\d+)"/g, (_, action, i) => `data-${action}="${Number(i)+offset}"`);
        offset += rows.length;
        return `<section class="card card-pad stack" style="margin-top:24px"><h2>${title}</h2>
          <div class="row-between wrap"><span>Total <strong>${money(summary.total)}</strong></span><span>Abonos <strong>${money(summary.abonado)}</strong></span><span>Saldo pendiente <strong>${money(summary.saldo)}</strong></span></div>
          ${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Operación</th><th>Contraparte</th><th class="num">Total</th><th class="num">Abonos</th><th class="num">Saldo</th><th>Detalle</th></tr></thead><tbody>${table}</tbody></table></div>` : '<p class="muted">No hay obligaciones aprobadas para mostrar.</p>'}</section>`;
      }).join('')}`;
  }
  root.addEventListener('click', async event => {
    const pay = event.target.closest('[data-pay]');
    const link = event.target.closest('[data-link]');
    if ((!pay && !link) || !canRegister) return;
    const row = all[Number((pay || link).dataset[pay ? 'pay' : 'link'])];
    if (!row) return;
    const requestId = crypto.randomUUID();
    try {
      const saved = await modal({ title: pay ? `${row.tipo_movimiento === 'COBRO_CLIENTE' ? 'Registrar cobro' : 'Registrar pago'} · ${row.numero}` : 'Vincular contrato al pedido',
        body: pay ? `<form data-payment class="stack"><p>Saldo pendiente: <strong>${money(row.saldo)}</strong></p>
          ${field({ name: 'monto', label: 'Monto', type: 'number', required: true, attrs: `min="0.01" step="0.01" max="${row.saldo}"` })}
          ${field({ name: 'metodo', label: 'Método', required: true, options: [['TRANSFERENCIA','Transferencia'],['EFECTIVO','Efectivo'],['CHEQUE','Cheque']] })}
          ${field({ name: 'referencia', label: 'Referencia del comprobante', required: true, attrs: 'maxlength="120" autocomplete="off"' })}</form>`
          : `<form data-payment class="stack"><p>Vincula únicamente el contrato que corresponde a este pedido. El cobro se llevará en el pedido y el contrato dejará de aparecer como otra deuda. Ambas operaciones deben estar sin movimientos.</p>
          ${field({ name: 'contrato_id', label: 'Identificador completo del contrato', required: true, attrs: 'maxlength="36"' })}</form>`,
        actions: [{ label: 'Cancelar', className: 'btn-secondary' }, { label: 'Guardar', onClick: async node => {
          const form = node.querySelector('form');
          if (!form.reportValidity()) return false;
          const values = Object.fromEntries(new FormData(form));
          try {
            if (pay) await api('/api/portal/cuentas/movimientos', { method:'POST', body: { ...values, id: requestId,
              origen: row.origen, operacion_id: row.operacion_id, tipo_movimiento: row.tipo_movimiento, proveedor_id: row.proveedor_id } });
            else await api('/api/portal/cuentas/vincular', { method:'POST', body: { pedido_id: row.operacion_id, contrato_id: values.contrato_id } });
            return true;
          } catch (error) { toast(error.message, 'error'); return false; }
        } }] });
      if (saved) { toast('Movimiento guardado correctamente.', 'ok'); await load(); }
    } catch (error) { toast(error.message, 'error'); }
  });
  await load();
}
