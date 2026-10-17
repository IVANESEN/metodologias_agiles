# HU1b: recuperación de contraseña

Depende de HU1a (`feat/ivan-hu1a-login`). Este PR se revisa contra esa rama. Integrar primero HU1a y después actualizar la base de este PR a `main`.

Se crea `token_recuperacion` en el esquema privado con RLS y sin acceso de Data API, aplicando el mismo procedimiento de `SPRINT2_AUTH.md`. No se crean usuarios ni contraseñas en las semillas. No se modifica `app.mjs`, `auth.mjs`, el pipeline ni el login.

`POST /api/auth/recuperar` acepta `{ correo }` y devuelve 202 genérico para correo existente, inexistente o inactivo. El token aleatorio de 32 bytes vence en 30 minutos, se guarda como SHA-256 y sustituye enlaces anteriores pendientes. Un fallo del adaptador revierte la emisión y no cambia la respuesta pública.

`POST /api/auth/restablecer` acepta `{ token, clave }`. Consume el token atómicamente, cambia el hash de contraseña y revoca todas las sesiones dentro de una transacción. Repeticiones, concurrencia, tokens vencidos y cuentas inactivas no pueden completar un segundo restablecimiento. La clave debe tener entre 8 y 256 caracteres.

## Correo simulado y producción

En desarrollo, `createMailer()` muestra el enlace en la consola local. En pruebas, `createMemoryMailer()` lo conserva en `outbox`. Son datos sensibles de desarrollo, nunca deben publicarse ni usarse con correos reales de clientes.

Se integra Resend mediante HTTPS (`POST https://api.resend.com/emails`), sin dependencias adicionales. En Render, configurar `RESEND_API_KEY` (clave con permiso de envío), `MAIL_FROM` (remitente verificado) y `APP_URL=https://metodologias-agiles-ci.onrender.com`. Los valores secretos se guardan exclusivamente como variables del servicio; nunca en Git. El servicio actual se administra desde el Dashboard de Render.

Sin clave y remitente completos, recuperación permanece deshabilitada con 503 en producción. El adaptador limita cada envío a 10 segundos, rechaza redirecciones y no registra respuestas, claves ni enlaces. Un rechazo del proveedor conserva la respuesta genérica y revierte el token según las pruebas de recuperación. La URL del correo nunca se obtiene del Host recibido en producción. El login funciona sin servicio de correo.

El remitente de prueba `onboarding@resend.dev` solo permite enviar al correo de la propia cuenta Resend. Para usuarios con otros correos es obligatorio verificar un dominio propio y usar un remitente de ese dominio. Verificar la recepción real antes de dar por terminado el despliegue.

Antes de desplegar, aplicar la creación de `token_recuperacion`, activar RLS y revocar acceso a PUBLIC, anon, authenticated y service_role en el esquema privado. El arranque no migra tablas. La dependencia HU1a ya debe estar integrada en main; dirigir este PR a main.

## Validación

Ejecutar `node --test backend/recuperacion.test.mjs backend/auth.test.mjs backend/login.test.mjs backend/postgres-preparation.test.mjs` y `npm test`. Las pruebas cubren respuesta genérica, expiración, reemplazo y consumo único, concurrencia, revocación de sesiones, ausencia de tokens en claro y reversión de cambios si falla el guardado.
