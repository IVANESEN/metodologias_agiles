# Validación de instalación y migraciones

El 1 de noviembre de 2026 se verificaron los ajustes H04, H05 y H07 sobre
`b8a580d` más las modificaciones de la rama de trabajo `victo`. Los cambios no
están integrados en `main` ni desplegados. La ejecución corresponde a una
verificación automatizada actual del agente; no acredita aceptación del Product
Owner, prueba por otra persona ni funcionamiento histórico compartido.

## Cambios implementados

`.env.example` vuelve a existir y contiene únicamente opciones sin secretos.
`DATABASE_URL` vacío selecciona PGlite; para Supabase se completan por separado
la URI, referencia de proyecto, CA pública y revisión de Data API. Las instrucciones
de instalación usan los scripts reales de `package.json` y Node.js 24.

El punto de entrada es `backend/server.mjs`, invocado por `npm start` y `npm run dev`.
`backend/server.js` tenía cero bytes y ninguna referencia hallada en el código,
scripts, CI o documentación; se retiró.

La preparación PostgreSQL amplía roles y estados dentro de la misma transacción
que el esquema. `db:portal` incluye también las tasas iniciales en esa transacción,
con `ON CONFLICT DO NOTHING`, conservando tasas ajustadas. Antes, el CHECK de roles
podía quedar confirmado aunque fallara después la preparación. La carga opcional
de demostración continúa siendo una operación posterior para entornos de prueba.

La preparación conserva un bloqueo asesor, añade límites de espera de bloqueos
y sentencias, verifica el esquema al terminar y no reescribe contratos, pagos,
fotografías ni usuarios históricos. El arranque remoto solo inspecciona y exige
las nuevas tablas y los CHECK ampliados. La migración manual equivalente es
`database/migrations/20261101_reajustes.sql`.

## Comandos y resultados

| Comprobación | Resultado | Alcance y límite |
| --- | --- | --- |
| `node --test --test-isolation=none backend/postgres-preparation.test.mjs backend/preparar-portal.test.mjs backend/migration-recovery.test.mjs` | Aprobada: 33 pruebas, 0 fallidas, 0 omitidas | SQL real en PGlite aislado; evidencia TLS simulada. |
| `npm.cmd --prefix <copia-limpia> ci --offline --cache <cache-local>` | Fallida: `ENOTCACHED` para `xtend-4.0.2.tgz` | Cache incompleto; no demuestra defecto del proyecto. |
| `npm.cmd --prefix <copia-limpia> ci --cache <cache-local>` | Aprobada: 43 paquetes instalados, auditoría de npm sin vulnerabilidades informadas | Descarga de paquetes públicos autorizada por el entorno. |
| Arranque de `node --env-file-if-exists=.env backend/server.mjs` en la copia | Aprobado | Ambiente saneado, `HOST=127.0.0.1`, puerto temporal, `DATABASE_URL` vacío, PGlite temporal y `DEMO_DATA=false`. |
| `GET /api/health` en esa copia | HTTP 200, `status: ok`, `database: pglite` | No acredita conexión remota. |
| Registro y login ficticios, `GET /api/portal/catalogo` autenticado y `GET /` | HTTP 201, 200, 200 y 200; catálogo con 2 equipos semilla | Cuenta creada solo en la base temporal. Petición anónima a `/api/maquinaria`: HTTP 401 esperado. El servidor se detuvo después. |
| `npm.cmd run db:verify` sobre la configuración existente, realizado por el agente principal | Fallida/incompleta: falta ampliar roles o estados operativos | Comprobación de solo lectura. No se aplicaron migraciones remotas. El esquema debe prepararse por el equipo antes de arrancar esta versión. |

La copia limpia se creó en un directorio temporal nuevo, con código, manifiestos
y configuración de ejemplo. No se copiaron `.env`, `data/`, `.git/` ni
`node_modules/`. El primer intento de la sonda de arranque estuvo limitado por
`spawn EPERM`; se repitió con autorización del entorno. La sonda inicialmente
esperaba acceso anónimo al catálogo protegido, recibió HTTP 401 y se corrigió
para registrarse e iniciar sesión antes de verificar el catálogo.

## Ensayo de actualización y recuperación

`migration-recovery.test.mjs` crea un esquema previo con 14 tablas, roles
residente/gerente y datos históricos de usuario, maquinaria, contrato, detalle,
pago y recepción. Inyecta un fallo después de crear las tablas nuevas y ampliar
CHECK, antes del commit. Se comprueba que desaparecen esos cambios y que los
datos históricos y el CHECK original siguen intactos. Tras cerrar y reabrir el
almacenamiento, el reintento actualiza a 17 tablas. Otra reapertura y repetición
de la preparación conservan todos los datos y no duplican registros.

Un segundo ensayo aplica y repite la migración manual; la preparación normal
acepta el resultado y conserva la misma evidencia histórica. Las pruebas
anteriores cubren además permisos, RLS, restricciones, importes y relleno
idempotente del detalle histórico. No se usó una base compartida para esos ensayos.

## Pendientes del equipo

1. Revisar inventario remoto y respaldo recuperable. Ensayar su restauración y
   los mismos pasos en una copia PostgreSQL/Supabase antes de modificar el ambiente
   compartido. TLS real y recuperación operativa no se ensayaron aquí.
2. Ejecutar la preparación explícita revisada y después `db:verify`, conservando
   salida, versión y responsable. No usar producción para inyectar fallos.
3. Ensayar una versión de recuperación compatible con el esquema expandido.
   El inventario estricto del código anterior puede rechazar tablas nuevas;
   además, las reglas viejas desconocen nuevos estados de renta. Render Rollback
   por sí solo no revierte el esquema ni garantiza disponibilidad correcta.
4. Aplicar el procedimiento y las limitaciones de recuperación documentados en
   `DESPLIEGUE.md`. No reducir CHECK ni eliminar tablas nuevas con datos.

La aceptación del Product Owner, revisión humana independiente, prueba por otra
persona y validación de despliegue compartido son **No verificable** con esta
evidencia. Este registro no cierra historias por cuenta del equipo.
