import { api, esc, money, dateTime, modal, field, toast } from '../ui.js';

export function accountRows(rows, canRegister) {
  return rows.map((r, index) => `<tr><td><strong>${esc(r.numero)}</strong><div class="small muted">${esc(r.origen)}</div></td>
    <td>${esc(r.contraparte)}${r.es_empresa ? '<div class="small muted">Alquiler de Constructora</div>' : ''}</td>
    <td class="num">${money(r.total)}${r.bruto != null ? `<div class="small muted">Bruto ${money(r.bruto)} · Comisión ${money(r.comision)}</div>` : ''}</td>
    <td class="num">${money(r.abonado)}</td><td class="num strong">${money(r.saldo)}${r.requiere_conciliacion ? '<div class="small muted">Abonos históricos por conciliar</div>' : ''}</td>
    <td><details><summary>${r.movimientos.length} movimientos</summary>${r.movimientos.map(m =>
      `<p class="small">${esc(dateTime(m.creado_en))} · ${money(m.monto)}<br>${esc(m.metodo || 'Histórico')} · ${esc(m.referencia || 'Sin referencia histórica')}</p>`).join('') || '<p class="small muted">Sin abonos registrados.</p>'}</details>
    ${canRegister && r.saldo > 0 && !r.requiere_conciliacion ? `<button class="btn btn-sm" data-pay="${index}" type="button">Registrar ${r.tipo_movimiento === 'COBRO_CLIENTE' ? 'cobro' : 'pago'}</button>` : ''}
    ${canRegister && r.origen === 'PEDIDO' && r.tipo_movimiento === 'COBRO_CLIENTE' && !r.movimientos.length ? `<button class="btn btn-sm btn-secondary" data-link="${index}" type="button">Vincular contrato</button>` : ''}</td></tr>`).join('');
}

export async function accountsView(ctx) {
  const root = ctx.view;
  const provider = ctx.user.rol === 'proveedor';
  const employee = ctx.user.rol === 'empleado';
  const canRegister = ctx.can('cuentas.registrar');
  ctx.setTitle(provider ? 'Mi estado de cuenta' : employee ? 'Estado de cuenta de la empresa' : 'Cuentas por cobrar y pagar');
  let all = [];
  let reconciliations = [];
  async function load() {
    const data = await api('/api/portal/cuentas');
    if (!ctx.isCurrent()) return;
    all = [...data.cobros, ...data.pagos];
    reconciliations = data.conciliaciones || [];
    const groups = [];
    if (!provider && !employee) groups.push(['Cuentas por cobrar', data.cobros, data.resumen.cobros]);
    groups.push([provider ? 'Pagos pendientes de recibir' : 'Cuentas por pagar', data.pagos, data.resumen.pagos]);
    let offset = 0;
    root.innerHTML = `<div class="page-head"><div><h1>Estado de cuenta${employee ? ' de Constructora El Salvador' : ''}</h1>
      <p>${provider ? 'Constructora El Salvador te debe los siguientes alquileres de tus equipos. Cada abono registrado por administración actualiza este mismo saldo.' : employee ? 'Consulta los pagos pendientes de Constructora por los alquileres a proveedores.' : 'Los alquileres de maquinaria de proveedores son cuentas por pagar de Constructora. Los cobros corresponden a clientes externos.'}</p></div></div>
      <p class="notice">Los pedidos generan obligaciones al aprobarse y los contratos independientes al confirmarse. En pedidos se conserva la comisión pactada; en contratos se usa la tarifa contratada por los días de alquiler. Los movimientos registran comprobantes; no realizan transferencias bancarias.</p>
      ${data.pagos.some(r=>r.requiere_conciliacion) ? '<p class="notice">Los saldos señalados con abonos por conciliar son provisionales. Administración debe revisar esos comprobantes antes de registrar otro pago.</p>' : ''}
      ${canRegister && reconciliations.length ? `<section class="card card-pad stack"><h2>Abonos históricos por conciliar</h2><p>Estos contratos estaban clasificados como cobros. Antes de registrar otro pago, revisa los comprobantes y confirma si son pagos hechos al proveedor. No se suman como abonos recibidos hasta confirmarlo.</p>${reconciliations.map((r,i)=>`<div class="row-between"><span>${esc(r.numero)} · ${r.movimientos.length} comprobantes</span><button class="btn btn-secondary" data-reconcile="${i}" type="button">Revisar comprobantes</button></div>`).join('')}</section>` : ''}
      ${groups.map(([title, rows, summary]) => {
        const table = accountRows(rows, canRegister).replace(/data-(pay|link)="(\d+)"/g, (_, action, i) => `data-${action}="${Number(i)+offset}"`);
        offset += rows.length;
        return `<section class="card card-pad stack" style="margin-top:24px"><h2>${title}</h2>
          <div class="row-between wrap"><span>Total <strong>${money(summary.total)}</strong></span><span>Abonos <strong>${money(summary.abonado)}</strong></span><span>Saldo pendiente <strong>${money(summary.saldo)}</strong></span></div>
          ${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Operación</th><th>Contraparte</th><th class="num">Total</th><th class="num">Abonos</th><th class="num">Saldo</th><th>Detalle</th></tr></thead><tbody>${table}</tbody></table></div>` : '<p class="muted">No hay obligaciones aprobadas para mostrar.</p>'}</section>`;
      }).join('')}`;
  }
  root.addEventListener('click', async event => {
    const reconcile = event.target.closest('[data-reconcile]');
    if (reconcile && canRegister) {
      const row = reconciliations[Number(reconcile.dataset.reconcile)];
      if (!row) return;
      const saved = await modal({title:`Conciliar ${row.numero}`,body:`<form class="stack"><p>Asigna cada comprobante al proveedor que recibió el dinero. Se conserva el registro original y queda una auditoría del cambio. Si un comprobante cubre varios proveedores o no fue un pago al proveedor, requiere revisión contable antes de continuar.</p>
        ${row.movimientos.map((m,i)=>`<div><p>${money(m.monto)} · ${esc(m.referencia || 'Sin referencia histórica')} · ${esc(dateTime(m.creado_en))}</p>${field({name:`proveedor_${i}`,label:'Proveedor que recibió este pago',required:true,options:[['','Seleccionar proveedor'],...row.proveedores.map(p=>[p.id,p.nombre])]})}</div>`).join('')}
        <label><input name="confirmar" type="checkbox" required> Confirmo que revisé los comprobantes y corresponden a pagos hechos por Constructora a los proveedores seleccionados.</label></form>`,
        actions:[{label:'Cancelar',className:'btn-secondary'},{label:'Confirmar conciliación',onClick:async node=>{
          const form=node.querySelector('form');if(!form.reportValidity())return false;
          const values=new FormData(form);
          try {
            await api('/api/portal/cuentas/conciliar',{method:'POST',body:{contrato_id:row.contrato_id,confirmar:true,
              asignaciones:row.movimientos.map((m,i)=>({pago_id:m.id,proveedor_id:values.get(`proveedor_${i}`)}))}});
            return true;
          } catch(error) {toast(error.message,'error');return false;}
        }}]});
      if(saved){toast('Comprobantes conciliados.','ok');await load();}return;
    }
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
