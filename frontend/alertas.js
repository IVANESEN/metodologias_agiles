// Sección Alertas (HU4a): contratos que vencen en los próximos N días.
// La lista se vuelve a pedir al cargar la página, al cambiar N, al volver a la
// pestaña y cada 60 s mientras la pestaña está visible. Una petición nueva
// cancela la anterior para que una respuesta lenta no pise a una más reciente.
// El DOM se arma con createElement y textContent, nunca con innerHTML.
import { sessionReady, hasPermission } from './sesion.js';

if (await sessionReady && hasPermission('alertas.consultar')) {
const DIAS_POR_DEFECTO = 7;
const DIAS_MAXIMO = 365;
const REFRESCO_MS = 60_000;
const ESPERA_MS = 400;
const fecha = new Intl.DateTimeFormat('es-SV', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const campo = document.getElementById('alertas-dias');
const campoError = document.getElementById('alertas-dias-error');
const lista = document.getElementById('alertas-lista');
let peticion = null;
let espera = null;
let ultimaRespuesta = '';
let permisoRechazado = false;

function element(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function formatoFecha(valor) {
  return fecha.format(new Date(`${valor}T00:00:00Z`));
}

function periodo(dias) {
  return dias === 1 ? 'el próximo día' : `los próximos ${dias} días`;
}

function textoPlazo(dias) {
  if (dias === 0) return 'Vence hoy';
  if (dias === 1) return 'Vence mañana';
  return `Vence en ${dias} días`;
}

// Normaliza con parseInt ("07" pasa a 7) y solo acepta enteros de 1 a 365.
function leerDias() {
  const texto = campo.value.trim();
  if (!/^\d+$/.test(texto)) return null;
  const dias = Number.parseInt(texto, 10);
  return dias >= 1 && dias <= DIAS_MAXIMO ? dias : null;
}

function mostrarErrorCampo(mensaje) {
  campoError.textContent = mensaje;
  campoError.hidden = !mensaje;
  campo.setAttribute('aria-invalid', String(Boolean(mensaje)));
}

function mostrarEstado(...hijos) {
  const estado = element('div', 'catalogue-status');
  estado.append(...hijos);
  lista.replaceChildren(estado);
}

function mostrarCargando() {
  ultimaRespuesta = '';
  mostrarEstado(element('span', 'spinner'), element('p', '', 'Cargando contratos por vencer…'));
}

function mostrarFallo(mensaje = 'Revisa tu conexión e inténtalo de nuevo.') {
  ultimaRespuesta = '';
  const reintentar = element('button', 'retry-button', 'Reintentar');
  reintentar.type = 'button';
  reintentar.addEventListener('click', () => { permisoRechazado = false; cargar(); });
  mostrarEstado(element('strong', '', 'No se pudieron cargar las alertas'),
    element('p', '', mensaje), reintentar);
}

function itemContrato(contrato) {
  const item = element('li', 'alerta-item');
  const cabecera = element('div', 'alerta-cabecera');
  const plazo = element('span', contrato.dias_restantes === 0 ? 'alerta-plazo es-hoy' : 'alerta-plazo',
    textoPlazo(contrato.dias_restantes));
  cabecera.append(element('strong', 'alerta-cliente', contrato.cliente), plazo);
  const maquinas = contrato.maquinarias.map((m) => m.maquinaria_nombre).join(', ') || 'Sin maquinaria registrada';
  item.append(
    cabecera,
    element('p', '', `Maquinaria: ${maquinas}`),
    element('p', '', `Vigencia: del ${formatoFecha(contrato.fecha_inicio)} al ${formatoFecha(contrato.fecha_fin)}`),
    element('p', '', `Obra en ${contrato.ciudad || 'ciudad no registrada'}`),
  );
  return item;
}

function mostrarLista(contratos, dias) {
  if (!contratos.length) {
    mostrarEstado(element('p', '', `No hay contratos que venzan en ${periodo(dias)}.`));
    return;
  }
  const resumen = element('p', 'alertas-resumen',
    `${contratos.length} ${contratos.length === 1 ? 'contrato vence' : 'contratos vencen'} en ${periodo(dias)}.`);
  const items = element('ul', 'alertas-items');
  items.append(...contratos.map(itemContrato));
  lista.replaceChildren(resumen, items);
}

// silencioso: refresco de fondo; no muestra "Cargando" y no vuelve a dibujar
// (ni a anunciar en aria-live) si la respuesta no cambió.
async function cargar({ silencioso = false } = {}) {
  if (!hasPermission('alertas.consultar') || permisoRechazado) return;
  const dias = leerDias();
  if (dias === null) {
    peticion?.abort();
    mostrarErrorCampo(`Escribe un número entero de días entre 1 y ${DIAS_MAXIMO}.`);
    return;
  }
  mostrarErrorCampo('');
  peticion?.abort();
  const actual = new AbortController();
  peticion = actual;
  if (!silencioso) mostrarCargando();
  lista.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch(`/api/contratos/por-vencer?dias=${dias}`, {
      signal: actual.signal, cache: 'no-store', headers: { Accept: 'application/json' },
    });
    const body = await response.json().catch(() => null);
    if (response.status === 403) {
      permisoRechazado = true;
      throw new Error(body?.error?.message || 'No tienes permiso para consultar las alertas.');
    }
    if (!response.ok || !body || !Array.isArray(body.contratos)) throw new Error('respuesta inválida');
    const texto = JSON.stringify(body);
    if (silencioso && texto === ultimaRespuesta) return;
    ultimaRespuesta = texto;
    mostrarLista(body.contratos, body.dias);
  } catch (error) {
    if (!actual.signal.aborted) mostrarFallo(permisoRechazado ? error.message : undefined);
  } finally {
    if (peticion === actual) lista.setAttribute('aria-busy', 'false');
  }
}

campo.value = String(DIAS_POR_DEFECTO);
campo.addEventListener('input', () => {
  clearTimeout(espera);
  espera = setTimeout(() => cargar(), ESPERA_MS);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') cargar({ silencioso: true });
});
setInterval(() => {
  if (document.visibilityState === 'visible') cargar({ silencioso: true });
}, REFRESCO_MS);
cargar();
}
