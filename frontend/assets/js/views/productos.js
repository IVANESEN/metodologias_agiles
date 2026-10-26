import { icon } from '../icons.js';
import {
  api, esc, money0, number, badge, relative, toast, empty, modal, field, showFieldErrors, compressImage, MODALIDAD, CONDICION,
} from '../ui.js';
import { loadConfig, productCard } from './tienda.js';

const TABS = [['', 'Todos'], ['ACTIVO', 'Publicados'], ['PENDIENTE', 'En revisión'], ['BORRADOR', 'Borradores'], ['RECHAZADO', 'Rechazados'], ['ARCHIVADO', 'Archivados']];
const CIUDADES = ['San Salvador', 'Santa Tecla', 'Soyapango', 'Apopa', 'Antiguo Cuscatlán', 'La Libertad', 'Santa Ana', 'Sonsonate',
  'San Miguel', 'Usulután', 'La Unión', 'Chalatenango', 'Cojutepeque', 'Zacatecoluca', 'San Vicente', 'Ahuachapán', 'Morazán'];

const canEdit = (ctx, product) => ctx.can('productos.gestionar') && (ctx.user.rol === 'admin' || product.proveedor_id === ctx.user.id);

export async function productsList(ctx) {
  const root = ctx.view;
  const rol = ctx.user.rol;
  const title = rol === 'proveedor' ? 'Mis productos' : rol === 'admin' ? 'Productos' : 'Inventario';
  ctx.setTitle(title);
  const state = { estado: ctx.query.get('estado') || '', q: '' };
  root.innerHTML = `
    <div class="page-head"><div><span class="eyebrow">${rol === 'proveedor' ? 'Tu tienda' : 'Catálogo completo'}</span><h1 style="margin-top:6px">${esc(title)}</h1>
      <p>${rol === 'proveedor' ? 'Administra fotos, precios e inventario. Los productos nuevos pasan por una revisión rápida antes de publicarse.'
        : 'Equipo de la flota ICI y de todos los proveedores, con su estado de publicación.'}</p></div>
      ${ctx.can('productos.gestionar') ? `<a class="btn btn-lg" href="#/productos/nuevo">${icon('plus', 'icon icon-sm')}Agregar producto</a>` : ''}</div>
    <div class="row-between wrap">
      <div class="chips" role="group" aria-label="Estado de publicación">${TABS.map(([value, label]) =>
        `<button class="chip" type="button" data-estado="${value}" aria-pressed="${state.estado === value}">${esc(label)}</button>`).join('')}</div>
      <div class="input-group" style="width:min(320px,100%)">${icon('search')}<input class="input" type="search" data-q placeholder="Buscar por nombre, marca o SKU" aria-label="Buscar productos" style="min-height:40px;border-radius:999px"></div>
    </div>
    <section class="card" data-results><div class="card-body"><div class="skeleton" style="height:260px"></div></div></section>`;
  const results = root.querySelector('[data-results]');
  let products = [];
  function paint() {
    const q = state.q.toLowerCase();
    const rows = products.filter((p) => !q || [p.nombre, p.marca, p.modelo, p.sku, p.tipo].some((v) => String(v || '').toLowerCase().includes(q)));
    if (!rows.length) {
      results.innerHTML = empty({ iconName: 'package', title: products.length ? 'Sin coincidencias' : 'Aún no hay productos aquí',
        text: products.length ? 'Prueba con otra búsqueda.' : 'Agrega tu primer equipo con fotos, precio y ficha técnica.',
        action: ctx.can('productos.gestionar') && !products.length ? '<a class="btn" href="#/productos/nuevo">Agregar producto</a>' : '' });
      return;
    }
    results.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Producto</th><th>Estado</th><th class="hide-sm">Modalidad</th>
      <th class="num">Precio</th><th class="num">Inventario</th>${rol !== 'proveedor' ? '<th class="hide-sm">Proveedor</th>' : ''}<th class="hide-sm">Actualizado</th></tr></thead>
      <tbody>${rows.map((p) => `<tr class="clickable" tabindex="0" data-href="${canEdit(ctx, p) ? `#/productos/${p.id}` : `#/producto/${p.id}`}">
        <td><div class="row">${p.imagenes[0] ? `<img class="thumb" src="${esc(p.imagenes[0])}" alt="">` : `<span class="thumb" style="display:grid;place-items:center;color:var(--muted)">${icon('image', 'icon icon-sm')}</span>`}
          <div style="min-width:0"><div class="strong" style="color:var(--ink)">${esc(p.nombre)}</div><div class="small muted">${esc(p.tipo)}${p.sku ? ` · ${esc(p.sku)}` : ''}</div>
          ${p.estado_publicacion === 'RECHAZADO' && p.motivo_rechazo ? `<div class="small" style="color:var(--danger)">${esc(p.motivo_rechazo)}</div>` : ''}</div></div></td>
        <td>${badge(p.estado_publicacion, p.estado_publicacion === 'PENDIENTE' ? 'En revisión' : undefined)}</td>
        <td class="hide-sm">${esc(MODALIDAD[p.modalidad])}</td>
        <td class="num"><div class="strong">${p.tarifa_diaria ? `${money0(p.tarifa_diaria)}/día` : money0(p.precio_venta)}</div>${p.modalidad === 'AMBAS' ? `<div class="small muted">${money0(p.precio_venta)} venta</div>` : ''}</td>
        <td class="num"><span class="${p.stock ? '' : 'strong'}" style="${p.stock ? '' : 'color:var(--danger)'}">${p.stock ? `${p.stock} en existencia` : 'Agotado'}</span><div class="small muted">${p.pedidos} pedido${p.pedidos === 1 ? '' : 's'}</div></td>
        ${rol !== 'proveedor' ? `<td class="hide-sm">${esc(p.proveedor)}</td>` : ''}
        <td class="hide-sm small muted">${esc(relative(p.actualizado_en))}</td></tr>`).join('')}</tbody></table></div>`;
  }
  async function load() {
    results.innerHTML = '<div class="card-body"><div class="skeleton" style="height:260px"></div></div>';
    products = await api(`/api/portal/productos${state.estado ? `?estado=${state.estado}` : ''}`);
    if (ctx.isCurrent()) paint();
  }
  root.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-estado]');
    if (chip) {
      state.estado = chip.dataset.estado;
      root.querySelectorAll('[data-estado]').forEach((b) => b.setAttribute('aria-pressed', String(b === chip)));
      history.replaceState(null, '', `#/productos${state.estado ? `?estado=${state.estado}` : ''}`);
      load().catch((error) => toast(error.message, 'error'));
    }
    const row = event.target.closest('[data-href]');
    if (row) location.hash = row.dataset.href;
  });
  root.addEventListener('keydown', (event) => { const row = event.target.closest('[data-href]'); if (row && event.key === 'Enter') location.hash = row.dataset.href; });
  root.querySelector('[data-q]').addEventListener('input', (event) => { state.q = event.target.value; paint(); });
  await load();
  return undefined;
}

// ------------------------------------------------------------------ editor
const STATUS_TEXT = {
  BORRADOR: ['Borrador', 'Solo tú lo ves. Publícalo cuando esté listo.'],
  PENDIENTE: ['En revisión', 'El equipo ICI lo está revisando. Normalmente toma menos de un día hábil.'],
  ACTIVO: ['Publicado', 'Visible en el catálogo para todos los clientes.'],
  RECHAZADO: ['Por corregir', 'Revisa el comentario del equipo ICI y vuelve a enviarlo.'],
  ARCHIVADO: ['Archivado', 'Oculto del catálogo. Puedes volver a publicarlo cuando quieras.'],
};

export async function productEditor(ctx, [param]) {
  const root = ctx.view;
  const isNew = param === 'nuevo';
  const config = await loadConfig(ctx);
  const product = isNew ? { modalidad: 'RENTA', condicion: 'USADO', stock: 1, especificaciones: {}, imagenes: [], estado_publicacion: 'BORRADOR' }
    : await api(`/api/portal/productos/${param}`);
  if (!isNew && !canEdit(ctx, product)) { ctx.go(`producto/${param}`); return undefined; }
  ctx.setTitle(isNew ? 'Agregar producto' : product.nombre, isNew ? 'Nuevo' : 'Editar producto');
  const comision = config.tasas.find((row) => row.clave === 'comision_proveedor')?.valor ?? 0;
  const proveedor = ctx.user.rol === 'proveedor';
  const state = { images: [...product.imagenes], specs: Object.entries(product.especificaciones || {}), modalidad: product.modalidad, dirty: false };
  if (!state.specs.length) state.specs.push(['', '']);
  const [statusLabel, statusText] = STATUS_TEXT[product.estado_publicacion];
  const publishLabel = proveedor && product.estado_publicacion !== 'ACTIVO' ? 'Enviar a revisión' : product.estado_publicacion === 'ACTIVO' ? 'Guardar y mantener publicado' : 'Publicar';
  root.innerHTML = `
    <a class="btn btn-ghost btn-sm" href="#/productos" style="justify-self:start">${icon('arrowLeft', 'icon icon-sm')}Productos</a>
    <div class="page-head"><div><h1>${isNew ? 'Agregar producto' : esc(product.nombre)}</h1>
      <p>${isNew ? 'Completa la información como la vería un comprador: fotos claras, precio transparente y ficha técnica.' : `Última actualización ${esc(relative(product.actualizado_en))}`}</p></div>
      ${!isNew ? `<a class="btn btn-secondary" href="#/producto/${product.id}">${icon('eye', 'icon icon-sm')}Ver en catálogo</a>` : ''}</div>
    <form class="editor" novalidate data-form>
      <div class="stack">
        <section class="card card-pad stack"><h3>Información</h3>
          ${field({ name: 'nombre', label: 'Título', value: product.nombre || '', required: true, attrs: 'maxlength="120" placeholder="Ej. Excavadora Komatsu PC210LC-11"' })}
          ${field({ name: 'descripcion', label: 'Descripción', type: 'textarea', value: product.descripcion || '', required: true,
            hint: 'Mínimo 20 caracteres. Cuenta estado, mantenimiento, accesorios incluidos y usos recomendados.', attrs: 'maxlength="4000" rows="6"' })}
        </section>
        <section class="card card-pad stack"><div class="row-between"><h3>Multimedia</h3><span class="small muted" data-media-count></span></div>
          <div class="media-grid" data-media></div>
          <label class="dropzone" data-drop>${icon('upload', 'icon icon-lg')}<strong style="color:var(--azul)">Arrastra fotos o haz clic para subir</strong>
            <span class="small">JPEG, PNG o WebP · hasta 6 fotos · se optimizan automáticamente</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden data-file></label>
          <p class="error" data-error-for="imagenes" hidden></p>
        </section>
        <section class="card card-pad stack"><h3>Precio y modalidad</h3>
          <div class="segmented" role="group" aria-label="Modalidad" style="justify-self:start">${['RENTA', 'VENTA', 'AMBAS'].map((m) =>
            `<button type="button" data-modalidad="${m}" aria-pressed="${state.modalidad === m}">${esc(MODALIDAD[m])}</button>`).join('')}</div>
          <div class="grid-2">
            <div data-rent>${field({ name: 'tarifa_diaria', label: 'Tarifa por día', type: 'number', value: product.tarifa_diaria ?? '', prefix: '$', attrs: 'min="1" step="0.01" inputmode="decimal"' })}</div>
            <div data-sale>${field({ name: 'precio_venta', label: 'Precio de venta', type: 'number', value: product.precio_venta ?? '', prefix: '$', attrs: 'min="100" step="0.01" inputmode="decimal"' })}</div>
          </div>
          ${proveedor ? `<p class="notice" data-net>${icon('info')}<span></span></p>` : ''}
        </section>
        <section class="card card-pad stack"><h3>Inventario y ubicación</h3>
          <div class="grid-2">
            ${field({ name: 'stock', label: 'Unidades disponibles', type: 'number', value: product.stock ?? 1, required: true, attrs: 'min="0" max="999" step="1"' })}
            ${field({ name: 'sku', label: 'SKU', value: product.sku || '', hint: 'Código interno opcional', attrs: 'maxlength="40" placeholder="MCA-EXC-210"' })}
            ${field({ name: 'ubicacion', label: 'Ciudad donde está el equipo', value: product.ubicacion || '', required: true, attrs: 'maxlength="100" list="ciudades-sv"' })}
            ${field({ name: 'horometro', label: 'Horómetro (horas)', type: 'number', value: product.horometro ?? '', attrs: 'min="0" step="1"' })}
          </div><datalist id="ciudades-sv">${CIUDADES.map((c) => `<option value="${c}">`).join('')}</datalist>
        </section>
        <section class="card card-pad stack"><div class="row-between"><h3>Ficha técnica</h3>
          <button class="btn btn-ghost btn-sm" type="button" data-add-spec>${icon('plus', 'icon icon-sm')}Agregar dato</button></div>
          <div class="stack-sm" data-specs></div><p class="error" data-error-for="especificaciones" hidden></p>
        </section>
      </div>
      <aside>
        <section class="card card-pad stack-sm"><div class="row-between"><h3>Estado</h3>${badge(product.estado_publicacion, statusLabel)}</div>
          <p class="small muted">${esc(statusText)}</p>
          ${product.motivo_rechazo ? `<div class="notice error">${icon('alert')}<p>${esc(product.motivo_rechazo)}</p></div>` : ''}</section>
        <section class="card card-pad stack"><h3>Organización</h3>
          ${field({ name: 'tipo', label: 'Tipo de maquinaria', value: product.tipo || '', required: true, options: [['', 'Selecciona un tipo'], ...config.tipos.map((t) => [t, t])] })}
          <div class="grid-2">${field({ name: 'marca', label: 'Marca', value: product.marca || '', required: true, attrs: 'maxlength="80" placeholder="Caterpillar"' })}
          ${field({ name: 'modelo', label: 'Modelo', value: product.modelo || '', required: true, attrs: 'maxlength="80" placeholder="336"' })}</div>
          <div class="grid-2">${field({ name: 'anio', label: 'Año', type: 'number', value: product.anio ?? '', attrs: `min="1950" max="${new Date().getFullYear() + 1}"` })}
          ${field({ name: 'condicion', label: 'Condición', value: product.condicion, options: Object.entries(CONDICION) })}</div>
          ${ctx.user.rol === 'admin' ? `<label class="check"><input type="checkbox" name="destacado" ${product.destacado ? 'checked' : ''}> Destacar en el catálogo</label>` : ''}
        </section>
        <section class="stack-sm"><span class="label">Vista previa en el catálogo</span><div data-preview style="pointer-events:none"></div></section>
      </aside>
      <div class="savebar" style="grid-column:1/-1">
        <span class="small" data-dirty>${isNew ? 'Producto nuevo sin guardar' : 'Sin cambios'}</span>
        <div class="row wrap">
          ${!isNew && product.estado_publicacion !== 'ARCHIVADO' ? `<button class="btn btn-secondary btn-sm" type="submit" value="archivar">${icon('archive', 'icon icon-sm')}Archivar</button>` : ''}
          <button class="btn btn-secondary btn-sm" type="submit" value="borrador">Guardar borrador</button>
          <button class="btn btn-amarillo btn-sm" type="submit" value="publicar">${icon('checkCircle', 'icon icon-sm')}${esc(publishLabel)}</button>
        </div>
      </div>
    </form>`;

  const form = root.querySelector('[data-form]');
  const markDirty = () => { state.dirty = true; root.querySelector('[data-dirty]').textContent = 'Tienes cambios sin guardar'; preview(); };
  function renderMedia() {
    root.querySelector('[data-media]').innerHTML = state.images.map((src, i) => `<div class="media-item">
      <img src="${esc(src)}" alt="Foto ${i + 1}">${i === 0 ? '<span class="badge cover b-pendiente">Portada</span>' : ''}
      <div class="media-actions">${i > 0 ? `<button type="button" data-cover="${i}" aria-label="Usar como portada">${icon('star', 'icon icon-sm')}</button>` : ''}
      <button type="button" data-remove-img="${i}" aria-label="Quitar foto">${icon('trash', 'icon icon-sm')}</button></div></div>`).join('');
    root.querySelector('[data-media-count]').textContent = `${state.images.length}/6 fotos`;
    root.querySelector('[data-drop]').hidden = state.images.length >= 6;
  }
  function renderSpecs() {
    root.querySelector('[data-specs]').innerHTML = state.specs.map(([k, v], i) => `<div class="spec-row">
      <input class="input" data-spec-key="${i}" value="${esc(k)}" maxlength="60" placeholder="Ej. Potencia" aria-label="Nombre del dato">
      <input class="input" data-spec-value="${i}" value="${esc(v)}" maxlength="120" placeholder="Ej. 165 hp" aria-label="Valor">
      <button class="icon-btn" type="button" data-remove-spec="${i}" aria-label="Quitar dato">${icon('x')}</button></div>`).join('');
  }
  function applyModalidad() {
    root.querySelectorAll('[data-modalidad]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modalidad === state.modalidad)));
    root.querySelector('[data-rent]').hidden = state.modalidad === 'VENTA';
    root.querySelector('[data-sale]').hidden = state.modalidad === 'RENTA';
  }
  function preview() {
    const data = Object.fromEntries(new FormData(form));
    root.querySelector('[data-preview]').innerHTML = productCard({
      id: product.id || 0, nombre: data.nombre || 'Título del producto', tipo: data.tipo, marca: data.marca, anio: data.anio,
      ubicacion: data.ubicacion, modalidad: state.modalidad, tarifa_diaria: Number(data.tarifa_diaria) || 0, precio_venta: Number(data.precio_venta) || 0,
      condicion: data.condicion, horometro: Number(data.horometro) || null, proveedor: proveedor ? (ctx.user.nombre) : (product.proveedor || 'Flota ICI'),
      imagenes: state.images, destacado: data.destacado === 'on',
    });
    const net = root.querySelector('[data-net] span');
    if (net) {
      const base = state.modalidad === 'VENTA' ? Number(data.precio_venta) : Number(data.tarifa_diaria);
      net.textContent = base ? `Por cada ${state.modalidad === 'VENTA' ? 'venta' : 'día de renta'} recibes ${money0(base * (1 - comision / 100))} después de la comisión de ${comision} %.`
        : `La plataforma retiene una comisión de ${comision} % sobre cada venta o renta.`;
    }
  }
  async function addFiles(files) {
    for (const file of [...files].slice(0, 6 - state.images.length)) {
      try { state.images.push(await compressImage(file)); markDirty(); }
      catch (error) { toast(error.message, 'error'); }
    }
    renderMedia();
  }
  renderMedia(); renderSpecs(); applyModalidad(); preview();

  form.addEventListener('input', (event) => {
    const key = event.target.dataset.specKey; const value = event.target.dataset.specValue;
    if (key !== undefined) state.specs[key][0] = event.target.value;
    if (value !== undefined) state.specs[value][1] = event.target.value;
    markDirty();
  });
  form.addEventListener('change', markDirty);
  form.addEventListener('click', (event) => {
    const mod = event.target.closest('[data-modalidad]');
    if (mod) { state.modalidad = mod.dataset.modalidad; applyModalidad(); markDirty(); }
    const remove = event.target.closest('[data-remove-img]');
    if (remove) { state.images.splice(Number(remove.dataset.removeImg), 1); renderMedia(); markDirty(); }
    const cover = event.target.closest('[data-cover]');
    if (cover) { const [img] = state.images.splice(Number(cover.dataset.cover), 1); state.images.unshift(img); renderMedia(); markDirty(); }
    if (event.target.closest('[data-add-spec]')) { if (state.specs.length < 20) state.specs.push(['', '']); renderSpecs(); }
    const removeSpec = event.target.closest('[data-remove-spec]');
    if (removeSpec) { state.specs.splice(Number(removeSpec.dataset.removeSpec), 1); if (!state.specs.length) state.specs.push(['', '']); renderSpecs(); markDirty(); }
  });
  const drop = root.querySelector('[data-drop]');
  drop.querySelector('[data-file]').addEventListener('change', (event) => { addFiles(event.target.files); event.target.value = ''; });
  drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (event) => { event.preventDefault(); drop.classList.remove('over'); addFiles(event.dataTransfer.files); });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const accion = event.submitter?.value || 'borrador';
    const data = Object.fromEntries(new FormData(form));
    const body = {
      nombre: data.nombre, descripcion: data.descripcion, tipo: data.tipo, marca: data.marca, modelo: data.modelo,
      anio: data.anio || null, condicion: data.condicion, modalidad: state.modalidad,
      tarifa_diaria: state.modalidad === 'VENTA' ? null : data.tarifa_diaria, precio_venta: state.modalidad === 'RENTA' ? null : data.precio_venta,
      stock: data.stock, sku: data.sku, ubicacion: data.ubicacion, horometro: data.horometro || null,
      especificaciones: Object.fromEntries(state.specs.filter(([k, v]) => k.trim() && v.trim())),
      imagenes: state.images, accion,
      ...(ctx.user.rol === 'admin' ? { destacado: data.destacado === 'on' } : {}),
    };
    const buttons = form.querySelectorAll('.savebar button');
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const saved = await api(isNew ? '/api/portal/productos/nuevo' : `/api/portal/productos/${product.id}`, { method: isNew ? 'POST' : 'PUT', body });
      state.dirty = false;
      toast(accion === 'publicar' ? (saved.estado_publicacion === 'PENDIENTE' ? 'Enviado a revisión. Te avisaremos cuando se publique.' : 'Producto publicado en el catálogo.')
        : accion === 'archivar' ? 'Producto archivado.' : 'Borrador guardado.', 'ok');
      if (isNew) ctx.go(`productos/${saved.id}`); else { location.hash = `#/productos/${saved.id}?v=${Date.now()}`; }
    } catch (error) {
      showFieldErrors(form, error.fields);
      if (error.fields?.imagenes) { const slot = form.querySelector('[data-error-for="imagenes"]'); slot.hidden = false; slot.textContent = error.fields.imagenes; }
      toast(Object.values(error.fields || {})[0] || error.message, 'error');
    } finally { buttons.forEach((b) => { b.disabled = false; }); }
  });
  const beforeUnload = (event) => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  return () => window.removeEventListener('beforeunload', beforeUnload);
}

// ------------------------------------------------------------------ moderación
export async function moderation(ctx) {
  const root = ctx.view;
  ctx.setTitle('Moderación de catálogo');
  async function render() {
    const products = await api('/api/portal/productos?estado=PENDIENTE');
    if (!ctx.isCurrent()) return;
    root.innerHTML = `
      <div class="page-head"><div><span class="eyebrow">Calidad del catálogo</span><h1 style="margin-top:6px">Productos por revisar</h1>
        <p>Verifica fotos reales, precios coherentes y ficha técnica completa antes de publicar el equipo de un proveedor.</p></div>
        <span class="badge b-pendiente">${products.length} pendiente${products.length === 1 ? '' : 's'}</span></div>
      ${products.length ? `<div class="stack">${products.map((p) => `<article class="card" style="overflow:hidden">
        <div class="split" style="gap:0">
          <div class="card-pad stack-sm">
            <div class="row wrap" style="gap:8px"><span class="badge b-neutral">${esc(p.tipo)}</span><span class="badge b-${p.modalidad === 'VENTA' ? 'venta' : 'renta'}">${esc(MODALIDAD[p.modalidad])}</span>
              <span class="small muted">Enviado ${esc(relative(p.actualizado_en))} por <strong>${esc(p.proveedor)}</strong></span></div>
            <h2>${esc(p.nombre)}</h2>
            <p class="muted" style="max-width:640px">${esc(p.descripcion)}</p>
            <div class="row wrap small" style="gap:18px;color:var(--ink-2)">
              ${p.tarifa_diaria ? `<span><strong>${money0(p.tarifa_diaria)}</strong>/día</span>` : ''}${p.precio_venta ? `<span><strong>${money0(p.precio_venta)}</strong> venta</span>` : ''}
              <span>${esc(p.marca)} ${esc(p.modelo)}${p.anio ? ` · ${p.anio}` : ''}</span><span>${esc(CONDICION[p.condicion] || '')}</span>
              <span>${number(p.stock)} unidad(es)</span><span>${esc(p.ubicacion || '')}</span></div>
            ${Object.keys(p.especificaciones).length ? `<div class="row wrap" style="gap:6px">${Object.entries(p.especificaciones).map(([k, v]) => `<span class="badge b-neutral">${esc(k)}: ${esc(v)}</span>`).join('')}</div>` : ''}
            <div class="row wrap" style="margin-top:8px">
              <button class="btn" type="button" data-approve="${p.id}">${icon('check', 'icon icon-sm')}Aprobar y publicar</button>
              <button class="btn btn-danger" type="button" data-reject="${p.id}">${icon('xCircle', 'icon icon-sm')}Solicitar cambios</button>
              <a class="btn btn-ghost" href="#/producto/${p.id}">${icon('eye', 'icon icon-sm')}Ver ficha</a></div>
          </div>
          <div style="min-height:240px;background:var(--section)">${p.imagenes[0] ? `<img src="${esc(p.imagenes[0])}" alt="" style="width:100%;height:100%;object-fit:cover">` : ''}</div>
        </div></article>`).join('')}</div>`
      : `<div class="card">${empty({ iconName: 'shield', title: 'Nada por revisar', text: 'Las nuevas publicaciones de proveedores aparecerán aquí.' })}</div>`}`;
  }
  root.addEventListener('click', async (event) => {
    const approve = event.target.closest('[data-approve]');
    const reject = event.target.closest('[data-reject]');
    if (!approve && !reject) return;
    let body = { accion: 'aprobar' };
    if (reject) {
      const motivo = await modal({ title: 'Solicitar cambios al proveedor', body: `<div class="field"><label for="m-motivo">¿Qué debe corregir?</label>
        <textarea class="textarea" id="m-motivo" maxlength="500" rows="4" placeholder="Ej. Sube fotos reales del equipo y agrega el horómetro."></textarea></div>`,
      actions: [{ label: 'Volver', value: null }, { label: 'Enviar comentario', className: 'btn-danger', onClick: (node) => {
        const value = node.querySelector('#m-motivo').value.trim();
        if (!value) { node.querySelector('#m-motivo').setAttribute('aria-invalid', 'true'); return false; }
        return value;
      } }] });
      if (!motivo) return;
      body = { accion: 'rechazar', motivo };
    }
    try {
      await api(`/api/portal/productos/${(approve || reject).dataset[approve ? 'approve' : 'reject']}/moderar`, { method: 'POST', body });
      toast(approve ? 'Producto publicado en el catálogo.' : 'Comentario enviado al proveedor.', 'ok');
      ctx.refreshCounters?.();
      await render();
    } catch (error) { toast(error.message, 'error'); }
  });
  await render();
  return undefined;
}
