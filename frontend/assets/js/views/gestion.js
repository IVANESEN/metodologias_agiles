import { icon } from '../icons.js';
import {
  api, esc, money, number, date, dateTime, relative, toast, empty, modal, field, showFieldErrors, initials, ROLES,
} from '../ui.js';

const PLURAL = { admin: 'Administración', empleado: 'Empleados', proveedor: 'Proveedores', cliente: 'Clientes', gerente: 'Gerentes', residente: 'Residentes' };
const ROLE_BADGE = { admin: 'b-en_entrega', empleado: 'b-neutral', proveedor: 'b-venta', cliente: 'b-renta', gerente: 'b-borrador', residente: 'b-borrador' };

async function showSecret(title, usuario, clave) {
  const body = document.createElement('div');
  body.className = 'stack';
  body.innerHTML = `<p class="muted">Comparte esta contraseña temporal con <strong>${esc(usuario.nombre)}</strong> por un canal seguro. No se volverá a mostrar.</p>
    <div class="secret"><span data-secret>${esc(clave)}</span><button class="btn btn-sm" type="button" data-copy>${icon('copy', 'icon icon-sm')}Copiar</button></div>
    <div class="notice">${icon('info')}<p>Usuario: <strong>${esc(usuario.correo)}</strong>. Recomiéndale cambiarla desde “Mi perfil” al ingresar.</p></div>`;
  body.querySelector('[data-copy]').addEventListener('click', async (event) => {
    try { await navigator.clipboard.writeText(clave); event.currentTarget.innerHTML = `${icon('check', 'icon icon-sm')}Copiada`; }
    catch { toast('Selecciona y copia la contraseña manualmente.', 'error'); }
  });
  await modal({ title, body, actions: [{ label: 'Listo', className: '', value: true }] });
}

function userForm(user, roles, { isNew, canRole }) {
  return `<form class="stack" novalidate data-user-form>
    ${field({ name: 'nombre', label: 'Nombre o razón social', value: user.nombre || '', required: true, attrs: 'maxlength="160"' })}
    ${isNew ? field({ name: 'correo', label: 'Correo', type: 'email', value: '', required: true, attrs: 'maxlength="254" autocomplete="off"' }) : ''}
    ${canRole ? field({ name: 'rol', label: 'Rol', value: user.rol || roles[0], required: true, options: roles.map((r) => [r, ROLES[r]]) }) : ''}
    <div class="grid-2">${field({ name: 'empresa', label: 'Empresa', value: user.empresa || '', attrs: 'maxlength="160"' })}
    ${field({ name: 'telefono', label: 'Teléfono', type: 'tel', value: user.telefono || '', attrs: 'maxlength="30" placeholder="2222-0000"' })}</div>
    ${field({ name: 'documento', label: 'NIT o DUI', value: user.documento || '', attrs: 'maxlength="30"' })}
    ${!isNew ? `<label class="check"><input type="checkbox" name="activo" ${user.activo ? 'checked' : ''}> Cuenta activa</label>` : ''}
    <p class="notice error" data-form-error hidden></p></form>`;
}

export async function usersView(ctx) {
  const root = ctx.view;
  const admin = ctx.user.rol === 'admin';
  const title = admin ? 'Usuarios y roles' : 'Clientes y proveedores';
  ctx.setTitle(title);
  const state = { rol: '', q: '', data: null };
  async function load() {
    state.data = await api('/api/portal/usuarios');
    if (ctx.isCurrent()) paint();
  }
  function paint() {
    const { usuarios, roles_permitidos: roles } = state.data;
    const counts = Object.fromEntries(roles.map((r) => [r, usuarios.filter((u) => u.rol === r).length]));
    const q = state.q.toLowerCase();
    const rows = usuarios.filter((u) => (!state.rol || u.rol === state.rol) &&
      (!q || [u.nombre, u.correo, u.empresa, u.telefono].some((v) => String(v || '').toLowerCase().includes(q))));
    root.querySelector('[data-tabs]').innerHTML = [['', 'Todos', usuarios.length], ...roles.filter((r) => counts[r]).map((r) => [r, PLURAL[r], counts[r]])]
      .map(([value, label, n]) => `<button class="chip" type="button" data-rol="${value}" aria-pressed="${state.rol === value}">${esc(label)}<span class="n">${n}</span></button>`).join('');
    root.querySelector('[data-results]').innerHTML = rows.length ? `<div class="table-wrap"><table class="table"><thead><tr>
      <th>Usuario</th><th>Rol</th><th class="hide-sm">Contacto</th><th class="hide-sm">Actividad</th><th class="hide-sm">Último acceso</th><th>Estado</th><th></th></tr></thead>
      <tbody>${rows.map((u) => `<tr data-id="${u.id}">
        <td><div class="row"><span class="avatar">${esc(initials(u.nombre))}</span><div style="min-width:0"><div class="strong">${esc(u.nombre)}</div><div class="small muted">${esc(u.correo)}</div></div></div></td>
        <td><span class="badge ${ROLE_BADGE[u.rol]}">${esc(ROLES[u.rol])}</span></td>
        <td class="hide-sm"><div class="small">${esc(u.empresa || '—')}</div><div class="small muted">${esc(u.telefono || '')}</div></td>
        <td class="hide-sm small">${u.rol === 'proveedor' ? `${u.productos} producto${u.productos === 1 ? '' : 's'}` : u.rol === 'cliente' ? `${u.pedidos} pedido${u.pedidos === 1 ? '' : 's'}` : '—'}</td>
        <td class="hide-sm small muted">${esc(relative(u.ultimo_acceso))}</td>
        <td>${u.activo ? '<span class="badge b-activo"><span class="dot"></span>Activo</span>' : '<span class="badge b-archivado"><span class="dot"></span>Inactivo</span>'}</td>
        <td class="num"><div class="row" style="justify-content:flex-end;gap:6px">
          <button class="icon-btn" type="button" data-edit aria-label="Editar ${esc(u.nombre)}" title="Editar">${icon('edit')}</button>
          <button class="icon-btn" type="button" data-reset aria-label="Generar contraseña temporal para ${esc(u.nombre)}" title="Contraseña temporal">${icon('key')}</button></div></td>
      </tr>`).join('')}</tbody></table></div>`
      : empty({ iconName: 'users', title: 'Sin usuarios', text: 'Ajusta el filtro o crea una cuenta nueva.' });
  }
  root.innerHTML = `
    <div class="page-head"><div><span class="eyebrow">${admin ? 'Gobierno' : 'Cuentas'}</span><h1 style="margin-top:6px">${esc(title)}</h1>
      <p>${admin ? 'Crea cuentas para cualquier rol, cambia permisos y desactiva accesos. Los cambios de rol cierran las sesiones abiertas.'
        : 'Da de alta a clientes y proveedores con una contraseña temporal segura que podrán cambiar al ingresar.'}</p></div>
      <button class="btn btn-lg" type="button" data-create>${icon('plus', 'icon icon-sm')}Crear usuario</button></div>
    <div class="row-between wrap"><div class="chips" data-tabs role="group" aria-label="Filtrar por rol"></div>
      <div class="input-group" style="width:min(320px,100%)">${icon('search')}<input class="input" type="search" data-q placeholder="Buscar por nombre, correo o empresa" aria-label="Buscar usuarios" style="min-height:40px;border-radius:999px"></div></div>
    <section class="card" data-results><div class="card-body"><div class="skeleton" style="height:240px"></div></div></section>`;

  async function submitUser(node, { isNew, user }) {
    const form = node.querySelector('[data-user-form]');
    const data = Object.fromEntries(new FormData(form));
    const body = { ...data, activo: isNew ? undefined : form.querySelector('[name="activo"]').checked };
    try {
      const result = await api(isNew ? '/api/portal/usuarios/nuevo' : `/api/portal/usuarios/${user.id}`, { method: isNew ? 'POST' : 'PUT', body });
      return result;
    } catch (error) {
      showFieldErrors(form, error.fields);
      const box = form.querySelector('[data-form-error]');
      box.hidden = false; box.textContent = Object.values(error.fields || {})[0] || error.message;
      return false;
    }
  }
  root.addEventListener('click', async (event) => {
    const chip = event.target.closest('[data-rol]');
    if (chip) { state.rol = chip.dataset.rol; paint(); return; }
    const roles = state.data?.roles_permitidos || [];
    if (event.target.closest('[data-create]')) {
      const result = await modal({ title: 'Crear usuario', body: userForm({ rol: 'cliente' }, roles, { isNew: true, canRole: true }),
        actions: [{ label: 'Cancelar', value: null }, { label: 'Crear y generar contraseña', className: '', onClick: (node) => submitUser(node, { isNew: true }) }] });
      if (result) { await showSecret('Usuario creado', result.usuario, result.clave_temporal); await load(); }
      return;
    }
    const id = event.target.closest('[data-id]')?.dataset.id;
    const user = state.data?.usuarios.find((u) => u.id === id);
    if (!user) return;
    if (event.target.closest('[data-edit]')) {
      const result = await modal({ title: `Editar ${user.nombre}`, body: userForm(user, roles, { isNew: false, canRole: admin }),
        actions: [{ label: 'Cancelar', value: null }, { label: 'Guardar cambios', className: '', onClick: (node) => submitUser(node, { isNew: false, user }) }] });
      if (result) { toast('Usuario actualizado.', 'ok'); await load(); }
    }
    if (event.target.closest('[data-reset]')) {
      const ok = await modal({ title: 'Generar contraseña temporal', body: `<p class="muted">Se reemplazará la contraseña de <strong>${esc(user.nombre)}</strong> y se cerrarán todas sus sesiones abiertas.</p>`,
        actions: [{ label: 'Cancelar', value: false }, { label: 'Generar contraseña', className: '', value: true }] });
      if (!ok) return;
      try {
        const { clave_temporal: clave } = await api(`/api/portal/usuarios/${user.id}/clave`, { method: 'POST', body: {} });
        await showSecret('Nueva contraseña temporal', user, clave);
      } catch (error) { toast(error.message, 'error'); }
    }
  });
  root.querySelector('[data-q]').addEventListener('input', (event) => { state.q = event.target.value; paint(); });
  await load();
  return undefined;
}

// ------------------------------------------------------------------ tasas
function example(values) {
  // Ejemplo fijo: excavadora de $450/día, 10 días, con operador + compra de $52,900.
  const renta = 450 * 10; const descuento = renta * values.descuento_semanal / 100;
  const operador = values.tarifa_operador * 10; const compra = 52900; const flete = values.flete_base * 2;
  const base = renta - descuento + operador + compra + flete; const iva = base * values.iva / 100;
  const deposito = (renta - descuento) * values.deposito_garantia / 100;
  return { renta, descuento, operador, compra, flete, iva, deposito, total: base + iva + deposito, comision: compra * values.comision_proveedor / 100 };
}

export async function ratesView(ctx) {
  const root = ctx.view;
  ctx.setTitle('Tasas y configuración', 'Administración');
  const { tasas } = await api('/api/portal/configuracion');
  const values = Object.fromEntries(tasas.map((t) => [t.clave, t.valor]));
  const original = { ...values };
  root.innerHTML = `
    <div class="page-head"><div><span class="eyebrow">Gobierno</span><h1 style="margin-top:6px">Tasas y configuración</h1>
      <p>Los cambios aplican a cotizaciones y pedidos nuevos. Los pedidos existentes conservan las tasas con las que se crearon.</p></div></div>
    <form class="split" novalidate data-form>
      <section class="card"><div class="card-head"><h3>Tasas vigentes</h3><span class="small muted" data-changes>Sin cambios</span></div>
        <div class="list">${tasas.map((t) => `<div class="list-item" style="align-items:flex-start">
          <span class="kpi-icon" style="display:grid;place-items:center;width:42px;height:42px;border-radius:14px;background:var(--azul-050);color:var(--azul);flex:none">${icon(t.unidad === '%' ? 'percent' : 'dollar')}</span>
          <div class="grow stack-sm"><label class="strong" for="t-${t.clave}" style="color:var(--ink)">${esc(t.etiqueta)}</label><p class="small muted">${esc(t.descripcion)}</p>
            <p class="small muted">Rango ${number(t.minimo)}–${number(t.maximo)} ${esc(t.unidad)} · actualizado ${esc(relative(t.actualizado_en))}</p>
            <p class="error" data-error-for="${t.clave}" hidden></p></div>
          <div class="input-group" style="width:150px;flex:none"><input class="input" id="t-${t.clave}" name="${t.clave}" type="number" step="0.01" min="${t.minimo}" max="${t.maximo}" value="${t.valor}" style="padding-left:14px;padding-right:58px;text-align:right">
            <span class="small muted" style="position:absolute;right:14px">${esc(t.unidad)}</span></div></div>`).join('')}</div>
        <div class="card-body row" style="justify-content:flex-end;border-top:1px solid var(--line)">
          <button class="btn btn-secondary" type="button" data-reset>Descartar</button><button class="btn" type="submit">${icon('check', 'icon icon-sm')}Guardar tasas</button></div>
      </section>
      <aside class="card card-pad stack"><div><span class="eyebrow">Simulación</span><h3 style="margin-top:4px">Así queda un pedido típico</h3>
        <p class="small muted">Renta de excavadora $450/día por 10 días con operador, más la compra de un minicargador de $52,900.</p></div>
        <div data-example></div></aside>
    </form>`;
  const form = root.querySelector('[data-form]');
  function paintExample() {
    const e = example(values);
    const line = (label, value, cls = '') => `<div class="line ${cls}"><span>${label}</span><span>${value}</span></div>`;
    root.querySelector('[data-example]').innerHTML = `<div class="quote">
      ${line('Renta 10 días', money(e.renta))}${line(`Descuento semanal (${values.descuento_semanal} %)`, `−${money(e.descuento)}`)}
      ${line('Operador', money(e.operador))}${line('Compra minicargador', money(e.compra))}${line('Flete (2 equipos)', money(e.flete))}
      ${line(`IVA (${values.iva} %)`, money(e.iva))}${line(`Depósito (${values.deposito_garantia} %)`, money(e.deposito))}
      ${line('Total al cliente', money(e.total), 'total')}</div>
      <div class="notice">${icon('info')}<p>Si el minicargador es de un proveedor, la plataforma retiene <strong>${money(e.comision)}</strong> de comisión (${values.comision_proveedor} %).</p></div>`;
    const changed = Object.keys(values).filter((k) => Number(values[k]) !== Number(original[k])).length;
    root.querySelector('[data-changes]').textContent = changed ? `${changed} cambio${changed === 1 ? '' : 's'} sin guardar` : 'Sin cambios';
  }
  form.addEventListener('input', (event) => { if (event.target.name) { values[event.target.name] = Number(event.target.value) || 0; paintExample(); } });
  root.querySelector('[data-reset]').addEventListener('click', () => {
    Object.assign(values, original);
    for (const [k, v] of Object.entries(original)) form.querySelector(`[name="${k}"]`).value = v;
    paintExample();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const changes = Object.fromEntries(Object.keys(values).filter((k) => Number(values[k]) !== Number(original[k]))
      .map((k) => [k, form.querySelector(`[name="${k}"]`).value]));
    if (!Object.keys(changes).length) { toast('No hay cambios por guardar.'); return; }
    try {
      const result = await api('/api/portal/configuracion/editar', { method: 'PUT', body: { valores: changes } });
      ctx.config = null;
      Object.assign(original, Object.fromEntries(result.tasas.map((t) => [t.clave, t.valor])));
      showFieldErrors(form, {});
      paintExample();
      toast(`${result.cambios} tasa${result.cambios === 1 ? '' : 's'} actualizada${result.cambios === 1 ? '' : 's'}. Quedó registrado en auditoría.`, 'ok');
    } catch (error) { showFieldErrors(form, error.fields); toast(error.message, 'error'); }
  });
  paintExample();
  return undefined;
}

// ------------------------------------------------------------------ auditoría
const ACCIONES = {
  'producto.crear': 'Creó un producto', 'producto.editar': 'Editó un producto', 'producto.aprobar': 'Aprobó un producto', 'producto.rechazar': 'Pidió cambios en un producto',
  'pedido.crear': 'Creó un pedido', 'pedido.estado': 'Cambió el estado de un pedido', 'usuario.crear': 'Creó un usuario', 'usuario.registro': 'Se registró como cliente',
  'usuario.editar': 'Editó un usuario', 'usuario.clave_temporal': 'Generó una contraseña temporal', 'usuario.cambiar_clave': 'Cambió su contraseña',
  'usuario.perfil': 'Actualizó su perfil', 'configuracion.editar': 'Cambió tasas', 'demo.cargar': 'Cargó datos de demostración',
};
function detail(row) {
  const d = row.detalle || {};
  if (row.accion === 'configuracion.editar') return (d.cambios || []).map((c) => `${c.clave}: ${c.de} → ${c.a}`).join(' · ');
  if (row.accion === 'pedido.estado') return `${d.de} → ${d.a}`;
  if (d.rol?.de) return `Rol ${d.rol.de} → ${d.rol.a}`;
  return Object.entries(d).filter(([, v]) => v !== undefined && typeof v !== 'object').map(([k, v]) => `${k}: ${v}`).join(' · ');
}
export async function auditView(ctx) {
  const root = ctx.view;
  ctx.setTitle('Auditoría', 'Administración');
  const rows = await api('/api/portal/auditoria');
  root.innerHTML = `
    <div class="page-head"><div><span class="eyebrow">Trazabilidad</span><h1 style="margin-top:6px">Bitácora de auditoría</h1>
      <p>Últimas 200 acciones sensibles: tasas, usuarios, moderación y pedidos. No se registran contraseñas ni tokens.</p></div>
      <div class="input-group" style="width:min(320px,100%)">${icon('search')}<input class="input" type="search" data-q placeholder="Filtrar por persona o acción" aria-label="Filtrar bitácora" style="min-height:40px;border-radius:999px"></div></div>
    <section class="card" data-results></section>`;
  const paint = (q = '') => {
    const filtered = rows.filter((row) => !q || [row.usuario, ACCIONES[row.accion], row.accion, detail(row)].some((v) => String(v || '').toLowerCase().includes(q.toLowerCase())));
    root.querySelector('[data-results]').innerHTML = filtered.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Persona</th><th>Acción</th><th class="hide-sm">Detalle</th></tr></thead>
      <tbody>${filtered.map((row) => `<tr><td class="small"><div>${esc(dateTime(row.creado_en))}</div><div class="muted">${esc(relative(row.creado_en))}</div></td>
        <td><div class="strong">${esc(row.usuario || 'Sistema')}</div><div class="small muted">${esc(ROLES[row.rol] || '')}</div></td>
        <td>${esc(ACCIONES[row.accion] || row.accion)}<div class="small muted">${esc(row.entidad)}${row.entidad_id ? ` · ${esc(String(row.entidad_id).slice(0, 8))}` : ''}</div></td>
        <td class="hide-sm small" style="color:var(--ink-2)">${esc(detail(row))}</td></tr>`).join('')}</tbody></table></div>`
      : empty({ iconName: 'history', title: 'Sin registros', text: 'No hay acciones que coincidan.' });
  };
  root.querySelector('[data-q]').addEventListener('input', (event) => paint(event.target.value));
  paint();
  return undefined;
}

// ------------------------------------------------------------------ perfil
export async function profileView(ctx) {
  const root = ctx.view;
  ctx.setTitle('Mi perfil');
  const { perfil } = await api('/api/portal/resumen');
  root.innerHTML = `
    <div class="card card-pad row wrap" style="gap:20px">
      <span class="avatar lg">${esc(initials(perfil.nombre))}</span>
      <div class="grow"><h1 style="font-size:24px">${esc(perfil.nombre)}</h1>
        <p class="muted">${esc(perfil.correo)} · <span class="badge ${ROLE_BADGE[perfil.rol]}">${esc(ROLES[perfil.rol])}</span></p>
        <p class="small muted" style="margin-top:4px">Miembro desde ${esc(date(perfil.creado_en))} · último acceso ${esc(relative(perfil.ultimo_acceso))}</p></div>
    </div>
    <div class="grid-2" style="align-items:start;gap:24px">
      <form class="card card-pad stack" novalidate data-profile><h3>Datos de contacto</h3>
        ${field({ name: 'nombre', label: 'Nombre', value: perfil.nombre, required: true, attrs: 'maxlength="160" autocomplete="name"' })}
        ${field({ name: 'empresa', label: 'Empresa', value: perfil.empresa || '', attrs: 'maxlength="160" autocomplete="organization"' })}
        <div class="grid-2">${field({ name: 'telefono', label: 'Teléfono', type: 'tel', value: perfil.telefono || '', attrs: 'maxlength="30" autocomplete="tel"' })}
        ${field({ name: 'documento', label: 'NIT o DUI', value: perfil.documento || '', attrs: 'maxlength="30"' })}</div>
        <button class="btn" type="submit" style="justify-self:start">${icon('check', 'icon icon-sm')}Guardar datos</button></form>
      <form class="card card-pad stack" novalidate data-password><h3>Cambiar contraseña</h3>
        <p class="small muted">Al cambiarla cerramos tus otras sesiones abiertas.</p>
        ${field({ name: 'actual', label: 'Contraseña actual', type: 'password', required: true, attrs: 'autocomplete="current-password" maxlength="256"' })}
        ${field({ name: 'nueva', label: 'Nueva contraseña', type: 'password', required: true, hint: 'Mínimo 8 caracteres con letras y números.', attrs: 'autocomplete="new-password" minlength="8" maxlength="256"' })}
        ${field({ name: 'confirmacion', label: 'Confirmar nueva contraseña', type: 'password', required: true, attrs: 'autocomplete="new-password" maxlength="256"' })}
        <button class="btn" type="submit" style="justify-self:start">${icon('lock', 'icon icon-sm')}Actualizar contraseña</button></form>
    </div>`;
  root.querySelectorAll('input[type="password"]').forEach((input) => {
    const wrap = document.createElement('div'); wrap.className = 'input-group';
    input.replaceWith(wrap); wrap.append(input);
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'password-toggle addon';
    toggle.setAttribute('aria-label', 'Mostrar contraseña'); toggle.innerHTML = icon('eye');
    toggle.addEventListener('click', () => { const show = input.type === 'password'; input.type = show ? 'text' : 'password'; toggle.innerHTML = icon(show ? 'eyeOff' : 'eye'); });
    wrap.append(toggle);
  });
  root.querySelector('[data-profile]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const updated = await api('/api/portal/perfil', { method: 'PUT', body: Object.fromEntries(new FormData(form)) });
      ctx.user.nombre = updated.nombre;
      showFieldErrors(form, {});
      toast('Datos actualizados.', 'ok');
    } catch (error) { showFieldErrors(form, error.fields); toast(error.message, 'error'); }
  });
  root.querySelector('[data-password]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (data.nueva !== data.confirmacion) { showFieldErrors(form, { confirmacion: 'Las contraseñas no coinciden.' }); return; }
    try {
      const result = await api('/api/portal/perfil/clave', { method: 'POST', body: { actual: data.actual, nueva: data.nueva } });
      form.reset(); showFieldErrors(form, {});
      toast(result.message, 'ok');
    } catch (error) { showFieldErrors(form, error.fields); toast(Object.values(error.fields || {})[0] || error.message, 'error'); }
  });
  return undefined;
}
