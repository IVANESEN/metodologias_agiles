import { FIRMA_ANCHO, FIRMA_ALTO, MAX_PUNTOS, MAX_TRAZOS, normalizeSignature } from './firma-datos.mjs';

export function createSignaturePanel(readResponse, onBusyChange) {
  const form = document.getElementById('signature-form');
  const canvas = document.getElementById('signature-canvas');
  const context = canvas.getContext('2d');
  const save = document.getElementById('save-signature');
  const clear = document.getElementById('clear-signature');
  const actions = document.getElementById('signature-actions');
  const error = document.getElementById('signature-error');
  const status = document.getElementById('signature-status');
  const help = document.getElementById('signature-help');
  let contractId, trazos = [], current = null, pointer = null, busy = false, signed = false;

  function message(text = '') {
    error.textContent = text;
    error.hidden = !text;
    canvas.setAttribute('aria-invalid', String(Boolean(text)));
  }
  function signature() { return normalizeSignature({ ancho: FIRMA_ANCHO, alto: FIRMA_ALTO, trazos }); }
  function draw() {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#17202a';
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const trazo of [...trazos, ...(current ? [current] : [])]) {
      context.beginPath();
      context.moveTo(...trazo[0]);
      for (const punto of trazo.slice(1)) context.lineTo(...punto);
      context.stroke();
    }
    let valid = false;
    try { signature(); valid = true; } catch { /* Lienzo vacío o trazo incompleto. */ }
    save.disabled = busy || signed || pointer !== null || !valid;
    clear.disabled = busy || signed || pointer !== null;
    canvas.setAttribute('aria-disabled', String(busy || signed));
  }
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return [
      Math.round(Math.max(0, Math.min(FIRMA_ANCHO, (event.clientX - rect.left) * FIRMA_ANCHO / rect.width)) * 10) / 10,
      Math.round(Math.max(0, Math.min(FIRMA_ALTO, (event.clientY - rect.top) * FIRMA_ALTO / rect.height)) * 10) / 10,
    ];
  }
  canvas.addEventListener('pointerdown', event => {
    if (busy || signed || pointer !== null || !event.isPrimary || event.button !== 0) return;
    if (trazos.length >= MAX_TRAZOS || trazos.reduce((sum, trazo) => sum + trazo.length, 0) >= MAX_PUNTOS - 1) {
      message('El lienzo alcanzó su límite. Guarda la firma o pulsa Limpiar para repetirla.'); return;
    }
    event.preventDefault();
    pointer = event.pointerId;
    canvas.setPointerCapture(pointer);
    current = [point(event)];
    message();
    draw();
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer || !current) return;
    event.preventDefault();
    const next = point(event);
    const previous = current.at(-1);
    const count = trazos.reduce((sum, trazo) => sum + trazo.length, 0) + current.length;
    if (count < MAX_PUNTOS && Math.hypot(next[0] - previous[0], next[1] - previous[1]) >= 1) current.push(next);
    draw();
  });
  function finish(event) {
    if (event.pointerId !== pointer) return;
    if (event.type === 'pointerup' && current.length < MAX_PUNTOS - trazos.reduce((sum, trazo) => sum + trazo.length, 0)) {
      current.push(point(event));
    }
    if (current?.length >= 2) trazos.push(current);
    current = null;
    pointer = null;
    draw();
  }
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, finish);
  clear.addEventListener('click', () => {
    if (busy || signed) return;
    trazos = [];
    message();
    draw();
    canvas.focus();
  });

  function show(contract) {
    contractId = contract.id;
    signed = Boolean(contract.firma);
    trazos = signed ? contract.firma.trazos : [];
    current = null;
    pointer = null;
    actions.hidden = signed;
    canvas.setAttribute('aria-label', signed ? 'Firma guardada del cliente' : 'Dibuja tu firma con el dedo, lápiz o ratón');
    status.textContent = signed
      ? `Firma guardada el ${new Intl.DateTimeFormat('es-SV', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/El_Salvador' }).format(new Date(contract.firmado_en))} (El Salvador).`
      : 'Pendiente de firma. Revisa las cláusulas y dibuja tu firma.';
    help.textContent = signed
      ? 'Esta firma está vinculada al contrato y se incluye en su PDF. La firma guardada no se puede reemplazar.'
      : 'Firma dentro del recuadro con el dedo, lápiz o ratón. La firma guardada quedará vinculada a este contrato y se incluirá en el PDF.';
    message();
    draw();
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || signed || !contractId || pointer !== null) return;
    let firma;
    try { firma = signature(); } catch (failure) { message(failure.message); canvas.focus(); return; }
    busy = true;
    onBusyChange(true);
    form.setAttribute('aria-busy', 'true');
    save.textContent = 'Guardando firma…';
    message();
    draw();
    try {
      const response = await fetch(`/api/contratos/${encodeURIComponent(contractId)}/firma`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ firma }),
      });
      const result = await readResponse(response);
      if (result.contrato_id !== contractId || !result.firma || !result.firmado_en) throw new Error('No se pudo verificar la firma guardada. Reabre el contrato para comprobarla.');
      show({ id: contractId, ...result });
    } catch (failure) {
      if (failure.code === 'CONTRACT_ALREADY_SIGNED') {
        try {
          const contract = await readResponse(await fetch(`/api/contratos/${encodeURIComponent(contractId)}`, { cache: 'no-store' }));
          show(contract);
          message('Este contrato se firmó desde otra sesión. Se muestra la firma guardada.');
        } catch { message('El contrato ya tiene una firma. Reabre el enlace para verla.'); }
      } else message(failure instanceof TypeError ? 'No se pudo conectar. Tu dibujo se conserva; puedes volver a guardar la misma firma.' : failure.message);
    } finally {
      busy = false;
      onBusyChange(false);
      form.setAttribute('aria-busy', 'false');
      save.textContent = 'Guardar firma';
      draw();
    }
  });
  return { show };
}
