# Pull request preparado: `victo` → `main`

Estado: texto preparado; PR sin abrir, sin push, merge ni despliegue.
Responsable: José Mario Sandoval. Sprint 3, HU2.

## Título

fix(hu2): completar accesos por rol y reforzar regresiones de permisos

## Descripción

Un residente que abría `#cobros-title` o un fragmento codificado dentro de Cobros
no recibía el aviso de sección restringida. La navegación ahora comprueba el
permiso del destino y de sus ancestros, interpreta fragmentos codificados y
redirige a una sección autorizada. Los fragmentos malformados no interrumpen la
sesión; los enlaces autorizados del gerente conservan su destino.

Se conserva la matriz central de `backend/permisos.mjs`, el login y las guardias
existentes: rol vigente desde sesión y base de datos, 401 sin sesión válida,
403 sin permiso, autorización por método y ruta antes de consultar o modificar
datos. El residente no inicializa Cobros ni registra pagos o programa entregas;
el gerente conserva esas funciones. Ambos consultan maquinaria, contratos,
documentos, PDF, firma, alertas, recepciones y entregas. Admin y demás roles del
portal conservan los permisos documentados en Sprint 4.

Se añaden diez regresiones: tres de backend y siete de interfaz. Cubren roles
falsos durante login y registro público, peticiones directas, cookies inválidas
o duplicadas, sesión revocada, ausencia de consultas/transacciones de negocio y
conservación de pagos, contratos y entregas tras el rechazo. README y el documento
de HU2 reflejan los permisos actuales, supuestos y pasos de prueba local.

## Validación

- `npm.cmd test`: el entorno impide crear procesos (`spawn EPERM`).
- Alternativa documentada, `node --test --test-isolation=none backend/*.test.mjs`:
  217 aprobadas, 0 fallidas, 0 omitidas (97 s).
- Backend HU2 focal: 14/14 aprobadas.
- Interfaz HU2 final: 23/23 aprobadas.
- Sintaxis de todos los `.js`/`.mjs` versionados y `git diff --check`: correctos.
- Bases de prueba PGlite temporales; sin cargar `.env`, acceder a producción ni
  ejecutar migraciones remotas. La interfaz se valida con módulos reales y DOM
  simulado; revisión visual, teclado y celular pendiente.

## Revisión funcional local

Preparar cuentas `residente` y `gerente` e iniciar sin `--env-file` contra PGlite,
como indica [SPRINT3_JOSE_MARIO.md](../SPRINT3_JOSE_MARIO.md).
Con residente, Cobros y programación de entregas no se muestran; abrir
`/#cobros-title` o `/#%63obros-list` avisa y vuelve al catálogo, sin solicitar
Cobros. Llamadas directas a cobros, pagos o programación devuelven 403, incluso
enviando `rol: gerente`. Con gerente, consultar Cobros, registrar un abono y
liquidar conserva el flujo existente. Sin sesión válida, la API devuelve 401.

## Dependencias y supuestos

Los módulos de aprobación de gastos y autorización de modificaciones de
contratos aún no existen. Se conservan sus permisos reservados para gerente
(heredados por admin); sus flujos no se implementan ni se declaran probados.
Registrar un pago es distinto de aprobar un gasto. Reservar cobros/pagos al
gerente y programar entregas a gerente/admin mantiene los supuestos documentados,
pendientes de aceptación del Product Owner.

## Base e integración

Tras `git fetch origin` no existían `victo` ni `origin/victo`. Se informó y creó
`victo` desde `origin/main` en `2f9b92ebe538c530336d9a9b6019c94cd9af8a00`, con
árbol inicial limpio; no se usó la rama distinta `victor`.

La HU2 original (`04d2f37`, PR #17), recepción de Mariela, entregas de Kevin,
portal de Iván y demás aportes anteriores ya están en `origin/main`. Se conservan
en la historia compartida; no son cambios nuevos de este PR. La comparación
incluye solamente sesión de interfaz, pruebas de permisos y documentación de
esta entrega. No hay cambios de esquema, dependencias ni configuración de
despliegue.
