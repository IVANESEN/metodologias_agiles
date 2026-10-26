# Sprint 3 - HU9a: programación de entrega y transportista

Responsable: Kevin Landos.

## Criterios cubiertos

1. Asignar fecha, franja horaria y transportista al flete.
2. Bloquear guardado si falta definir transportista o ventana horaria.
3. Consultar estado de programación de fecha desde el detalle del contrato.

## Flujo

1. Un usuario autenticado abre el detalle de un contrato: la confirmación que aparece al
   crearlo, o el enlace `?contrato=<id>#contrato` que lo vuelve a abrir.
2. El bloque **Entrega** consulta `GET /api/contratos/:id/entrega` y muestra
   **Sin programar** o **Programada: <fecha>, <desde>–<hasta>, <transportista>**.
3. Con permiso de programar, el gerente completa la fecha de entrega, la ventana horaria
   (desde y hasta) y el transportista, y pulsa **Programar entrega**.
4. `POST /api/entregas` valida de nuevo todos los datos y guarda la programación. Si el
   contrato ya tenía una, la reemplaza (**Reprogramar entrega**).
5. El bloque muestra el estado actualizado. Al reabrir el contrato se conserva.

El botón queda deshabilitado mientras se envía. Un reintento con los mismos datos no
duplica la programación ni cambia su fecha de actualización.

## Supuestos

- **Un flete por contrato**, aunque el contrato incluya varias máquinas. La tabla usa el
  contrato como clave primaria.
- **La fecha de entrega va de hoy a la fecha de fin del contrato**, ambas incluidas. "Hoy"
  se calcula en `America/El_Salvador`, no con la fecha UTC del servidor. Un contrato que
  ya terminó no admite programaciones nuevas, pero sigue mostrando la que tenga.
- **Permisos:** programar entrega (`entregas.programar`): gerente y admin. Empleado y
  residente solo consultan (`entregas.consultar`). Supuesto pendiente de confirmar con el
  Product Owner.

Ninguno de estos supuestos está escrito en la tarjeta. Conviene confirmarlos con el
Product Owner.

## Seguridad y validaciones

- Sesión, protección de origen y rutas exactas se aplican antes de procesar el negocio.
- El backend es la referencia; el frontend solo ayuda y la base es la última barrera.
  Las tres bloquean:
  - transportista vacío, solo con espacios, de menos de 2 o más de 160 caracteres;
  - hora faltante, con formato distinto de `HH:MM` de 24 horas, o ventana con la hora
    final igual o anterior a la de inicio;
  - fecha inexistente, anterior a hoy o posterior a la fecha de fin del contrato.
- La base exige `CHECK (length(trim(transportista)) >= 2)` y `CHECK (hora_hasta > hora_desde)`,
  y una clave foránea al contrato con `ON DELETE RESTRICT`.
- Las consultas SQL son parametrizadas. Guardar bloquea la fila del contrato
  (`SELECT … FOR UPDATE`) para validar su fecha de fin y serializar dos
  reprogramaciones simultáneas.
- La interfaz muestra los datos con `textContent`: un transportista con HTML se ve como texto.
- El esquema privado mantiene RLS y no concede acceso a los roles de Data API.

## Respuestas principales

| Situación | Respuesta |
| --- | --- |
| Programación nueva | `201` y `{ estado: 'PROGRAMADA', entrega }` |
| Reprogramación o reintento idéntico | `200` y `{ estado: 'PROGRAMADA', entrega }` |
| Consulta sin programación | `200` y `{ estado: 'SIN_PROGRAMAR', entrega: null }` |
| Consulta con programación | `200` y `{ estado: 'PROGRAMADA', entrega }` |
| Datos inválidos | `400 VALIDATION_ERROR` con `fields` por campo |
| ID de contrato inválido en la URL | `400 INVALID_ID` |
| Contrato inexistente | `404 CONTRACT_NOT_FOUND` |
| Sin sesión | `401 UNAUTHENTICATED` |
| Sin permiso (residente que programa) | `403 FORBIDDEN` |

`entrega` contiene `contrato_id`, `fecha_entrega` (`AAAA-MM-DD`), `hora_desde` y `hora_hasta`
(`HH:MM`), `transportista` y `actualizado_en` (ISO en UTC).

## Pruebas

Las pruebas usan PGlite en memoria o directorios temporales; no leen ni modifican la
base configurada en `.env` ni el directorio persistente `data/`.

```sh
node --test backend/entregas.test.mjs backend/entregas-frontend.test.mjs
npm test
```

Son 17 pruebas nuevas:

- `entregas.test.mjs` (8): programar, consultar, reprogramar y reintentar sin duplicar;
  un solo flete con varias máquinas; identificadores inválidos o inexistentes; 22 casos
  de validación; restricciones de la base con `INSERT` directo; 401, residente y gerente;
  y regresión del contrato, su documento y su PDF.
- `entregas-frontend.test.mjs` (4): validación del borrador, texto del estado y "hoy" en
  El Salvador.
- `permisos-frontend.test.mjs` (2): residente ve el estado sin formulario; gerente puede programar.
- `postgres-preparation.test.mjs` (3): restricciones de la tabla, comprobación exacta en
  el arranque y paridad de la migración manual con la preparación normal.

Resultado integrado con `main` del 26 de octubre de 2026: **207 pruebas aprobadas,
0 fallidas, 0 omitidas** (190 de `main` y 17 nuevas). Se ejecutó con `npm test` y usó
únicamente bases PGlite temporales o en memoria.

## Validación manual sugerida

Usar únicamente una base local o de pruebas.

**Datos de demostración:** en local, `main` carga datos de demostración del portal al
arrancar. Para una base vacía, arrancar con `DEMO_DATA=false`. Si al crear un contrato sale
409, es un choque de fechas con un contrato demo: usar otras fechas u otra máquina.

**Cuidado con `.env`:** `npm start` y los scripts `db:*` cargan `.env` automáticamente
(`--env-file-if-exists=.env` en `package.json`). Si tu `.env` tiene la `DATABASE_URL` de
Supabase, la prueba manual correría contra la base remota. Antes de probar, renómbralo
temporalmente (por ejemplo a `.env.supabase`) o trabaja en otra copia del repositorio, y
devuélvelo a su nombre al terminar.

Antes de empezar, crear un usuario gerente (o admin), uno residente y, para probar el
rechazo, uno empleado con `node backend/crear-usuario.mjs`, una vez por usuario,
definiendo en la terminal `USUARIO_CORREO`, `USUARIO_NOMBRE`, `USUARIO_CLAVE` y
`USUARIO_ROL` (`gerente`, `admin`, `residente` o `empleado`). La clave no se pasa como argumento ni se versiona;
borrar las variables al terminar. Ejecutado así, sin `--env-file`, el script no lee `.env`;
aun así, la terminal no debe tener `DATABASE_URL` definida, para que el usuario se cree en la
base local y no en la remota. Ver [SPRINT2_AUTH.md](SPRINT2_AUTH.md).

1. Arrancar con `DEMO_DATA=false npm start`. Como gerente o admin, crear un contrato y
   comprobar que el bloque **Entrega** dice **Sin programar**.
2. Pulsar **Programar entrega** con los campos vacíos: deben aparecer los mensajes de
   cada campo y no guardarse nada.
3. Poner una hora final igual o anterior a la de inicio: debe aparecer el mensaje y no guardarse nada.
4. Programar con fecha, ventana y transportista válidos: debe decir **Programada** con esos datos.
5. Copiar el enlace del contrato, abrirlo en otra pestaña o en el teléfono y comprobar que sigue **Programada**.
6. Reprogramar con otra ventana u otro transportista y comprobar el cambio.
7. Escribir un transportista como `<b>x</b>` y comprobar que se ve como texto.
8. Como residente, abrir el mismo contrato: debe verse el estado, pero no el formulario.
9. Como empleado, abrir el mismo contrato: debe verse el estado, pero no el formulario.
10. Revisar navegación con teclado, mensajes accesibles y presentación en pantalla pequeña.

## Orden obligatorio y ventana de despliegue

Lo ejecuta Kevin, con Iván avisado. Un push a `main` dispara el despliegue a producción.
`main` usa trece tablas (las 8 previas y 5 del portal de Iván); con esta HU quedan 14.

El arranque revisa la base y es estricto en ambos sentidos: si el código espera una tabla
que no existe, o la base tiene una tabla que el código no conoce, no arranca. Primero ver el
estado de Supabase con `npm run db:inspect` (solo lee) y contar `appTables`.

### Caso A: 8 tablas

El portal de Iván todavía no se aplicó; el despliegue de `main`, si corrió, falló y sigue
publicada la versión anterior.

1. Coordinar con Iván. Ejecutar `npm run db:portal` desde esta rama: crea las tablas del
   portal y `entrega_programada` (`--demo` solo si el equipo lo decide).
2. `npm run db:verify`.
3. Con el PR aprobado: fusionar de inmediato y seguir el job `deploy` hasta que
   `/api/health` responda.

La migración `20261026_hu9a.sql` **no** se aplica en este caso. Se espera la misma ventana
que en el caso B (no se probó aparte). El rollback afecta a las tablas del portal:
coordinarlo con Iván.

### Caso B: 13 tablas

El portal ya se aplicó y `main` ya está desplegado.

1. Con el PR aprobado: aplicar `database/migrations/20261026_hu9a.sql` **con el mismo
   usuario de `DATABASE_URL`** (o `npm run db:portal` desde esta rama: es idempotente y deja
   la misma tabla).
2. `npm run db:verify` desde esta rama.
3. Fusionar de inmediato y seguir el job `deploy`.

**Ventana:** entre el paso 1 y el fin del despliegue, el código publicado (el `main`
anterior) no arranca si se reinicia (`PRIVATE_SCHEMA_REVIEW_REQUIRED`); la instancia ya
encendida sigue funcionando.

**Rollback**, mientras la tabla esté vacía: `DROP TABLE constructora_private.entrega_programada;`.
Con eso el código anterior vuelve a arrancar.

### Si `db:verify` falla

Si `npm run db:verify` falla con `UNSAFE_EXISTING_DATABASE_ACCESS`, **no se fusiona ni se
fuerza nada**. Se avisa al equipo y se revisa con `npm run db:inspect` quién es el dueño de
`entrega_programada` comparado con las demás tablas. El arranque exige que las tablas
pertenezcan al mismo usuario de `DATABASE_URL`.

## Fuera de alcance

- HU9b (notificación de entrega al transportista, de Víctor) no está incluida. Puede usar
  la tabla `entrega_programada` y las rutas `POST /api/entregas` y `GET /api/contratos/:id/entrega`.
- No hay campos de contacto del conductor (teléfono, correo ni similares).

## Qué se probó

Las pruebas automáticas del repo usan solo PGlite. Además, el arranque y la migración se
comprobaron a mano, fuera del repo, contra PostgreSQL 16.15 real (no Supabase), con el código
de esta rama ya integrado con main:

- Caso A (base con 8 tablas, preparada con el código anterior al portal): el código
  integrado no arranca (DATABASE_SCHEMA_NOT_READY). Tras ejecutar la preparación del portal
  quedan 14 tablas y el código integrado arranca. `entrega_programada` queda con RLS y
  0 privilegios para anon, authenticated y service_role.
- Caso B (base con las 13 tablas de main): main arranca. El código integrado sin migrar no
  arranca (DATABASE_SCHEMA_NOT_READY). Con `20261026_hu9a.sql` arranca. Con la tabla ya
  creada, el main anterior no arranca (PRIVATE_SCHEMA_REVIEW_REQUIRED). Un DROP TABLE de la
  tabla vacía devuelve al main anterior a arrancar. La tabla creada por la migración es
  idéntica (mismas restricciones) a la que crea la preparación del portal, que también se
  probó sobre las 13 tablas y es idempotente.
- Antes de integrar con main, y sobre el código de la rama: repetir la migración no rompe
  nada, y dos conexiones programando el mismo contrato a la vez se serializan (una responde
  201, la otra 200, y queda una sola fila).
- A 390 px de ancho, medido con Playwright y un viewport real, fuera del repo y antes de
  integrar con main: el bloque Entrega no desbordaba.

`db:inspect` se probó igual, solo con las funciones, y cuenta 8 tablas en el caso A y 13 en
el caso B.

Esas comprobaciones no están en el repo y el equipo no puede repetirlas con un comando.

## Qué NO se probó

- Supabase real: ni db:portal, ni la migración, ni db:verify contra Supabase.
- Un dispositivo móvil real y eventos táctiles: solo se usó un viewport emulado de 390 px.
- Un lector de pantalla: se revisaron los atributos ARIA, no la lectura real.
- Pruebas de navegador dentro del repo: no hay; la verificación manual del desarrollador
  se hizo con el Chromium integrado de la herramienta de desarrollo. Su ancho de pantalla
  era de 441 px por el escalado del panel, así que no se usó para medir 390 px.
- El CI de GitHub con Node 24: las pruebas pasaron en local y en otro entorno, pero no se
  vio el resultado del CI.

## Observaciones ajenas a este PR (para el equipo)

- Antes de integrar con main, a 390 px de ancho la barra de pestañas (`a.nav-tab`)
  desbordaba unos 51 px, y pasaba igual en main sin este cambio. El bloque Entrega no
  desbordaba. No se volvió a medir tras la integración con la plataforma multirrol.
- Aplicar una migración o db:portal antes del despliegue deja una ventana en la que el
  código publicado no arranca. Es consecuencia de que el arranque exija que el esquema
  coincida exactamente; conviene considerarlo en la deuda técnica del Sprint 4.
