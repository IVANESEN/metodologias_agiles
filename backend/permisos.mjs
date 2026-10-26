// HU2: única matriz de permisos. La interfaz recibe estos permisos desde la sesión.
const COMPARTIDOS = Object.freeze([
  'maquinaria.consultar',
  'contratos.crear',
  'contratos.consultar',
  'contratos.documento',
  'contratos.pdf',
  'contratos.firmar',
  'alertas.consultar',
  'recepciones.crear',
  'recepciones.consultar',
  'entregas.consultar',
]);
// Portal multirrol. Los roles residente y gerente conservan su matriz original.
const PORTAL_BASE = Object.freeze(['portal.acceder', 'tienda.consultar', 'pedidos.consultar']);
const GERENTE = Object.freeze([...COMPARTIDOS,
  // Supuesto HU2: cobros y pagos quedan reservados al gerente.
  'cobros.consultar',
  'pagos.registrar',
  // HU9a: programar el flete corresponde al gerente de operaciones.
  'entregas.programar',
  // Permisos reservados: todavía no existen estos módulos ni sus rutas.
  'gastos.aprobar',
  'contratos.modificaciones.autorizar',
]);
const EMPLEADO = Object.freeze([...COMPARTIDOS, ...PORTAL_BASE,
  'pedidos.gestionar', 'productos.consultar', 'productos.moderar', 'usuarios.crear']);
const POR_ROL = Object.freeze({
  residente: COMPARTIDOS,
  gerente: GERENTE,
  cliente: Object.freeze([...PORTAL_BASE, 'pedidos.crear']),
  proveedor: Object.freeze([...PORTAL_BASE, 'productos.consultar', 'productos.gestionar']),
  empleado: EMPLEADO,
  admin: Object.freeze([...new Set([...GERENTE, ...EMPLEADO,
    'productos.gestionar', 'usuarios.administrar', 'configuracion.editar', 'auditoria.consultar', 'reportes.consultar'])]),
});

export const ROLES = Object.freeze(Object.keys(POR_ROL));
export const ROLES_PORTAL = Object.freeze(['admin', 'empleado', 'proveedor', 'cliente']);

export function permisosParaRol(rol) {
  return typeof rol === 'string' && Object.hasOwn(POR_ROL, rol) ? [...POR_ROL[rol]] : [];
}

export function tienePermiso(rol, permiso) {
  return typeof rol === 'string' && typeof permiso === 'string' && Object.hasOwn(POR_ROL, rol) && POR_ROL[rol].includes(permiso);
}

// Cada operación tiene método, ruta completa y permiso explícitos. No hay
// autorizaciones por prefijo que puedan habilitar nuevas acciones de contratos.
const RUTAS = Object.freeze([
  { operacion: 'maquinaria.consultar', metodo: 'GET', patron: /^\/api\/maquinaria$/, permiso: 'maquinaria.consultar' },
  { operacion: 'reservas.consultar', metodo: 'GET', patron: /^\/api\/reservas\/ocupadas$/, permiso: 'maquinaria.consultar' },
  { operacion: 'contratos.crear', metodo: 'POST', patron: /^\/api\/contratos$/, permiso: 'contratos.crear' },
  { operacion: 'alertas.consultar', metodo: 'GET', patron: /^\/api\/contratos\/por-vencer$/, permiso: 'alertas.consultar' },
  { operacion: 'cobros.consultar', metodo: 'GET', patron: /^\/api\/cobros$/, permiso: 'cobros.consultar' },
  { operacion: 'pagos.registrar', metodo: 'POST', patron: /^\/api\/contratos\/([^/]+)\/pagos$/, permiso: 'pagos.registrar' },
  { operacion: 'contratos.firmar', metodo: 'POST', patron: /^\/api\/contratos\/([^/]+)\/firma$/, permiso: 'contratos.firmar' },
  { operacion: 'contratos.documento', metodo: 'GET', patron: /^\/api\/contratos\/([^/]+)\/documento$/, permiso: 'contratos.documento' },
  { operacion: 'contratos.pdf', metodo: 'GET', patron: /^\/api\/contratos\/([^/]+)\/pdf$/, permiso: 'contratos.pdf' },
  { operacion: 'recepciones.crear', metodo: 'POST', patron: /^\/api\/recepciones$/, permiso: 'recepciones.crear' },
  { operacion: 'recepciones.consultar', metodo: 'GET', patron: /^\/api\/contratos\/([^/]+)\/recepciones$/, permiso: 'recepciones.consultar' },
  { operacion: 'entregas.programar', metodo: 'POST', patron: /^\/api\/entregas$/, permiso: 'entregas.programar' },
  { operacion: 'entregas.consultar', metodo: 'GET', patron: /^\/api\/contratos\/([^/]+)\/entrega$/, permiso: 'entregas.consultar' },
  { operacion: 'contratos.consultar', metodo: 'GET', patron: /^\/api\/contratos\/([^/]+)$/, permiso: 'contratos.consultar' },
  // Portal multirrol: el alcance por rol (propios, proveedor, todos) se aplica en backend/portal.mjs.
  { operacion: 'portal.resumen', metodo: 'GET', patron: /^\/api\/portal\/resumen$/, permiso: 'portal.acceder' },
  { operacion: 'portal.configuracion.consultar', metodo: 'GET', patron: /^\/api\/portal\/configuracion$/, permiso: 'portal.acceder' },
  { operacion: 'portal.configuracion.editar', metodo: 'PUT', patron: /^\/api\/portal\/configuracion\/editar$/, permiso: 'configuracion.editar' },
  { operacion: 'portal.perfil.editar', metodo: 'PUT', patron: /^\/api\/portal\/perfil$/, permiso: 'portal.acceder' },
  { operacion: 'portal.perfil.clave', metodo: 'POST', patron: /^\/api\/portal\/perfil\/clave$/, permiso: 'portal.acceder' },
  { operacion: 'portal.catalogo.listar', metodo: 'GET', patron: /^\/api\/portal\/catalogo$/, permiso: 'tienda.consultar' },
  { operacion: 'portal.catalogo.detalle', metodo: 'GET', patron: /^\/api\/portal\/catalogo\/(\d{1,10})$/, permiso: 'tienda.consultar' },
  { operacion: 'portal.imagen', metodo: 'GET', patron: /^\/api\/portal\/imagenes\/(\d{1,10})\/(\d)$/, permiso: 'tienda.consultar' },
  { operacion: 'portal.cotizar', metodo: 'POST', patron: /^\/api\/portal\/cotizar$/, permiso: 'tienda.consultar' },
  { operacion: 'portal.pedidos.listar', metodo: 'GET', patron: /^\/api\/portal\/pedidos$/, permiso: 'pedidos.consultar' },
  { operacion: 'portal.pedidos.crear', metodo: 'POST', patron: /^\/api\/portal\/pedidos\/nuevo$/, permiso: 'pedidos.crear' },
  { operacion: 'portal.pedidos.detalle', metodo: 'GET', patron: /^\/api\/portal\/pedidos\/([0-9a-f-]{36})$/, permiso: 'pedidos.consultar' },
  { operacion: 'portal.pedidos.cancelar', metodo: 'POST', patron: /^\/api\/portal\/pedidos\/([0-9a-f-]{36})\/cancelar$/, permiso: 'pedidos.crear' },
  { operacion: 'portal.pedidos.estado', metodo: 'POST', patron: /^\/api\/portal\/pedidos\/([0-9a-f-]{36})\/estado$/, permiso: 'pedidos.gestionar' },
  { operacion: 'portal.productos.listar', metodo: 'GET', patron: /^\/api\/portal\/productos$/, permiso: 'productos.consultar' },
  { operacion: 'portal.productos.crear', metodo: 'POST', patron: /^\/api\/portal\/productos\/nuevo$/, permiso: 'productos.gestionar' },
  { operacion: 'portal.productos.detalle', metodo: 'GET', patron: /^\/api\/portal\/productos\/(\d{1,10})$/, permiso: 'productos.consultar' },
  { operacion: 'portal.productos.editar', metodo: 'PUT', patron: /^\/api\/portal\/productos\/(\d{1,10})$/, permiso: 'productos.gestionar' },
  { operacion: 'portal.productos.moderar', metodo: 'POST', patron: /^\/api\/portal\/productos\/(\d{1,10})\/moderar$/, permiso: 'productos.moderar' },
  { operacion: 'portal.usuarios.listar', metodo: 'GET', patron: /^\/api\/portal\/usuarios$/, permiso: 'usuarios.crear' },
  { operacion: 'portal.usuarios.crear', metodo: 'POST', patron: /^\/api\/portal\/usuarios\/nuevo$/, permiso: 'usuarios.crear' },
  { operacion: 'portal.usuarios.editar', metodo: 'PUT', patron: /^\/api\/portal\/usuarios\/([0-9a-f-]{36})$/, permiso: 'usuarios.crear' },
  { operacion: 'portal.usuarios.clave', metodo: 'POST', patron: /^\/api\/portal\/usuarios\/([0-9a-f-]{36})\/clave$/, permiso: 'usuarios.crear' },
  { operacion: 'portal.auditoria', metodo: 'GET', patron: /^\/api\/portal\/auditoria$/, permiso: 'auditoria.consultar' },
  { operacion: 'portal.reportes', metodo: 'GET', patron: /^\/api\/portal\/reportes$/, permiso: 'reportes.consultar' },
].map(Object.freeze));

export function resolverRutaProtegida(metodo, path) {
  // Una misma ruta puede registrar varios métodos (GET detalle, PUT edición).
  let rutaConOtroMetodo = false;
  for (const ruta of RUTAS) {
    const match = ruta.patron.exec(path);
    if (!match) continue;
    if (metodo !== ruta.metodo) { rutaConOtroMetodo = true; continue; }
    return { operacion: ruta.operacion, metodo: ruta.metodo, permiso: ruta.permiso, parametros: match.slice(1) };
  }
  return rutaConOtroMetodo ? { metodoNoPermitido: true } : null;
}
