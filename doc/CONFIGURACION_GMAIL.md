# Recuperación de contraseña mediante Gmail API

La aplicación puede enviar los enlaces de recuperación desde una cuenta Gmail autorizada mediante OAuth 2.0. La conexión usa HTTPS, compatible con el servicio gratuito de Render. Se conserva el flujo existente de usuarios, sesiones y tokens de recuperación.

## Configuración en Google

1. Crear o seleccionar un proyecto de Google Cloud y habilitar **Gmail API** en ese mismo proyecto.
2. Configurar Google Auth Platform con la información de la aplicación y el permiso `https://www.googleapis.com/auth/gmail.send`.
3. Si la aplicación es externa y está en estado **Prueba**, agregar el Gmail remitente en **Público → Usuarios de prueba**. Los destinatarios de los enlaces no necesitan ser usuarios OAuth.
4. Crear un cliente OAuth de tipo **Aplicación web**. Para obtener la autorización con la herramienta oficial de Google, registrar exactamente esta URI de redireccionamiento:

   ```text
   https://developers.google.com/oauthplayground
   ```

5. En [OAuth Playground](https://developers.google.com/oauthplayground/), abrir la configuración y activar **Use your own OAuth credentials**. Introducir allí el ID y el secreto de ese cliente, con endpoints **Google**, flujo **Server-side** y acceso **Offline**.
6. Solicitar únicamente `https://www.googleapis.com/auth/gmail.send`, autorizar con la cuenta remitente e intercambiar el código por los tokens. Guardar el **refresh token** de forma privada. El adaptador obtiene y renueva el access token automáticamente.

La creación de credenciales y la autorización de la cuenta deben completarse por la persona propietaria. No copiar secretos ni tokens a chats, capturas, archivos de documentación o GitHub.

## Variables del servicio en Render

Configurar en **Environment** del servicio web:

| Variable | Valor |
| --- | --- |
| `MAIL_PROVIDER` | `gmail` |
| `GMAIL_USER` | Dirección de la cuenta Gmail que autorizó OAuth, sin nombre ni corchetes. |
| `GMAIL_CLIENT_ID` | ID del cliente OAuth propio. |
| `GMAIL_CLIENT_SECRET` | Secreto de ese mismo cliente. |
| `GMAIL_REFRESH_TOKEN` | Refresh token obtenido al autorizar la cuenta remitente. |
| `APP_URL` | URL pública HTTPS de la aplicación, por ejemplo `https://metodologias-agiles-ci.onrender.com`. |

El despliegue debe incluir el adaptador Gmail antes de seleccionar este proveedor. Guardar las variables y desplegar esa versión para que los cambios entren en vigor. La configuración privada de Supabase permanece en Render.

`MAIL_FROM` y `RESEND_API_KEY` corresponden al adaptador Resend. Al seleccionar `gmail`, el remitente es `GMAIL_USER`; el servicio no cambia a Resend si falla la autorización de Google. Si `MAIL_PROVIDER` no está definido, se mantiene el comportamiento previo de Resend o la simulación local, según la configuración.

## Funcionamiento

- `POST /api/auth/recuperar` busca una cuenta activa por su correo registrado. El rol no determina si puede recuperar su contraseña.
- El backend solicita un access token a Google usando el refresh token y lo mantiene temporalmente en memoria. Envía un mensaje de texto mediante Gmail API a la dirección de esa cuenta.
- El enlace conserva su vencimiento de 30 minutos y su uso único. El cambio de contraseña sigue revocando las sesiones anteriores.
- Los errores del proveedor se presentan sin revelar credenciales ni enlaces privados. Si el envío falla, la operación de creación del token se revierte.
- La respuesta genérica HTTP 202 protege contra la enumeración de usuarios y **no confirma la entrega del correo**.

## Límites y mantenimiento

- Con una aplicación OAuth externa en estado **Testing/Prueba**, el refresh token para Gmail caduca a los siete días. Antes de depender de este envío de forma permanente, revisar el estado de publicación y los requisitos de verificación aplicables. Publicar la aplicación no garantiza por sí solo que Google la haya verificado.
- Google contempla una excepción de verificación para aplicaciones de uso personal o de un grupo pequeño de personas conocidas. Debe revisarse si corresponde a este uso del remitente; los destinatarios de correos no cuentan como usuarios OAuth por el simple hecho de recibirlos. La excepción no elimina el vencimiento del modo Prueba ni garantiza autorizaciones indefinidas.
- OAuth Playground revoca sus autorizaciones predeterminadas a las 24 horas; se evita esa condición usando las credenciales OAuth propias del proyecto. La caducidad de siete días del modo Prueba sigue aplicándose.
- Una revocación del permiso, un cambio de contraseña de Gmail u otras políticas de Google pueden invalidar el refresh token. En ese caso, repetir la autorización y actualizarlo en Render.
- Aplican los límites de envío y de uso de la cuenta Google. No se garantiza que un proveedor receptor entregue todos los mensajes en la bandeja principal.
- Render gratuito bloquea los puertos habituales de SMTP. Este adaptador utiliza la API HTTPS.

## Referencias

- [Autorización OAuth en el servidor](https://developers.google.com/workspace/gmail/api/auth/web-server).
- [Permisos de Gmail API](https://developers.google.com/workspace/gmail/api/auth/scopes).
- [Creación y envío de mensajes](https://developers.google.com/workspace/gmail/api/guides/sending).
- [Caducidad de refresh tokens](https://developers.google.com/identity/protocols/oauth2#expiration).
- [Excepciones a la verificación de permisos sensibles](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).
- [Cuotas de Gmail API](https://developers.google.com/workspace/gmail/api/reference/quota).
- [Variables de entorno en Render](https://render.com/docs/configure-environment-variables).
- [Limitaciones de Render gratuito](https://render.com/docs/free).
