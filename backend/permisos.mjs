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
const POR_ROL = Object.freeze({
  residente: COMPARTIDOS,
  gerente: Object.freeze([...COMPARTIDOS,
    // Supuesto HU2: cobros y pagos quedan reservados al gerente.
    'cobros.consultar',
    'pagos.registrar',
    // HU9a: programar el flete corresponde al gerente de operaciones.
    'entregas.programar',
    // Permisos reservados: todavía no existen estos módulos ni sus rutas.
    'gastos.aprobar',
    'contratos.modificaciones.autorizar',
  ]),
});

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
].map(Object.freeze));

export function resolverRutaProtegida(metodo, path) {
  for (const ruta of RUTAS) {
    const match = ruta.patron.exec(path);
    if (!match) continue;
    if (metodo !== ruta.metodo) return { metodoNoPermitido: true };
    return { operacion: ruta.operacion, metodo: ruta.metodo, permiso: ruta.permiso, parametros: match.slice(1) };
  }
  return null;
}
