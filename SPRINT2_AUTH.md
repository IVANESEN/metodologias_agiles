# HU1a: autenticación

La aplicación inicia con protección de sesión en `server.mjs`. El servidor usado por pruebas conserva `requireAuth: false` por defecto; las pruebas de login activan la guardia explícitamente. `/api/health` permanece público. No hay contraseñas ni usuarios de demostración en las semillas.

## Preparación antes de integrar en main

1. Inspeccionar la base con `npm run db:inspect` y revisar el esquema privado y la Data API.
2. Preparar explícitamente `usuario` y `sesion` usando el código de esta rama: `npm run db:init -- --existing-reviewed --schema-only`. Requiere la conexión configurada y `SUPABASE_DATA_API_REVIEWED=true` tras verificar el panel.
3. Ejecutar `npm run db:verify`.
4. Crear el usuario inicial en una terminal confiable con `USUARIO_CORREO`, `USUARIO_NOMBRE`, `USUARIO_CLAVE` y, opcionalmente, `USUARIO_ROL`. Ejecutar `node --env-file-if-exists=.env backend/crear-usuario.mjs`. No pasar la clave como argumento ni versionarla. Borrar las variables de la sesión después.
5. Integrar únicamente tras las pruebas. El despliegue hará público el login y requerirá sesión para catálogo, contratos, alertas y cobros.

En desarrollo, el script crea el esquema PGlite si no existe. En PostgreSQL exige la preparación previa y nunca aplica cambios remotos automáticamente.

## Seguridad y validación

Las claves usan scrypt N=65536, r=8, p=2, sal aleatoria de 16 bytes y comparación con timingSafeEqual. Perfil de referencia: [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Implementación nativa: [Node.js crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).

Las sesiones duran ocho horas. Se almacena SHA-256 del token aleatorio de 32 bytes. La cookie usa HttpOnly, SameSite=Strict y Secure en producción. Las mutaciones con Origin ajeno se rechazan. Los errores de login no distinguen correo inexistente, clave errónea ni usuario inactivo.

Ejecutar `node --test backend/auth.test.mjs backend/login.test.mjs backend/postgres-preparation.test.mjs` y luego `npm test`. La inspección de PostgreSQL incluye las nuevas tablas y les aplica la misma protección RLS y aislamiento de Data API que a las existentes. Las expectativas de cantidad de tablas del test de preparación se amplían para incluir autenticación.

HU1b importa las funciones de `auth.mjs` e implementa `handleRecoveryRoutes` en el archivo reservado. No agrega rutas directamente a `app.mjs`.
