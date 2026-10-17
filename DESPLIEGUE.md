# Despliegue automático a Render con Supabase

El servicio web `metodologias-agiles-ci` pertenece al proyecto nuevo
**Metodologías Ágiles — CI** de Render y usa el proyecto nuevo **constructora-averguers-ci** de Supabase.
`render.yaml` define únicamente ese servicio, en el plan gratuito.

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

### 1. Servicio nuevo y proyecto Supabase propio

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

El proyecto Supabase se crea en la organización **Metodologías Ágiles - Averguers**, con plan gratuito y región Oregon. La Data API y la exposición automática de nuevas tablas están desactivadas; el backend utiliza `pg`. Inicializa las cuatro tablas y el catálogo de ejemplo en `constructora_private`, con RLS y sin permisos para los roles de la Data API, antes de iniciar el servidor.

Introduce `DATABASE_URL` y `SUPABASE_PROJECT_REF` únicamente en el entorno privado de Render;
`sync: false` permite introducir los valores al configurar el servicio sin fijarlos en el Blueprint. Conserva el usuario,
host y base del panel de Supabase, y codifica los caracteres especiales de
la contraseña para la URI. El Session pooler conserva el `search_path` que
necesita el backend. El certificado raíz público está versionado y TLS
siempre verifica el certificado y el nombre del servidor.

Render asigna `PORT` automáticamente. El `HOST=127.0.0.1` de `.env.example`
sirve para desarrollo local; en Render se usa `0.0.0.0`.

Antes del primer despliegue, comprueba la conexión y el esquema existentes
con `npm run db:verify` desde un entorno privado ya configurado. Ese comando
solo verifica TLS y lecturas de `/api/health` y `/api/maquinaria`. El servidor
en producción comprueba el esquema al arrancar; la preparación o migración
de tablas se realiza explícitamente siguiendo la guía Supabase del README.

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
