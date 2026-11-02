# Despliegue automático a Render con Supabase

El servicio web `metodologias-agiles-ci` pertenece al proyecto
**Metodologías Ágiles — CI** de Render y usa la base Supabase elegida en
`DATABASE_URL`. `render.yaml` define únicamente ese servicio, en el plan
gratuito; no crea ni copia bases de datos.

## Flujo de integración continua

`.github/workflows/pipeline.yml` se ejecuta automáticamente con cada `push`
y `pull_request`. Sus etapas corresponden al flujo del equipo:

1. **Build:** una máquina limpia instala con `npm ci` y comprueba la sintaxis
   del JavaScript del backend, frontend y pruebas. El proyecto ejecuta
   JavaScript directamente y no necesita una compilación adicional.
2. **Pruebas:** otra máquina limpia ejecuta `npm ci` y las pruebas reales con
   `npm test`. Las bases PGlite temporales aíslan las pruebas de Supabase.
3. **Despliegue:** solo un `push` a `main`, incluido un merge de PR, puede
   publicar; exige que build y pruebas hayan finalizado correctamente.
4. **Resultado CI:** publica el estado de cada etapa y conserva los fallos
   como errores. En PR y otras ramas, omitir el despliegue es lo esperado.

## Configuración única

### 1. Servicio web y proyecto Supabase propio

Crea el servicio web dentro del proyecto **Metodologías Ágiles — CI** y
conéctalo a `IVANESEN/metodologias_agiles`, rama `main`. La configuración es:

| Opción | Valor |
| --- | --- |
| Runtime | Node.js 24 |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |
| Auto-Deploy | **Off** |

En **Environment**, configura las variables de `render.yaml`:

| Variable | Valor |
| --- | --- |
| `NODE_VERSION` | `24.21.0` |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `DATABASE_URL` | URI privada de **Connect → Session pooler** del proyecto Supabase elegido, puerto explícito `5432`. |
| `SUPABASE_PROJECT_REF` | Referencia del mismo proyecto que figura en `DATABASE_URL`, copiada del panel. |
| `DATABASE_SCHEMA` | `constructora_private` |
| `DATABASE_SSL_CA_FILE` | `database/certs/supabase-prod-ca-2021.crt` |

El backend utiliza PostgreSQL con `pg`. Antes de inicializar el esquema,
revisa en el proyecto Supabase elegido que `constructora_private` no figure
en **Exposed schemas**, o desactiva la Data API si ninguna aplicación depende
de ella. Solo después de comprobarlo configura
`SUPABASE_DATA_API_REVIEWED=true` en el entorno privado donde ejecutes
`db:init`; el indicador no cambia la configuración del panel.

Introduce `DATABASE_URL` y `SUPABASE_PROJECT_REF` únicamente en el entorno privado de Render;
`sync: false` permite introducir los valores al configurar el servicio sin fijarlos en el Blueprint. Conserva el usuario,
host y base del panel de Supabase, y codifica los caracteres especiales de
la contraseña para la URI. El Session pooler conserva el `search_path` que
necesita el backend. El certificado raíz público está versionado y TLS
siempre verifica el certificado y el nombre del servidor.

Render asigna `PORT` automáticamente. El `HOST=127.0.0.1` de `.env.example`
sirve para desarrollo local; en Render se usa `0.0.0.0`.

Antes del primer despliegue, sigue la [guía Supabase del README](README.md#conexión-local-a-supabase)
desde un entorno privado ya configurado: ejecuta `npm run db:inspect`, revisa
el inventario y prepara el esquema explícitamente con `db:init` cuando
corresponda. Después ejecuta `npm run db:verify`; comprueba TLS, el esquema
y las lecturas de `/api/health` y `/api/maquinaria` sin crear tablas ni datos.
`npm start` ejecuta primero `prestart` → `db:migrate`: aplica únicamente la
migración registrada `20261101_reajustes` si encuentra la versión previa compatible
de 14 tablas en `constructora_private`. Después el servidor comprueba el esquema.
Las instalaciones vacías o esquemas incompatibles requieren preparación explícita.

Cambiar `DATABASE_URL` no copia los datos de la base anterior. Editar `.env`
o estos archivos tampoco modifica las variables reales de Render ni publica
un despliegue; actualiza el entorno privado del servicio antes de desplegar.

### 2. Dos secretos de GitHub Actions

GitHub → repositorio → **Settings → Secrets and variables → Actions →
New repository secret**:

| Secreto | Dónde se obtiene |
| --- | --- |
| `RENDER_API_KEY` | Render → **Account Settings → API Keys → Create API Key**, en la cuenta que contiene el proyecto nuevo. |
| `RENDER_SERVICE_ID` | Render → servicio `metodologias-agiles-ci` → Settings. Empieza con `srv-` y aparece también en la URL del Dashboard. |

Las credenciales de Supabase permanecen en Render. CI usa únicamente estos
dos secretos para desplegar. La URL de la aplicación se obtiene del servicio
mediante la API de Render y aparece en el entorno `production` y en el resumen
de GitHub Actions.

### 3. Un solo disparador de despliegues

`render.yaml` declara `autoDeployTrigger: 'off'`. Confirma en Render →
servicio → **Settings → Auto-Deploy** que quedó en **Off**. Así, GitHub
Actions publica el commit que pasó las pruebas. Si falta alguno de los dos
secretos, el job de despliegue falla con un mensaje claro.

## Cómo se verifica un despliegue

1. Se comprueba que el commit probado siga siendo la punta de `main`.
2. `GET /v1/services/{id}` proporciona `serviceDetails.url`; se valida que
   sea una URL HTTPS de `onrender.com` del servicio configurado.
3. `POST /v1/services/{id}/deploys` solicita `{"commitId": "<sha probado>"}`.
4. Se consulta `GET /v1/services/{id}/deploys/{deployId}` hasta `status: live`
   y se exige `commit.id == github.sha`.
5. `GET /api/health` verifica la base y devuelve `status: ok`; si informa
   `commit`, debe coincidir con el SHA probado.

## Volver a la versión anterior (rollback)

En Render → servicio `metodologias-agiles-ci` → **Deploys**, elige un
despliegue anterior exitoso con artefacto disponible y pulsa **Rollback**.
Después abre `/api/health` desde la URL pública del servicio y comprueba que
el `commit` corresponde al despliegue restaurado.

El rollback restaura la aplicación y conserva la base y sus datos. Con
Auto-Deploy en **Off**, el siguiente despliegue lo realizará GitHub Actions
cuando se integre una corrección en `main` y pasen las pruebas.

## Actualizaciones del esquema y recuperación

La instalación inicial continúa siendo explícita; PGlite local prepara su esquema.
Para esta actualización, `npm start` ejecuta la migración registrada antes del
servidor. Conservar una copia verificable antes de actualizar el entorno
compartido: exportar mediante `pg_dump --format=custom` desde un entorno privado
con las credenciales fuera del historial, y ensayar `pg_restore` en otra base.
El respaldo debe incluir todas las tablas de la aplicación, permisos y la fecha
y versión de origen. La existencia de un archivo sin restauración comprobada no
demuestra que el respaldo sea recuperable.

1. Restaurar una copia en una base de prueba; usar su conexión privada y revisar
   `npm run db:inspect`, conteos, restricciones y permisos. No usar producción
   para el ensayo.
2. Desde la versión candidata ejecutar `npm run db:migrate`. Solo aplica
   `database/migrations/20261101_reajustes.sql`: conserva roles y estados anteriores,
   amplía los CHECK y crea las tres tablas de correcciones y despacho con RLS y
   permisos revocados. No carga semillas ni actualiza usuarios, contratos, pagos o
   fotografías. La validación final ocurre dentro de la transacción; un fallo
   revierte todos los cambios. `db:init` y `db:portal` siguen disponibles para una
   preparación explícita distinta; no son el mecanismo automático de esta versión.
3. La preparación serializa con un bloqueo asesor, limita espera de bloqueos a
   10 segundos y sentencias a 60 segundos. Si vence un límite, conservar el error,
   revisar la transacción que bloquea y repetir el mismo comando tras resolverlo.
   No quitar restricciones ni interrumpir sesiones ajenas para forzar el cambio.
4. Ejecutar `npm run db:verify`. Después reiniciar la aplicación candidata y
   comprobar `/api/health`, catálogo, contratos, evidencias y programación. Repetir
   la preparación no debe duplicar registros ni cambiar importes históricos.
5. Al fusionar el PR a `main`, GitHub Actions comprueba dependencias, sintaxis y
   pruebas y solicita el despliegue del mismo commit. Render conserva
   `startCommand: npm start`; `prestart` usa la conexión privada del servicio y
   prepara la base antes de abrir el puerto. Un error devuelve código distinto de
   cero e impide iniciar la nueva versión. Con el esquema actualizado, los
   siguientes arranques omiten DDL. No se necesitan secretos de Supabase en Actions
   ni cambios de variables o de plan en Render. Ejecutar directamente
   `node backend/server.mjs` omite `prestart`: usar `npm start` en producción.

La expansión añade tablas/columnas y conserva los valores de roles y estados
anteriores. El código anterior al ajuste puede leer las columnas antiguas,
pero su inventario estricto rechaza tablas nuevas y sus reglas de disponibilidad
no conocen los estados `FINALIZADO` y `DEVUELTO`. Por ello no se garantiza un
rollback de aplicación a una versión anterior sin probarla contra el esquema
expandido. Mantener en revisión una versión de recuperación que acepte ese
esquema y conserve el bloqueo de rentas. Durante la transición, detener escrituras
o restringir a un solo grupo de servidores ya actualizado; no mezclar escritores
con reglas viejas y nuevas.

Si la migración falla antes del commit, la transacción revierte DDL y datos
insertados; comprobar inventario y ejecutar de nuevo tras corregir la causa.
Si falla la aplicación después del commit, conservar el esquema expandido y
recuperar con una corrección compatible. No eliminar tablas o columnas ni reducir
los CHECK si ya se registraron nuevos estados. Restaurar un respaldo solo es
último recurso: hacerlo primero en otra base, reconciliar las escrituras posteriores
al respaldo y coordinar el cambio con el equipo. La restauración puede perder
operaciones posteriores y exige una ventana acordada. Render Rollback no restaura
la base de datos.

Las pruebas `postgres-preparation.test.mjs`, `preparar-portal.test.mjs` y
`migration-recovery.test.mjs` ejecutan SQL en PGlite aislado, con evidencia TLS
simulada. Cubren actualización de datos históricos, reintento, reapertura y fallo
inyectado; no acreditan TLS real, respaldo operativo ni recuperación de Supabase.
