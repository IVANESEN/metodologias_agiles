import { sessionReady, hasPermission, requirePermission } from './sesion.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 1_000_000;
const MAX_SOURCE_BYTES = 12_000_000;

function validationError(message, fields = {}) {
  const error = new Error(message);
  error.status = 400;
  error.fields = fields;
  return error;
}

export function validateReceptionDraft(draft) {
  const fields = {};
  const contractId = typeof draft?.contrato_id === 'string' ? draft.contrato_id.trim().toLowerCase() : '';
  if (!UUID_PATTERN.test(contractId)) fields.contrato_id = 'Pega un número de contrato válido.';
  const machineryValue = draft?.maquinaria_id;
  const machineryId = Number(machineryValue);
  if (!((typeof machineryValue === 'number' && Number.isInteger(machineryValue)) ||
      (typeof machineryValue === 'string' && /^\d+$/.test(machineryValue))) ||
      machineryId < 1 || machineryId > 2_147_483_647) {
    fields.maquinaria_id = 'Selecciona una maquinaria incluida en el contrato.';
  }
  const hoursValue = draft?.horometro;
  const hours = Number(hoursValue);
  if (!((typeof hoursValue === 'number' && Number.isInteger(hoursValue)) ||
      (typeof hoursValue === 'string' && /^\d+$/.test(hoursValue))) ||
      hours < 0 || hours > 2_147_483_647) {
    fields.horometro = 'Ingresa una lectura entera del horómetro igual o mayor que cero.';
  }
  const photos = Array.isArray(draft?.fotos) ? draft.fotos : [];
  if (photos.length < 1 || photos.length > MAX_PHOTOS ||
      photos.some((photo) => typeof photo !== 'string' || !/^data:image\/(?:jpeg|png|webp);base64,/.test(photo))) {
    fields.fotos = 'Adjunta entre 1 y 5 fotografías JPEG, PNG o WebP válidas.';
  }
  if (Object.keys(fields).length) throw validationError('Revisa los datos de la recepción.', fields);
  return { contrato_id: contractId, maquinaria_id: machineryId, horometro: hours, fotos: [...photos] };
}

export function createReceptionStore({ request, createId = () => crypto.randomUUID() } = {}) {
  if (typeof request !== 'function') throw new TypeError('Se requiere una función para consultar la API.');
  const state = { contract: null, receptions: [], pending: null };
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const snapshot = () => ({ contract: state.contract ? copy(state.contract) : null,
    receptions: copy(state.receptions) });

  async function load(contractId) {
    const id = typeof contractId === 'string' ? contractId.trim().toLowerCase() : '';
    if (!UUID_PATTERN.test(id)) throw validationError('Pega un número de contrato válido.',
      { contrato_id: 'El identificador debe ser un UUID completo.' });
    state.contract = null;
    state.receptions = [];
    state.pending = null;
    const contract = await request(`/api/contratos/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!contract || contract.id !== id || !Array.isArray(contract.maquinarias)) {
      throw new Error('La respuesta del contrato no pudo verificarse.');
    }
    const result = await request(`/api/contratos/${encodeURIComponent(id)}/recepciones`, { cache: 'no-store' });
    if (!result || !Array.isArray(result.recepciones)) throw new Error('La respuesta de recepciones no pudo verificarse.');
    state.contract = contract;
    state.receptions = result.recepciones;
    state.pending = null;
    return snapshot();
  }

  async function reload() {
    if (!state.contract) throw validationError('Busca un contrato primero.', { contrato_id: 'Busca un contrato primero.' });
    const result = await request(`/api/contratos/${encodeURIComponent(state.contract.id)}/recepciones`, { cache: 'no-store' });
    if (!result || !Array.isArray(result.recepciones)) throw new Error('La respuesta de recepciones no pudo verificarse.');
    state.receptions = result.recepciones;
    return snapshot();
  }

  async function save(draft) {
    const input = validateReceptionDraft(draft);
    if (!state.contract || state.contract.id !== input.contrato_id ||
        !state.contract.maquinarias.some((machine) => Number(machine.maquinaria_id) === input.maquinaria_id)) {
      throw validationError('La maquinaria no pertenece al contrato cargado.',
        { maquinaria_id: 'Busca el contrato y selecciona una de sus máquinas.' });
    }
    const fingerprint = JSON.stringify(input);
    if (!state.pending || state.pending.fingerprint !== fingerprint) {
      state.pending = { fingerprint, id: createId() };
    }
    const reception = await request('/api/recepciones', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ id: state.pending.id, ...input }),
    });
    if (!reception || reception.id !== state.pending.id || reception.contrato_id !== input.contrato_id ||
        Number(reception.maquinaria_id) !== input.maquinaria_id) {
      throw new Error('La confirmación de la recepción no pudo verificarse.');
    }
    state.pending = null;
    state.receptions = [reception, ...state.receptions.filter((item) => item.id !== reception.id &&
      Number(item.maquinaria_id) !== input.maquinaria_id)];
    return reception;
  }

  return { load, reload, save, getSnapshot: snapshot };
}

async function apiJson(path, options = {}) {
  const response = await fetch(path, options);
  let body;
  try { body = await response.json(); }
  catch { throw new Error('El servidor devolvió una respuesta que no se pudo leer.'); }
  if (!response.ok) {
    const error = new Error(body?.error?.message || 'No se pudo completar la solicitud.');
    error.status = response.status;
    error.code = body?.error?.code;
    error.fields = body?.error?.fields || {};
    throw error;
  }
  return body;
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer una de las fotografías.'));
    reader.readAsDataURL(blob);
  });
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

async function optimizePhoto(file) {
  if (!ALLOWED_PHOTO_TYPES.has(file.type)) throw new Error(`${file.name}: usa únicamente JPEG, PNG o WebP.`);
  if (!Number.isFinite(file.size) || file.size < 1 || file.size > MAX_SOURCE_BYTES) {
    throw new Error(`${file.name}: la fotografía debe ocupar entre 1 byte y 12 MB.`);
  }
  if (file.size <= MAX_PHOTO_BYTES) return readAsDataUrl(file);
  if (typeof createImageBitmap !== 'function') {
    throw new Error(`${file.name}: este navegador no puede optimizarla; selecciona una foto menor de 1 MB.`);
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, 1600 / longest);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error(`${file.name}: no se pudo preparar la fotografía.`);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let quality = 0.82;
    for (let attempt = 0; attempt < 6; attempt++) {
      const blob = await canvasBlob(canvas, quality);
      if (!blob) throw new Error(`${file.name}: no se pudo optimizar la fotografía.`);
      if (blob.size <= MAX_PHOTO_BYTES) return readAsDataUrl(blob);
      if (quality > 0.5) quality -= 0.1;
      else {
        const copy = document.createElement('canvas');
        copy.width = Math.max(1, Math.round(canvas.width * 0.8));
        copy.height = Math.max(1, Math.round(canvas.height * 0.8));
        copy.getContext('2d', { alpha: false }).drawImage(canvas, 0, 0, copy.width, copy.height);
        canvas.width = copy.width;
        canvas.height = copy.height;
        canvas.getContext('2d', { alpha: false }).drawImage(copy, 0, 0);
        quality = 0.72;
      }
    }
    throw new Error(`${file.name}: no fue posible reducirla a 1 MB. Selecciona otra fotografía.`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${file.name}:`)) throw error;
    throw new Error(`${file.name}: el archivo no contiene una imagen válida.`);
  } finally {
    bitmap?.close?.();
  }
}

if (await sessionReady && hasPermission('recepciones.consultar')) {
  const ui = {
    form: document.getElementById('recepcion-form'), contract: document.getElementById('recepcion-contrato'),
    search: document.getElementById('recepcion-buscar'), contractStatus: document.getElementById('recepcion-contract-status'),
    fields: document.getElementById('recepcion-fields'), machinery: document.getElementById('recepcion-maquinaria'),
    hours: document.getElementById('recepcion-horometro'), files: document.getElementById('recepcion-fotos'),
    previews: document.getElementById('recepcion-previews'), submit: document.getElementById('recepcion-guardar'),
    message: document.getElementById('recepcion-mensaje'), refresh: document.getElementById('recepcion-actualizar'),
    status: document.getElementById('recepcion-status'), list: document.getElementById('recepcion-lista'),
  };
  const store = createReceptionStore({ request: apiJson });
  const state = { photos: [], loading: false, saving: false, processing: false };
  const canCreate = hasPermission('recepciones.crear');

  function fieldError(name, message = '') {
    const field = name === 'contrato_id' ? ui.contract : name === 'maquinaria_id' ? ui.machinery
      : name === 'horometro' ? ui.hours : ui.files;
    const target = document.getElementById(`recepcion-${name === 'contrato_id' ? 'contrato' :
      name === 'maquinaria_id' ? 'maquinaria' : name}-error`);
    if (message) field?.setAttribute('aria-invalid', 'true');
    else field?.removeAttribute('aria-invalid');
    if (target) { target.textContent = message; target.hidden = !message; }
  }

  function clearErrors() {
    for (const name of ['contrato_id', 'maquinaria_id', 'horometro', 'fotos']) fieldError(name);
    ui.message.hidden = true;
    ui.message.textContent = '';
    ui.message.className = 'recepcion-message';
  }

  function showError(error) {
    for (const [name, message] of Object.entries(error.fields || {})) fieldError(name, message);
    ui.message.textContent = error instanceof TypeError
      ? 'No se recibió respuesta del servidor. Comprueba tu conexión antes de reintentar.'
      : error.message || 'No se pudo completar la operación.';
    ui.message.className = 'recepcion-message is-error';
    ui.message.hidden = false;
    ui.message.focus({ preventScroll: true });
  }

  function updateSubmit() {
    const snapshot = store.getSnapshot();
    const ready = canCreate && snapshot.contract && ui.machinery.value && /^\d+$/.test(ui.hours.value) &&
      Number(ui.hours.value) <= 2_147_483_647 && state.photos.length >= 1 && state.photos.length <= MAX_PHOTOS;
    ui.submit.disabled = !ready || state.loading || state.saving || state.processing;
  }

  function renderPreviews() {
    ui.previews.replaceChildren();
    state.photos.forEach((photo, index) => {
      const card = document.createElement('figure');
      const image = document.createElement('img');
      image.src = photo;
      image.alt = `Vista previa de evidencia ${index + 1}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-equipment';
      remove.textContent = 'Quitar';
      remove.setAttribute('aria-label', `Quitar fotografía ${index + 1}`);
      remove.disabled = state.saving;
      remove.addEventListener('click', () => {
        state.photos.splice(index, 1);
        ui.files.value = '';
        fieldError('fotos');
        renderPreviews();
        updateSubmit();
      });
      card.append(image, remove);
      ui.previews.append(card);
    });
  }

  function renderReceptions() {
    const { receptions } = store.getSnapshot();
    ui.list.replaceChildren();
    ui.status.hidden = receptions.length > 0;
    ui.status.textContent = receptions.length ? '' : 'Este contrato todavía no tiene recepciones registradas.';
    for (const reception of receptions) {
      const article = document.createElement('article');
      article.className = 'recepcion-card';
      const title = document.createElement('h4');
      title.textContent = reception.maquinaria_nombre || `Maquinaria ${reception.maquinaria_id}`;
      const details = document.createElement('p');
      const timestamp = new Date(reception.fecha_recepcion);
      const displayed = Number.isFinite(timestamp.getTime())
        ? new Intl.DateTimeFormat('es-SV', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
        : reception.fecha_recepcion;
      details.textContent = `Horómetro: ${reception.horometro} horas · ${displayed}`;
      const gallery = document.createElement('div');
      gallery.className = 'recepcion-gallery';
      reception.fotos.forEach((photo, index) => {
        const image = document.createElement('img');
        image.src = photo;
        image.alt = `Evidencia ${index + 1} de ${title.textContent}`;
        image.loading = 'lazy';
        gallery.append(image);
      });
      article.append(title, details, gallery);
      ui.list.append(article);
    }
  }

  function renderContract() {
    const { contract, receptions } = store.getSnapshot();
    const received = new Set(receptions.map((item) => Number(item.maquinaria_id)));
    ui.machinery.replaceChildren();
    const prompt = document.createElement('option');
    prompt.value = '';
    prompt.textContent = contract ? 'Selecciona una maquinaria' : 'Busca un contrato primero';
    ui.machinery.append(prompt);
    if (contract) {
      for (const machine of contract.maquinarias) {
        const option = document.createElement('option');
        option.value = String(machine.maquinaria_id);
        option.disabled = received.has(Number(machine.maquinaria_id));
        option.textContent = `${machine.maquinaria_nombre}${option.disabled ? ' · recepción registrada' : ''}`;
        ui.machinery.append(option);
      }
      ui.contractStatus.textContent = `${contract.cliente} · ${contract.maquinarias.length} ${contract.maquinarias.length === 1 ? 'máquina' : 'máquinas'}`;
      ui.fields.disabled = !canCreate;
      ui.refresh.disabled = false;
    } else {
      ui.contractStatus.textContent = '';
      ui.fields.disabled = true;
      ui.refresh.disabled = true;
    }
    renderReceptions();
    updateSubmit();
  }

  async function loadContract() {
    if (!requirePermission('recepciones.consultar') || state.loading) return;
    clearErrors();
    state.loading = true;
    ui.search.disabled = true;
    ui.refresh.disabled = true;
    ui.fields.disabled = true;
    ui.list.replaceChildren();
    ui.contractStatus.textContent = 'Buscando contrato…';
    ui.status.hidden = false;
    ui.status.textContent = 'Cargando evidencias…';
    try {
      await store.load(ui.contract.value);
      ui.contract.value = store.getSnapshot().contract.id;
      renderContract();
    } catch (error) {
      ui.contractStatus.textContent = '';
      ui.status.textContent = 'No se cargaron evidencias.';
      showError(error);
    } finally {
      state.loading = false;
      ui.search.disabled = false;
      if (store.getSnapshot().contract) ui.fields.disabled = !canCreate;
      updateSubmit();
    }
  }

  ui.search.addEventListener('click', loadContract);
  ui.contract.addEventListener('input', () => {
    fieldError('contrato_id');
    const loaded = store.getSnapshot().contract;
    if (loaded && ui.contract.value.trim().toLowerCase() !== loaded.id) ui.fields.disabled = true;
    updateSubmit();
  });
  ui.contract.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); loadContract(); }
  });
  ui.machinery.addEventListener('change', () => { fieldError('maquinaria_id'); updateSubmit(); });
  ui.hours.addEventListener('input', () => { fieldError('horometro'); updateSubmit(); });
  ui.files.addEventListener('change', async () => {
    clearErrors();
    const files = [...ui.files.files];
    if (files.length < 1 || files.length > MAX_PHOTOS) {
      state.photos = [];
      fieldError('fotos', 'Selecciona entre 1 y 5 fotografías.');
      renderPreviews();
      return updateSubmit();
    }
    state.processing = true;
    ui.files.disabled = true;
    ui.message.textContent = 'Preparando fotografías…';
    ui.message.className = 'recepcion-message';
    ui.message.hidden = false;
    updateSubmit();
    try {
      state.photos = [];
      for (const file of files) state.photos.push(await optimizePhoto(file));
      ui.message.hidden = true;
      renderPreviews();
    } catch (error) {
      state.photos = [];
      renderPreviews();
      fieldError('fotos', error.message);
    } finally {
      state.processing = false;
      ui.files.disabled = false;
      updateSubmit();
    }
  });
  ui.refresh.addEventListener('click', async () => {
    if (!requirePermission('recepciones.consultar') || state.loading) return;
    state.loading = true;
    ui.refresh.disabled = true;
    ui.status.hidden = false;
    ui.status.textContent = 'Actualizando evidencias…';
    try { await store.reload(); renderContract(); }
    catch (error) { showError(error); }
    finally { state.loading = false; ui.refresh.disabled = false; updateSubmit(); }
  });
  ui.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!requirePermission('recepciones.crear') || state.saving) return;
    clearErrors();
    state.saving = true;
    ui.fields.disabled = true;
    ui.submit.textContent = 'Guardando recepción…';
    ui.form.setAttribute('aria-busy', 'true');
    try {
      const contract = store.getSnapshot().contract;
      const reception = await store.save({ contrato_id: contract?.id, maquinaria_id: ui.machinery.value,
        horometro: ui.hours.value, fotos: state.photos });
      state.photos = [];
      ui.files.value = '';
      ui.hours.value = '';
      renderPreviews();
      renderContract();
      ui.message.textContent = `Recepción de ${reception.maquinaria_nombre || 'la maquinaria'} guardada correctamente.`;
      ui.message.className = 'recepcion-message is-success';
      ui.message.hidden = false;
      ui.message.focus({ preventScroll: true });
    } catch (error) {
      showError(error);
    } finally {
      state.saving = false;
      ui.form.setAttribute('aria-busy', 'false');
      ui.submit.textContent = 'Guardar recepción';
      if (store.getSnapshot().contract) ui.fields.disabled = false;
      updateSubmit();
    }
  });
}
