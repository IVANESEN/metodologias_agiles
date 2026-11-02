# Reajustes del sistema y evidencia de verificación

El 1 de noviembre de 2026 se implementaron los ajustes del documento proporcionado
sobre la rama `victo`, cuya base era `b8a580d`. La rama comenzó sin cambios
pendientes. Esta entrega se registra en un commit de `victo` para revisión; no se
hizo merge, despliegue ni modificación del tablero o de la base remota. El usuario
confirmó que todavía no ha aplicado la migración y solicitó publicar la rama en Git.

**Implementado** describe código y documentación disponibles. **Verificado**
describe una comprobación actual con su entorno y resultado. **Aceptado** requiere
evidencia del equipo y del Product Owner: no se atribuye esa aceptación a ninguna
de estas modificaciones. La falta de evidencia histórica figura como
**No verificable**, sin reemplazarla por pruebas automatizadas actuales.

## Diagnóstico y ajustes

La disponibilidad de pedidos omitía `COMPLETADO`, mientras el alta de contratos
solo comprobaba `disponible`. Las fotografías se aceptaban por cabeceras; faltaba
un flujo de corrección histórica y una integración de despacho. El PDF sustituía
caracteres, la plantilla de configuración había sido eliminada y la preparación
de roles podía confirmarse antes de que fallara el resto del esquema.

| Ajuste | Historia relacionada | Implementación y evidencia actual | Pendiente o límite |
| --- | --- | --- | --- |
| H02 | HU8, HU3, HU6a | `COMPLETADO` conserva ocupación; `FINALIZADO` y `DEVUELTO` registran hitos distintos. Catálogos, calendario, cotización, pedidos y contratos comparten intervalos cerrados. `alquiler-reglas.test.mjs` verifica transiciones, extremos y tres combinaciones de solicitudes simultáneas. | Simultaneidad comprobada en PGlite; repetir con conexiones PostgreSQL independientes. |
| H03 | HU6a, HU8 | Elegibilidad de publicación `ACTIVO`, modalidad `RENTA/AMBAS` y habilitación se comprueba tras `FOR UPDATE`, en la transacción que registra el contrato. Rechazos API y ausencia de registros parciales probados. | Preparar esquema y validar entorno compartido. |
| H01 | HU10 | Decodificación completa `sharp` de JPEG/PNG/WebP, integridad del contenedor, 1 MB por evidencia, 8192 por lado y 20 millones de píxeles; corrección autorizada con versión, motivo, actor e historial. `imagenes.test.mjs`, `recepciones.test.mjs`, `despacho-evidencias.test.mjs`. | El equipo debe identificar evidencia histórica dañada y autorizar cada corrección; no se modificaron fotos existentes. |
| H09 | HU9b, HU9a | Orden desde programación/contrato/equipos reales, consulta de fallos e intentos, reintento explícito, deduplicación y revisión de programación. Interfaz de despacho en detalle del contrato. `despacho-evidencias.test.mjs` y `despacho-frontend.test.mjs`. | Integración verificada solo con adaptador simulado. Canal, destino y proveedor operativo pendientes. |
| H11 | HU6b, HU6a | Eliminada sustitución silenciosa. Validación explícita Windows-1252 antes de guardar contrato y de copiar nombres del equipo. Nombres DB/API/PDF con tildes, ñ, Zoë, Šimek, Œuvre y € comprobados. Históricos incompatibles responden 409 sin alterar datos. | Otros alfabetos y emoji se rechazan claramente; el equipo puede acordar una fuente Unicode en otra ampliación. |
| H04 | Transversal | `.env.example` sin secretos restaurada, README y comandos reales; instalación y arranque en copia limpia comprobados. | Ensayar instalación del entorno compartido con su configuración privada. |
| H05 | Transversal | Ampliación atómica de esquema/roles/estados, RLS y comprobación final; migración revisable, reapertura, fallo inyectado y reintento conservando datos probados. | `db:verify` detectó esquema remoto pendiente. Backup/restore operativo y ensayo PostgreSQL real pendientes. |
| H06 | HU3, HU8, HU6a | `alquiler-reglas.mjs` centraliza elegibilidad, ocupación e intervalos y se reutiliza desde `app.mjs` y `portal.mjs`; se conservan bloqueos y transacciones. | Revisión del equipo; no se emprendió una reestructuración general. |
| H07 | Transversal | Retirado `backend/server.js` vacío y sin referencias. Scripts y documentación usan `backend/server.mjs`; arranque real en copia limpia comprobado. | Ninguna dependencia técnica identificada. |
| H10 | HU5 | Correspondencia DB/API/ficha, horómetro cero, campos ausentes y foto fallida probados. Cronología de integración del 22 oct contrastada con Git. | Actualidad de fotografías y aceptación histórica No verificable. |
| H08 | HU9a | Fecha, ventana, transportista y consulta cubiertos por pruebas; integración del 26 oct contrastada con Git y conectada al despacho actual. | Aceptación histórica y funcionamiento compartido No verificable. |
| Cierre | Las 14 historias | Matriz de criterios, versiones, autores y fechas comprobables en `TRAZABILIDAD_REAJUSTES.md`; conserva estados y propone ajustes del tablero sin editarlo. | PO, prueba por otra persona, revisión humana independiente y ambiente compartido: No verificable. Reajustes actuales aún sin integrar en `main`. |

## Archivos modificados

- Reglas de renta: `backend/alquiler-reglas.mjs`, `backend/app.mjs`,
  `backend/portal.mjs`; estados y acciones en `frontend/assets/js/ui.js`,
  `views/pedidos.js` y `views/inicio.js`.
- Evidencia y PDF: `backend/imagenes.mjs`, `recepcion-correcciones.mjs`,
  `contrato-pdf.mjs`, `permisos.mjs`, `frontend/ficha-tecnica.mjs` y `app.js`.
- Despacho: `backend/despacho.mjs`, `frontend/despacho.js`, `entrega.js` e
  `index.html`; rutas y servicios integrados en `app.mjs`.
- Persistencia e instalación: `database/schema.sql`,
  `database/migrations/20261101_reajustes.sql`, `backend/database.mjs`,
  `postgres-preparation.mjs`, `preparar-portal.mjs`, `.env.example`, `README.md`,
  `DESPLIEGUE.md`, `package.json`, `package-lock.json` y `.gitignore`.
  Se añadió `sharp@0.35.5` y se retiró `backend/server.js`.
- Regresiones nuevas: `alquiler-reglas.test.mjs`, `imagenes.test.mjs`,
  `despacho-evidencias.test.mjs`, `despacho-frontend.test.mjs`,
  `ficha-tecnica.test.mjs`, `migration-recovery.test.mjs` y fixtures válidos en
  `test-fotografias.mjs`. Se actualizaron pruebas de portal, recepción, PDF,
  permisos y preparación de base.
- Evidencia: este registro, `TRAZABILIDAD_REAJUSTES.md`,
  `VALIDACION_INSTALACION_MIGRACIONES.md`, `evidencia-tablero-20261101.json`,
  `RESULTADOS_PRUEBAS_20261101.txt` y `manifest-verificacion-20261101.json`.

## Operación de las nuevas funciones

### Corrección de fotografías históricas

Gerente o administrador, mediante sesión autenticada, consulta
`GET /api/recepciones/:recepcion_id/correcciones`. La respuesta contiene el
original, todas las correcciones y la versión actual. Para corregir, envía
`POST` a esa misma ruta con un UUID estable de operación, versión esperada,
motivo de 10 a 500 caracteres y fotografías nuevas válidas:

```json
{
  "id": "UUID de esta corrección",
  "version": 0,
  "motivo": "Fotografía histórica ilegible confirmada por operaciones",
  "fotos": ["data:image/png;base64,..."]
}
```

Solo se permite corregir evidencia vigente inválida. El original no se
sobrescribe: cada corrección añade una versión y una acción en auditoría.
Repetir el mismo UUID y contenido devuelve el resultado existente. Si cambió
la versión, responde 409 y exige consultar nuevamente. La consulta normal de
recepciones muestra las fotos vigentes; el historial conserva las anteriores.

### Despacho y dependencia del canal

La programación se guarda por HU9a. El gerente/administrador puede enviar
`POST /api/contratos/:id/despacho` con `{}` y reintentar un fallo con
`{"reintentar":true}`. `GET` en esa ruta devuelve las órdenes, intentos,
responsables y clave de la programación vigente. Residente consulta;
gerente/administrador envía. El detalle del contrato expone estado y botones.
Un resultado HTTP 200 puede contener `notificacion.estado = "FALLIDO"`:
el estado persistido, su explicación y los intentos son el resultado del envío.

La orden incluye contrato, cliente, ciudad, fechas de renta, fecha y ventana
de entrega, transportista, equipos y revisión persistida de programación. La
versión de HU9a disponible no registra dirección completa ni contacto del
transportista; no se deducen esos datos del nombre. El equipo debe definirlos
si el canal elegido los requiere.

La interfaz de integración es `createServer({ database, dispatchAdapter })`,
con `available: true`, `idempotent: true` y
`send({ idempotencyKey, order, signal }) -> { id }`. El adaptador debe resolver
un destino acordado, respetar la cancelación y garantizar idempotencia duradera
del proveedor. La espera máxima es 10 segundos; se conserva el bloqueo del
contrato durante ese envío para serializar con reprogramaciones. Este coste
de bloqueo debe revisarse antes de habilitar un canal con más latencia.
El punto de entrada actual no configura un adaptador operativo: sin él se
persiste `FALLIDO` y la dependencia se muestra claramente. No hay correo,
SMS ni mensaje externo enviado por esta tarea.

La clave incorpora revisión de programación y contenido. Reintentar la misma
revisión no duplica; A→B→A crea una orden nueva para informar la vuelta a A.
El ensayo simulado verificó recepción de datos reales de HU9a, fallo inicial,
reintento exitoso, solicitudes repetidas/concurrentes, historial, ausencia de
canal, reprogramación y caída después de recibir el proveedor pero antes del
commit. `createMemoryDispatchAdapter` conserva recibos solo durante la prueba;
no es un canal operativo ni demuestra recepción de una persona.

## Comprobaciones ejecutadas

| Comando o comprobación | Resultado | Evidencia y alcance |
| --- | --- | --- |
| `npm.cmd test` | No pudo ejecutar las suites: `spawn EPERM` (22 archivos iniciales). | Restricción del entorno al crear procesos; README ya ofrece alternativa. |
| Primera ejecución global `node --test --test-isolation=none backend/*.test.mjs` | 241 pruebas: 238 aprobadas, 3 fallidas. | Harness de permisos no inyectaba el constructor recién extraído de ficha técnica; se corrigió conservando sus assertions. |
| `node --test --test-isolation=none backend/permisos-frontend.test.mjs backend/ficha-tecnica.test.mjs` | 26/26 aprobadas tras corrección. | Constructor de producción con DOM aislado, sin navegador real. |
| `node --test --test-isolation=none backend/despacho-evidencias.test.mjs backend/despacho-frontend.test.mjs` | 9/9 aprobadas. | API/sesiones/BD local, recepción simulada, revisión A→B→A, UUID mayúscula e interfaz. |
| `node --test --test-isolation=none backend/postgres-preparation.test.mjs backend/preparar-portal.test.mjs backend/migration-recovery.test.mjs` | 33/33 aprobadas. | SQL en PGlite, actualización, reinicio, fallo y recuperación; TLS simulado. |
| Ejecución global final `node --test --test-isolation=none backend/*.test.mjs` | 244/244 aprobadas, 0 fallidas, 0 omitidas; salida de Node 0. | Bases temporales; no carga `.env`. Salida en `RESULTADOS_PRUEBAS_20261101.txt`; 114 archivos de fuentes y pruebas vinculados por SHA-256 en `manifest-verificacion-20261101.json`. |
| `npm.cmd ci` en copia limpia y arranque de `backend/server.mjs` | Aprobados. | Sin `.env`, `.git`, datos ni dependencias de la copia original; health/login/catálogo/frontend comprobados. Detalles en `VALIDACION_INSTALACION_MIGRACIONES.md`. |
| `npm.cmd run db:verify` | Fallida/incompleta: falta ampliar roles o estados operativos. | Solo lectura contra configuración existente, sin aplicar migraciones. No se afirma que el backend candidato esté listo para esa base. |
| `git diff --check` y `node --check` sobre módulos modificados/nuevos | Aprobados; sintaxis de 32 módulos comprobada. | Control de cambios y módulos modificados. |

No ejecutado: envío por canal real, recepción humana en destino autorizado,
prueba entre conexiones PostgreSQL independientes, respaldo/restauración
operativos del entorno remoto, despliegue compartido, aceptación PO o prueba
humana independiente. No equivalen a pruebas fallidas: requieren contexto o
intervención del equipo.

## Siguientes pasos del equipo

1. Revisar los cambios y acordar los estados de renta, límites de fotos y
   restricción de texto del PDF. Registrar aceptación, persona, fecha y versión.
2. Elegir canal de despacho y destino de prueba autorizado; implementar el
   adaptador con idempotencia duradera y configurarlo en el arranque. Ejecutar
   la misma secuencia de fallo/reintento/reprogramación en su sandbox y
   conservar el acuse de recepción. El correo de recuperación no cubre HU9b.
3. Restaurar un respaldo en PostgreSQL de prueba, revisar inventario, ensayar
   migración y recuperación y repetir concurrencia con conexiones separadas.
   Después preparar el ambiente compartido mediante el procedimiento revisado
   y ejecutar `db:verify`. No usar producción para inyectar fallos.
4. Aportar evidencia histórica faltante y aplicar, mediante responsable del
   tablero, las propuestas de `TRAZABILIDAD_REAJUSTES.md`. No fechar cierres al
   17/24 de octubre cuando la integración comprobada fue el 22/26.

Referencia técnica del decodificador: [constructor de sharp](https://sharp.pixelplumbing.com/api-constructor/)
y [salida raster de sharp](https://sharp.pixelplumbing.com/api-output/#raw).
