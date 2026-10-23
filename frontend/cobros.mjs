const currency = new Intl.NumberFormat('es-SV', { style: 'currency', currency: 'USD' });
const dateDisplay = new Intl.DateTimeFormat('es-SV', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// Compara importes en centavos para no acumular errores de coma flotante.
export function paymentCents(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, decimals = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

function validBalance(contract) {
  if (!contract || typeof contract.id !== 'string' || !contract.id || typeof contract.cliente !== 'string') return false;
  const amounts = [contract.total, contract.total_pagado, contract.saldo_pendiente].map(paymentCents);
  if (amounts.some(value => value === null)) return false;
  const [total, paid, balance] = amounts;
  return paid + balance === total && (balance > 0 ? contract.estado_pago === 'PENDIENTE' : contract.estado_pago === 'PAGADO');
}

function pending(contract) {
  return contract.estado_pago === 'PENDIENTE' && paymentCents(contract.saldo_pendiente) > 0;
}

function paymentId() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createCobrosStore({ request, createId = paymentId, onChange = () => {} }) {
  let contracts = [], loading = false, payingId = null, loaded = false, error = '', notice = '', loadPromise = null, reloadAfterPayment = false;
  const drafts = new Map();
  const attempts = new Map();
  const draftFor = id => {
    if (!drafts.has(id)) drafts.set(id, { amount: '', error: '' });
    return drafts.get(id);
  };
  function getSnapshot() {
    return {
      contracts: contracts.map(contract => ({ ...contract })), loading, payingId, loaded, error, notice,
      drafts: Object.fromEntries([...drafts].map(([id, draft]) => [id, { ...draft }])),
    };
  }
  const emit = () => onChange(getSnapshot());
  function setAmount(id, amount) {
    if (payingId !== null) return;
    const draft = draftFor(id);
    if (draft.amount !== String(amount)) attempts.delete(id);
    draft.amount = String(amount);
    draft.error = '';
    emit();
  }
  async function load() {
    if (payingId !== null) { reloadAfterPayment = true; return false; }
    if (loadPromise) return loadPromise;
    loading = true;
    error = '';
    emit();
    loadPromise = Promise.resolve().then(async () => {
      try {
        const result = await request('/api/cobros', { cache: 'no-store', headers: { Accept: 'application/json' } });
        if (!Array.isArray(result) || !result.every(validBalance) || new Set(result.map(contract => contract.id)).size !== result.length) {
          throw new Error('No se pudo verificar el listado de cobros. Inténtalo de nuevo.');
        }
        contracts = result.filter(pending);
        loaded = true;
        for (const id of drafts.keys()) {
          if (!contracts.some(contract => contract.id === id)) { drafts.delete(id); attempts.delete(id); }
        }
        return true;
      } catch (failure) {
        error = failure instanceof TypeError ? 'No se pudo conectar para consultar los cobros. Comprueba tu conexión y pulsa Actualizar.' : failure.message;
        return false;
      } finally {
        loading = false;
        loadPromise = null;
        emit();
      }
    });
    return loadPromise;
  }
  async function pay(id, amount) {
    if (payingId !== null || loading) return false;
    if (amount !== undefined) setAmount(id, amount);
    const contract = contracts.find(item => item.id === id);
    if (!contract) return false;
    const draft = draftFor(id);
    const cents = paymentCents(draft.amount);
    if (cents === null || cents <= 0) {
      draft.error = 'Escribe un monto mayor que cero, con un máximo de 2 decimales.';
      emit();
      return false;
    }
    if (cents > paymentCents(contract.saldo_pendiente)) {
      draft.error = 'El pago no puede superar el saldo pendiente.';
      emit();
      return false;
    }
    payingId = id;
    draft.error = '';
    notice = '';
    emit();
    try {
      // El mismo intento conserva su UUID si no llega la confirmación del servidor.
      // Cambiar el monto comienza otro intento mediante setAmount().
      if (!attempts.has(id)) attempts.set(id, { id: createId(), monto: (cents / 100).toFixed(2) });
      const attempt = attempts.get(id);
      const result = await request(`/api/contratos/${encodeURIComponent(id)}/pagos`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(attempt),
      });
      const updated = result?.contrato;
      if (!validBalance(updated) || updated.id !== id || result?.pago?.id !== attempt.id || result.pago.contrato_id !== id || paymentCents(result.pago.monto) !== cents) {
        throw new Error('No se pudo verificar la confirmación del pago. Reintenta el mismo monto para consultar el resultado sin duplicarlo.');
      }
      contracts = contracts.map(item => item.id === id ? updated : item).filter(pending);
      drafts.delete(id);
      attempts.delete(id);
      notice = pending(updated)
        ? `Pago de ${currency.format(cents / 100)} registrado para ${updated.cliente}. Saldo pendiente: ${currency.format(Number(updated.saldo_pendiente))}.`
        : `Pago de ${currency.format(cents / 100)} registrado para ${updated.cliente}. El contrato está pagado y se retiró de los cobros pendientes.`;
      return true;
    } catch (failure) {
      const field = failure.fields?.monto;
      draft.error = field ? (Array.isArray(field) ? field.join(' ') : String(field))
        : failure instanceof TypeError
          ? 'No se recibió la confirmación del pago. El saldo visible se conserva. Reintenta el mismo monto para comprobarlo sin duplicar el pago.'
          : failure.message;
      return false;
    } finally {
      payingId = null;
      emit();
      if (reloadAfterPayment) { reloadAfterPayment = false; await load(); }
    }
  }
  return { load, pay, setAmount, getSnapshot };
}

export function createCobrosPanel(readResponse, options = {}) {
  const document = options.document || globalThis.document;
  const fetch = options.fetch || globalThis.fetch;
  const hasPermission = options.hasPermission || (() => false);
  const ui = Object.fromEntries(['list', 'status', 'count', 'refresh', 'error', 'notice'].map(name => [name, document.getElementById(`cobros-${name}`)]));
  const cards = new Map();
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function moneyRow(label, className = '') {
    const row = element('div', className);
    const value = element('dd');
    row.append(element('dt', '', label), value);
    return { row, value };
  }
  function createCard(contract) {
    const card = element('article', 'cobro-card');
    const heading = element('div', 'cobro-heading');
    const identity = element('div');
    const title = element('h3', '', contract.cliente);
    const contractId = element('p', 'cobro-contract-id');
    contractId.append(element('span', '', 'Contrato '), element('code', '', contract.id));
    identity.append(title, contractId);
    heading.append(identity, element('span', 'payment-status', 'Pago pendiente'));
    const period = element('p', 'cobro-period');
    const totals = element('dl', 'cobro-totals');
    const total = moneyRow('Total del contrato');
    const paid = moneyRow('Pagos registrados');
    const balance = moneyRow('Saldo pendiente', 'cobro-balance');
    totals.append(total.row, paid.row, balance.row);
    const form = element('form', 'cobro-form');
    form.hidden = !hasPermission('pagos.registrar');
    form.noValidate = true;
    form.setAttribute('aria-label', `Registrar pago del contrato ${contract.id}`);
    const field = element('div', 'field');
    const inputId = `pago-${contract.id}`;
    const label = element('label', '', 'Monto del pago (USD)');
    label.setAttribute('for', inputId);
    const input = element('input');
    input.id = inputId;
    input.name = 'monto';
    input.type = 'text';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.required = true;
    input.maxLength = 16;
    input.placeholder = '0.00';
    input.setAttribute('aria-describedby', `${inputId}-help ${inputId}-error`);
    const help = element('p', 'filter-help', 'Puedes registrar un pago parcial o liquidar el saldo. Usa punto para los decimales.');
    help.id = `${inputId}-help`;
    const error = element('p', 'field-error');
    error.id = `${inputId}-error`;
    error.setAttribute('role', 'alert');
    error.hidden = true;
    field.append(label, input, help, error);
    const submit = element('button', 'primary-button', 'Registrar pago');
    submit.type = 'submit';
    form.append(field, submit);
    card.append(heading, period, totals, form);
    input.addEventListener('input', () => store.setAmount(contract.id, input.value));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!hasPermission('pagos.registrar')) return;
      const result = await store.pay(contract.id);
      const snapshot = store.getSnapshot();
      if (!result && snapshot.drafts[contract.id]?.error) input.focus();
      else if (result && !snapshot.contracts.some(item => item.id === contract.id)) ui.notice.focus({ preventScroll: true });
    });
    return { card, title, period, total: total.value, paid: paid.value, balance: balance.value, form, input, error, submit };
  }
  function render(snapshot) {
    const { contracts, loading, payingId, loaded, error, notice, drafts } = snapshot;
    ui.list.setAttribute('aria-busy', String(loading || payingId !== null));
    ui.refresh.disabled = loading || payingId !== null;
    ui.refresh.textContent = loading ? 'Actualizando…' : 'Actualizar';
    ui.error.textContent = error;
    ui.error.hidden = !error;
    ui.notice.textContent = notice;
    ui.notice.hidden = !notice;
    ui.count.hidden = !loaded;
    ui.count.textContent = `${contracts.length} ${contracts.length === 1 ? 'contrato pendiente' : 'contratos pendientes'}`;
    ui.status.hidden = contracts.length > 0;
    ui.status.textContent = loading ? 'Cargando cobros pendientes…' : loaded
      ? 'No hay contratos con pagos pendientes. Todos los contratos están solventes.'
      : 'El listado de cobros no está disponible. Pulsa Actualizar para volver a intentarlo.';
    const visibleIds = new Set(contracts.map(contract => contract.id));
    for (const [id, nodes] of cards) {
      if (!visibleIds.has(id)) { nodes.card.remove(); cards.delete(id); }
    }
    for (const contract of contracts) {
      if (!cards.has(contract.id)) {
        const nodes = createCard(contract);
        cards.set(contract.id, nodes);
        ui.list.append(nodes.card);
      }
      const nodes = cards.get(contract.id);
      const draft = drafts[contract.id] || { amount: '', error: '' };
      nodes.title.textContent = contract.cliente;
      const start = new Date(`${contract.fecha_inicio}T00:00:00Z`);
      const end = new Date(`${contract.fecha_fin}T00:00:00Z`);
      nodes.period.textContent = Number.isFinite(start.getTime()) && Number.isFinite(end.getTime())
        ? `Alquiler: ${dateDisplay.format(start)} al ${dateDisplay.format(end)}` : 'Fechas del alquiler por consultar';
      nodes.total.textContent = currency.format(Number(contract.total));
      nodes.paid.textContent = currency.format(Number(contract.total_pagado));
      nodes.balance.textContent = currency.format(Number(contract.saldo_pendiente));
      if (nodes.input.value !== draft.amount) nodes.input.value = draft.amount;
      nodes.form.hidden = !hasPermission('pagos.registrar');
      nodes.input.disabled = !hasPermission('pagos.registrar') || loading || payingId !== null;
      nodes.input.setAttribute('aria-invalid', String(Boolean(draft.error)));
      nodes.error.textContent = draft.error;
      nodes.error.hidden = !draft.error;
      nodes.form.setAttribute('aria-busy', String(payingId === contract.id));
      nodes.submit.disabled = !hasPermission('pagos.registrar') || loading || payingId !== null;
      nodes.submit.textContent = payingId === contract.id ? 'Registrando pago…' : 'Registrar pago';
    }
  }
  const store = createCobrosStore({
    request: async (path, init) => {
      const permission = init?.method === 'POST' ? 'pagos.registrar' : 'cobros.consultar';
      if (!hasPermission(permission)) throw new Error('No tienes permiso para realizar esta acción.');
      return readResponse(await fetch(path, init));
    },
    createId: options.createId,
    onChange: render,
  });
  ui.refresh.addEventListener('click', () => { if (hasPermission('cobros.consultar')) store.load(); });
  render(store.getSnapshot());
  return {
    async load() {
      if (!hasPermission('cobros.consultar')) return false;
      const alreadyLoading = store.getSnapshot().loading;
      const result = await store.load();
      // Una creación puede terminar mientras la consulta inicial sigue en curso.
      return alreadyLoading ? store.load() : result;
    },
  };
}
