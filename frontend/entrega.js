// HU9a: bloque "Entrega" dentro del detalle del contrato (#confirmation).
// app.js avisa qué contrato muestra con el evento 'contrato-mostrado'; este
// módulo consulta su programación y, con permiso, permite programarla o
// reprogramarla. Los datos del servidor se muestran solo con textContent.
import { sessionReady, hasPermission } from './sesion.js';

const HORA_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const TRANSPORTISTA_MIN = 2;
const TRANSPORTISTA_MAX = 160;
const fechaCorta = new Intl.DateTimeFormat('es-SV', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function fechaValida(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function hoyElSalvador(fecha = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/El_Salvador', year: 'numeric',
    month: '2-digit', day: '2-digit' }).formatToParts(fecha);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function formatearFecha(valor) {
  return fechaValida(valor) ? fechaCorta.format(new Date(`${valor}T00:00:00Z`)) : String(valor ?? '');
}

/** Ayuda al usuario antes de enviar; el backend vuelve a validar todo. */
export function validarBorradorEntrega(borrador, { hoy, fechaFin } = {}) {
  const fields = {};
  const fecha = typeof borrador?.fecha_entrega === 'string' ? borrador.fecha_entrega : '';
  if (!fechaValida(fecha)) fields.fecha_entrega = 'Indica la fecha de entrega.';
  else if (hoy && fecha < hoy) fields.fecha_entrega = 'La fecha de entrega no puede ser anterior a hoy.';
  else if (fechaFin && fecha > fechaFin) fields.fecha_entrega = `La entrega debe ser a más tardar el ${formatearFecha(fechaFin)}.`;
  const desde = typeof borrador?.hora_desde === 'string' ? borrador.hora_desde : '';
  const hasta = typeof borrador?.hora_hasta === 'string' ? borrador.hora_hasta : '';
  if (!desde) fields.hora_desde = 'Indica la hora de inicio de la ventana.';
  else if (!HORA_PATTERN.test(desde)) fields.hora_desde = 'Usa el formato HH:MM de 24 horas.';
  if (!hasta) fields.hora_hasta = 'Indica la hora final de la ventana.';
  else if (!HORA_PATTERN.test(hasta)) fields.hora_hasta = 'Usa el formato HH:MM de 24 horas.';
  if (!fields.hora_desde && !fields.hora_hasta && hasta <= desde) {
    fields.hora_hasta = 'La hora final debe ser posterior a la hora de inicio.';
  }
  const transportista = typeof borrador?.transportista === 'string' ? borrador.transportista.trim() : '';
  if (transportista.length < TRANSPORTISTA_MIN) fields.transportista = 'Indica el transportista (al menos 2 caracteres).';
  else if (transportista.length > TRANSPORTISTA_MAX) fields.transportista = `Máximo ${TRANSPORTISTA_MAX} caracteres.`;
  if (Object.keys(fields).length) return { fields };
  return { datos: { fecha_entrega: fecha, hora_desde: desde, hora_hasta: hasta, transportista } };
}

/** Texto del estado de programación a partir de la respuesta del servidor. */
export function textoEstadoEntrega(respuesta) {
  const entrega = respuesta?.estado === 'PROGRAMADA' ? respuesta.entrega : null;
  if (!entrega) return 'Sin programar';
  return `Programada: ${formatearFecha(entrega.fecha_entrega)}, ${entrega.hora_desde}–${entrega.hora_hasta}, ${entrega.transportista}`;
}

async function leerRespuesta(response) {
  const body = await response.json().catch(() => null);
  if (response.ok && body) return body;
  const error = new Error(body?.error?.message || 'No se pudo completar la solicitud. Inténtalo de nuevo.');
  error.status = response.status;
  error.fields = body?.error?.fields || {};
  throw error;
}

if (await sessionReady && hasPermission('entregas.consultar')) {
  const ui = {
    seccion: document.getElementById('entrega'),
    estado: document.getElementById('entrega-estado'),
    form: document.getElementById('entrega-form'),
    error: document.getElementById('entrega-error'),
    guardar: document.getElementById('entrega-guardar'),
    campos: {
      fecha_entrega: document.getElementById('entrega-fecha'),
      hora_desde: document.getElementById('entrega-desde'),
      hora_hasta: document.getElementById('entrega-hasta'),
      transportista: document.getElementById('entrega-transportista'),
    },
  };
  const puedeProgramar = hasPermission('entregas.programar');
  let contrato = null;
  let consulta = null;
  let enviando = false;

  function mostrarErrores(fields = {}, mensaje = '') {
    for (const [nombre, input] of Object.entries(ui.campos)) {
      const destino = document.getElementById(`${input.id}-error`);
      const texto = fields[nombre] || '';
      destino.textContent = texto;
      destino.hidden = !texto;
      if (texto) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
    ui.error.textContent = mensaje;
    ui.error.hidden = !mensaje;
  }

  function pintar(respuesta) {
    ui.estado.textContent = textoEstadoEntrega(respuesta);
    const entrega = respuesta?.estado === 'PROGRAMADA' ? respuesta.entrega : null;
    ui.guardar.textContent = entrega ? 'Reprogramar entrega' : 'Programar entrega';
    if (!puedeProgramar) return;
    ui.campos.fecha_entrega.value = entrega?.fecha_entrega || '';
    ui.campos.hora_desde.value = entrega?.hora_desde || '';
    ui.campos.hora_hasta.value = entrega?.hora_hasta || '';
    ui.campos.transportista.value = entrega?.transportista || '';
  }

  async function cargar(id) {
    consulta?.abort();
    const actual = new AbortController();
    consulta = actual;
    mostrarErrores();
    ui.estado.textContent = 'Consultando la programación de entrega…';
    try {
      const respuesta = await leerRespuesta(await fetch(`/api/contratos/${encodeURIComponent(id)}/entrega`,
        { signal: actual.signal, cache: 'no-store', headers: { Accept: 'application/json' } }));
      if (consulta === actual) pintar(respuesta);
    } catch (error) {
      if (actual.signal.aborted) return;
      ui.estado.textContent = error instanceof TypeError
        ? 'No se pudo consultar la entrega. Revisa tu conexión y vuelve a abrir el contrato.' : error.message;
    }
  }

  window.addEventListener('contrato-mostrado', (event) => {
    const id = event.detail?.id;
    if (typeof id !== 'string') return;
    contrato = { id, fechaFin: event.detail.fecha_fin };
    if (puedeProgramar) {
      ui.campos.fecha_entrega.min = hoyElSalvador();
      if (fechaValida(contrato.fechaFin)) ui.campos.fecha_entrega.max = contrato.fechaFin;
    }
    cargar(id);
  });

  if (puedeProgramar) {
    for (const input of Object.values(ui.campos)) {
      input.addEventListener('input', () => {
        input.removeAttribute('aria-invalid');
        const destino = document.getElementById(`${input.id}-error`);
        destino.textContent = '';
        destino.hidden = true;
      });
    }
    ui.form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!contrato || enviando) return;
      const borrador = Object.fromEntries(Object.entries(ui.campos).map(([nombre, input]) => [nombre, input.value]));
      const { datos, fields } = validarBorradorEntrega(borrador, { hoy: hoyElSalvador(), fechaFin: contrato.fechaFin });
      if (fields) {
        mostrarErrores(fields, 'Revisa los datos de la entrega. No se guardó nada.');
        ui.campos[Object.keys(fields)[0]].focus();
        return;
      }
      enviando = true;
      ui.guardar.disabled = true;
      ui.form.setAttribute('aria-busy', 'true');
      mostrarErrores();
      const id = contrato.id;
      try {
        const respuesta = await leerRespuesta(await fetch('/api/entregas', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ contrato_id: id, ...datos }),
        }));
        if (contrato?.id === id) pintar(respuesta);
      } catch (error) {
        // Los errores sin campo propio (contrato o restricción de la base) van al mensaje general.
        const mensaje = error instanceof TypeError
          ? 'No se recibió respuesta del servidor. Comprueba tu conexión e inténtalo de nuevo.'
          : [error.message, error.fields?.contrato_id, error.fields?.general].filter(Boolean).join(' ');
        mostrarErrores(error.fields, mensaje);
      } finally {
        enviando = false;
        ui.guardar.disabled = false;
        ui.form.setAttribute('aria-busy', 'false');
      }
    });
  }
}
