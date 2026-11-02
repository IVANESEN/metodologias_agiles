import { sessionReady, hasPermission } from './sesion.js';

export function estadoDespacho(notificacion) {
  if (!notificacion) return 'La programación vigente aún no tiene una orden de despacho enviada.';
  if (notificacion.estado === 'ENVIADO') return `Orden enviada. Confirmación del canal: ${notificacion.proveedor_id}. Intentos: ${notificacion.intentos}.`;
  return `Envío fallido. ${notificacion.ultimo_error || 'Consulta al gerente.'} Intentos: ${notificacion.intentos}.`;
}

if (await sessionReady && hasPermission('entregas.consultar')) {
  const status = document.getElementById('despacho-estado');
  const errorBox = document.getElementById('despacho-error');
  const send = document.getElementById('despacho-enviar');
  const refresh = document.getElementById('despacho-actualizar');
  let contractId = null;
  let current = null;
  let busy = false;
  let readVersion = 0;
  const canSend = hasPermission('entregas.programar');
  async function read(response) {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || 'No se pudo consultar el despacho.');
    return result;
  }
  async function load() {
    if (!contractId) return;
    const id = contractId;
    const version = ++readVersion;
    errorBox.hidden = true;
    try {
      const [history, schedule] = await Promise.all([
        fetch(`/api/contratos/${id}/despacho`, { cache: 'no-store' }).then(read),
        fetch(`/api/contratos/${id}/entrega`, { cache: 'no-store' }).then(read),
      ]);
      if (version !== readVersion || id !== contractId) return;
      current = history.notificaciones.find(n => n.id === history.vigente_id) || null;
      status.textContent = schedule.entrega ? estadoDespacho(current) : 'Primero programa la entrega.';
      send.textContent = current?.estado === 'FALLIDO' ? 'Reintentar orden de despacho' : 'Enviar orden de despacho';
      send.disabled = busy || !schedule.entrega || current?.estado === 'ENVIADO';
    } catch (error) {
      if (version !== readVersion) return;
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    }
  }
  window.addEventListener('contrato-mostrado', event => {
    contractId = event.detail.id;
    current = null;
    send.disabled = true;
    load();
  });
  window.addEventListener('entrega-actualizada', () => load());
  refresh.addEventListener('click', load);
  if (canSend) send.addEventListener('click', async () => {
    if (!contractId || busy) return;
    busy = true;
    send.disabled = true;
    const id = contractId;
    try {
      await read(await fetch(`/api/contratos/${id}/despacho`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reintentar: current?.estado === 'FALLIDO' }),
      }));
    } catch (error) { errorBox.textContent = error.message; errorBox.hidden = false; }
    finally { busy = false; if (id === contractId) await load(); }
  });
}
