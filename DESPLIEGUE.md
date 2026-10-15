# Despliegue automático a Render

El despliegue lo ejecuta el job `deploy` de `.github/workflows/pipeline.yml`.
Se publica **solo** en un `push` a `main` (incluido el merge de un PR) y
únicamente si `build` y `test` terminaron en `success`. Los PR y las demás
ramas ejecutan CI sin publicar.

- Aplicación: https://constructora-el-salvador.onrender.com
- Salud y versión: `GET /api/health` (incluye `commit` cuando corre en Render).

## Configuración única

### 1. Secretos del repositorio (nunca en el código)

GitHub → repositorio → **Settings → Secrets and variables → Actions →
New repository secret**:

| Secreto | Dónde se obtiene |
| --- | --- |
| `RENDER_API_KEY` | Render → **Account Settings → API Keys → Create API Key**. Se muestra una sola vez. |
| `RENDER_SERVICE_ID` | Render → servicio `constructora-el-salvador`. Empieza con `srv-` y aparece en la URL del servicio (`dashboard.render.com/web/srv-...`) y en su página de Settings. |

### 2. Un solo disparador de despliegues

`render.yaml` declara `autoDeployTrigger: 'off'`. Confirma en Render →
servicio → **Settings → Auto-Deploy** que quedó en **Off**. Si estuviera en
*On Commit* o *After CI Checks Pass*, cada merge desplegaría dos veces.

> Los despliegues quedan en manos del job `deploy`. Si los secretos no
> existen, ese job falla con un mensaje claro y la app no se actualiza.

## Cómo se verifica un despliegue

1. `POST /v1/services/{id}/deploys` con `{"commitId": "<sha probado>"}`.
2. Se consulta `GET /v1/services/{id}/deploys/{deployId}` hasta `status: live`
   y se exige `commit.id == github.sha`.
3. `GET /api/health` debe responder `status: ok` y, si informa `commit`,
   debe coincidir con el SHA probado.

## Volver a la versión anterior (rollback)

Define las variables en tu terminal (no las guardes en archivos del repo):

```bash
export RENDER_API_KEY='...'        # la misma clave del secreto
export RENDER_SERVICE_ID='srv-...'
```

1. Listar los últimos despliegues exitosos y elegir el anterior:

   ```bash
   curl -sS -H "Authorization: Bearer $RENDER_API_KEY" \
     "https://api.render.com/v1/services/$RENDER_SERVICE_ID/deploys?limit=10" |
     jq -r '.[].deploy | [.id, .status, .commit.id[0:7], .commit.message, .finishedAt] | @tsv'
   ```

2. Restaurarlo (`DEPLOY_ID` es el de la versión anterior, con `status` `live`
   o `deactivated` y artefacto aún conservado por Render):

   ```bash
   curl -sS -X POST -H "Authorization: Bearer $RENDER_API_KEY" \
     -H 'Content-Type: application/json' \
     -d "{\"deployId\":\"$DEPLOY_ID\"}" \
     "https://api.render.com/v1/services/$RENDER_SERVICE_ID/rollback"
   ```

   Alternativa: Render → servicio → **Deploys** → deploy anterior → **Rollback**.

3. Verificar:

   ```bash
   curl -sS https://constructora-el-salvador.onrender.com/api/health
   ```

   El `commit` debe ser el del deploy restaurado.

Notas:

- Render solo permite volver a despliegues recientes cuyo artefacto aún
  conserva.
- El rollback no revierte la base de datos ni los datos.
- Con el auto-deploy de Render en *Off*, un rollback no se deshace solo. Para
  volver a publicar lo nuevo, arregla el problema en `main` y deja que el job
  `deploy` vuelva a ejecutarse.
