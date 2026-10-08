'use strict';

const ui = {
  grid: document.getElementById('equipment-grid'),
  status: document.getElementById('catalogue-status'),
  count: document.getElementById('catalogue-count'),
  form: document.getElementById('booking-form'),
  fields: document.getElementById('booking-fields'),
  cliente: document.getElementById('cliente'),
  inicio: document.getElementById('fecha_inicio'),
  fin: document.getElementById('fecha_fin'),
  selection: document.getElementById('selected-equipment'),
  selectedName: document.getElementById('selected-name'),
  rate: document.getElementById('daily-rate'),
  days: document.getElementById('rental-days'),
  total: document.getElementById('estimated-total'),
  error: document.getElementById('form-error'),
  submit: document.getElementById('submit-contract'),
  note: document.getElementById('form-note'),
  confirmation: document.getElementById('confirmation'),
  details: document.getElementById('confirmation-details'),
  contractId: document.getElementById('contract-id'),
  newContract: document.getElementById('new-contract'),
};
const state = { equipment: [], selected: null, loading: false, submitting: false };
const money = new Intl.NumberFormat('es-SV', { style: 'currency', currency: 'USD' });
const dateDisplay = new Intl.DateTimeFormat('es-SV', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const DAY_MS = 86400000;
const equipmentIcon = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 25h24M8 25V13h11v12M10 13V7h8v6M19 15h6l3 10M10 18h5M5 25v-4h3"/><path d="M7 28h17"/></svg>';

function element(tag, className, content) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (content !== undefined) result.textContent = content;
  return result;
}

function todayInElSalvador() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/El_Salvador', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function dateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) return null;
  return timestamp;
}

function inclusiveDays() {
  const start = dateValue(ui.inicio.value);
  const end = dateValue(ui.fin.value);
  if (start === null || end === null || end < start) return null;
  return Math.round((end - start) / DAY_MS) + 1;
}

function resetDates() {
  const today = todayInElSalvador();
  ui.inicio.min = today;
  ui.inicio.value = today;
  ui.fin.min = today;
  ui.fin.value = today;
}

function clearErrors() {
  ui.error.hidden = true;
  ui.error.textContent = '';
  for (const field of [ui.cliente, ui.inicio, ui.fin]) {
    field.removeAttribute('aria-invalid');
    const message = document.getElementById(`${field.name}-error`);
    message.textContent = '';
    message.hidden = true;
  }
}

function fieldError(field, message) {
  field.setAttribute('aria-invalid', 'true');
  const target = document.getElementById(`${field.name}-error`);
  target.textContent = message;
  target.hidden = false;
}

function formError(message) {
  ui.error.textContent = message;
  ui.error.hidden = false;
}

function updateEstimate() {
  ui.selectedName.textContent = state.selected ? state.selected.nombre : 'Selecciona una máquina del catálogo';
  ui.selection.classList.toggle('has-selection', Boolean(state.selected));
  const days = inclusiveDays();
  ui.rate.textContent = state.selected ? money.format(state.selected.tarifa_diaria) : '—';
  ui.days.textContent = days ? `${days} ${days === 1 ? 'día' : 'días'}` : '—';
  ui.total.textContent = state.selected && days ? money.format(state.selected.tarifa_diaria * days) : '—';
  ui.submit.disabled = !state.selected || state.loading || state.submitting;
  ui.note.textContent = state.selected ? 'El total final se confirma al generar el contrato.' : 'Primero elige una máquina disponible.';
}

function selectEquipment(item) {
  if (!item.disponible || state.submitting) return;
  state.selected = item;
  clearErrors();
  if (!ui.confirmation.hidden) {
    ui.confirmation.hidden = true;
    ui.form.hidden = false;
  }
  renderEquipment();
  updateEstimate();
  document.getElementById(`select-equipment-${item.id}`)?.focus({ preventScroll: true });
}

function renderEquipment() {
  ui.grid.replaceChildren();
  for (const item of state.equipment) {
    const selected = state.selected?.id === item.id;
    const card = element('article', `equipment-card${selected ? ' is-selected' : ''}${item.disponible ? '' : ' is-unavailable'}`);
    const top = element('div', 'equipment-top');
    const icon = element('span', 'equipment-icon');
    icon.innerHTML = equipmentIcon;
    top.append(icon, element('span', 'availability', item.disponible ? 'Disponible' : 'No disponible'));
    card.append(top, element('p', 'equipment-type', item.tipo), element('h3', '', item.nombre), element('p', 'equipment-description', item.descripcion));
    const bottom = element('div', 'equipment-bottom');
    const price = element('div', 'equipment-price');
    price.append(element('strong', '', money.format(item.tarifa_diaria)), element('span', '', '/ día'));
    const button = element('button', 'select-button', item.disponible ? selected ? 'Seleccionado ✓' : 'Seleccionar' : 'No disponible');
    button.type = 'button';
    button.id = `select-equipment-${item.id}`;
    button.disabled = !item.disponible || state.submitting;
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-label', `${selected ? 'Equipo seleccionado:' : 'Seleccionar'} ${item.nombre}`);
    button.addEventListener('click', () => selectEquipment(item));
    bottom.append(price, button);
    card.append(bottom);
    ui.grid.append(card);
  }
}

function validEquipment(item) {
  return item && Number.isInteger(item.id) && typeof item.nombre === 'string' && typeof item.tipo === 'string' && typeof item.descripcion === 'string' && Number.isFinite(item.tarifa_diaria) && item.tarifa_diaria >= 0 && typeof item.disponible === 'boolean';
}

async function readResponse(response) {
  let body;
  try { body = await response.json(); } catch {
    throw new Error('No se pudo leer la respuesta del servidor. Inténtalo de nuevo.');
  }
  if (!response.ok) {
    const failure = new Error(body?.error?.message || 'No se pudo completar la solicitud. Inténtalo de nuevo.');
    failure.code = body?.error?.code;
    failure.fields = body?.error?.fields;
    throw failure;
  }
  return body;
}

async function loadEquipment() {
  if (state.loading) return;
  state.loading = true;
  state.selected = null;
  state.equipment = [];
  ui.grid.replaceChildren();
  ui.grid.setAttribute('aria-busy', 'true');
  ui.count.hidden = true;
  ui.status.hidden = false;
  const spinner = element('span', 'spinner');
  spinner.setAttribute('aria-hidden', 'true');
  ui.status.replaceChildren(spinner, element('p', '', 'Cargando maquinaria…'));
  updateEstimate();
  try {
    const response = await fetch('/api/maquinaria', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    const equipment = await readResponse(response);
    if (!Array.isArray(equipment) || !equipment.every(validEquipment)) throw new Error('El catálogo recibido no tiene el formato esperado. Inténtalo de nuevo.');
    state.equipment = equipment;
    const available = equipment.filter(item => item.disponible).length;
    ui.count.textContent = `${available} ${available === 1 ? 'disponible' : 'disponibles'}`;
    ui.count.hidden = false;
    if (equipment.length === 0) {
      ui.status.replaceChildren(element('strong', '', 'El catálogo está vacío'), element('p', '', 'Todavía no hay maquinaria registrada. Vuelve a consultar más tarde.'));
    } else {
      ui.status.hidden = true;
      renderEquipment();
    }
  } catch (error) {
    const retry = element('button', 'retry-button', 'Volver a cargar');
    retry.type = 'button';
    retry.addEventListener('click', loadEquipment);
    const message = error instanceof TypeError ? 'No pudimos conectar con el catálogo. Comprueba tu conexión y vuelve a intentarlo.' : error.message;
    ui.status.replaceChildren(element('strong', '', 'El catálogo no está disponible'), element('p', '', message), retry);
  } finally {
    state.loading = false;
    ui.grid.setAttribute('aria-busy', 'false');
    updateEstimate();
  }
}

function validateForm() {
  clearErrors();
  let firstInvalid = null;
  const fail = (field, message) => { fieldError(field, message); firstInvalid ||= field; };
  if (!state.selected || !state.selected.disponible) {
    formError('Selecciona una máquina disponible del catálogo.');
    return false;
  }
  const client = ui.cliente.value.trim();
  if (client.length < 2) fail(ui.cliente, 'Escribe un nombre de al menos 2 caracteres.');
  if (client.length > 160) fail(ui.cliente, 'Usa un máximo de 160 caracteres.');
  const start = dateValue(ui.inicio.value);
  const end = dateValue(ui.fin.value);
  if (start === null) fail(ui.inicio, 'Selecciona una fecha de inicio válida.');
  else if (ui.inicio.value < todayInElSalvador()) fail(ui.inicio, 'La fecha de inicio debe ser hoy o posterior.');
  if (end === null) fail(ui.fin, 'Selecciona una fecha de fin válida.');
  else if (start !== null && end < start) fail(ui.fin, 'La fecha de fin debe ser igual o posterior al inicio.');
  if (firstInvalid) { firstInvalid.focus(); return false; }
  return true;
}

function confirmationRow(label, value, className = '') {
  const row = element('div', className);
  row.append(element('dt', '', label), element('dd', '', value));
  return row;
}

function showConfirmation(contract) {
  const start = dateValue(contract.fecha_inicio);
  const end = dateValue(contract.fecha_fin);
  ui.details.replaceChildren(
    confirmationRow('Equipo', contract.maquinaria_nombre),
    confirmationRow('Cliente', contract.cliente),
    confirmationRow('Inicio', dateDisplay.format(new Date(start))),
    confirmationRow('Fin', dateDisplay.format(new Date(end))),
    confirmationRow('Duración', `${contract.dias} ${contract.dias === 1 ? 'día' : 'días'}`),
    confirmationRow('Tarifa diaria', money.format(contract.tarifa_diaria)),
    confirmationRow('Total', money.format(contract.total), 'confirmed-total'),
  );
  ui.contractId.textContent = contract.id;
  ui.form.hidden = true;
  ui.confirmation.hidden = false;
  ui.confirmation.focus({ preventScroll: true });
  if (window.matchMedia('(max-width: 780px)').matches) ui.confirmation.scrollIntoView({ behavior: 'auto', block: 'start' });
}

function applyServerErrors(error) {
  if (!error.fields || typeof error.fields !== 'object') return;
  const fieldMap = { cliente: ui.cliente, fecha_inicio: ui.inicio, fecha_fin: ui.fin };
  let firstInvalid = null;
  for (const [name, value] of Object.entries(error.fields)) {
    const field = fieldMap[name];
    const message = Array.isArray(value) ? value.join(' ') : typeof value === 'string' ? value : '';
    if (field && message) { fieldError(field, message); firstInvalid ||= field; }
  }
  if (firstInvalid) firstInvalid.focus();
}

ui.form.addEventListener('submit', async event => {
  event.preventDefault();
  if (state.submitting || !validateForm()) return;
  const payload = { maquinaria_id: state.selected.id, cliente: ui.cliente.value.trim(), fecha_inicio: ui.inicio.value, fecha_fin: ui.fin.value };
  state.submitting = true;
  ui.fields.disabled = true;
  ui.submit.textContent = 'Generando contrato…';
  ui.form.setAttribute('aria-busy', 'true');
  renderEquipment();
  updateEstimate();
  try {
    const response = await fetch('/api/contratos', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) });
    const contract = await readResponse(response);
    if (response.status !== 201 || !contract || typeof contract.id !== 'string' || !contract.id || contract.estado !== 'CONFIRMADO' || dateValue(contract.fecha_inicio) === null || dateValue(contract.fecha_fin) === null || typeof contract.cliente !== 'string' || typeof contract.maquinaria_nombre !== 'string' || !Number.isInteger(contract.dias) || contract.dias < 1 || !Number.isFinite(contract.tarifa_diaria) || contract.tarifa_diaria < 0 || !Number.isFinite(contract.total) || contract.total < 0) {
      throw new Error('La respuesta del contrato no pudo verificarse. Revisa el servidor antes de volver a enviarlo.');
    }
    showConfirmation(contract);
  } catch (error) {
    const message = error instanceof TypeError ? 'No se recibió la confirmación del servidor. Comprueba tu conexión antes de volver a enviar la solicitud.' : error.message;
    formError(message);
    ui.fields.disabled = false;
    applyServerErrors(error);
  } finally {
    state.submitting = false;
    ui.fields.disabled = false;
    ui.form.setAttribute('aria-busy', 'false');
    ui.submit.replaceChildren(document.createTextNode('Generar contrato '), element('span', '', '→'));
    ui.submit.lastElementChild.setAttribute('aria-hidden', 'true');
    renderEquipment();
    updateEstimate();
  }
});

ui.inicio.addEventListener('input', () => {
  const today = todayInElSalvador();
  ui.fin.min = ui.inicio.value && ui.inicio.value >= today ? ui.inicio.value : today;
  clearErrors();
  updateEstimate();
});
ui.fin.addEventListener('input', () => { clearErrors(); updateEstimate(); });
ui.cliente.addEventListener('input', () => {
  ui.cliente.removeAttribute('aria-invalid');
  document.getElementById('cliente-error').hidden = true;
  ui.error.hidden = true;
});
ui.newContract.addEventListener('click', () => {
  ui.form.reset();
  resetDates();
  clearErrors();
  ui.confirmation.hidden = true;
  ui.form.hidden = false;
  updateEstimate();
  ui.cliente.focus();
});

resetDates();
updateEstimate();
loadEquipment();
