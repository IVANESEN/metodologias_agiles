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
- **Permisos:** solo el gerente programa (`entregas.programar`); residente y gerente
  consultan (`entregas.consultar`).

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

Resultado integrado del 26 de octubre de 2026: **191 pruebas aprobadas, 0 fallidas,
0 omitidas** (174 previas y 17 nuevas). Se ejecutó con `npm test` y usó únicamente bases
PGlite temporales o en memoria.

## Validación manual sugerida

Usar únicamente una base local o de pruebas, con un usuario gerente y uno residente.

**Cuidado con `.env`:** `npm start` y los scripts `db:*` cargan `.env` automáticamente
(`--env-file-if-exists=.env` en `package.json`). Si tu `.env` tiene la `DATABASE_URL` de
Supabase, la prueba manual correría contra la base remota. Antes de probar, renómbralo
temporalmente (por ejemplo a `.env.supabase`) o trabaja en otra copia del repositorio, y
devuélvelo a su nombre al terminar.

Antes de empezar, crear los dos usuarios con `node backend/crear-usuario.mjs`, una vez por
usuario, definiendo en la terminal `USUARIO_CORREO`, `USUARIO_NOMBRE`, `USUARIO_CLAVE` y
`USUARIO_ROL` (`gerente` o `residente`). La clave no se pasa como argumento ni se versiona;
borrar las variables al terminar. Ejecutado así, sin `--env-file`, el script no lee `.env`;
aun así, la terminal no debe tener `DATABASE_URL` definida, para que el usuario se cree en la
base local y no en la remota. Ver [SPRINT2_AUTH.md](SPRINT2_AUTH.md).

1. Como gerente, crear un contrato y comprobar que el bloque **Entrega** dice **Sin programar**.
2. Pulsar **Programar entrega** con los campos vacíos: deben aparecer los mensajes de
   cada campo y no guardarse nada.
3. Poner una hora final igual o anterior a la de inicio: debe aparecer el mensaje y no guardarse nada.
4. Programar con fecha, ventana y transportista válidos: debe decir **Programada** con esos datos.
5. Copiar el enlace del contrato, abrirlo en otra pestaña o en el teléfono y comprobar que sigue **Programada**.
6. Reprogramar con otra ventana u otro transportista y comprobar el cambio.
7. Escribir un transportista como `<b>x</b>` y comprobar que se ve como texto.
8. Como residente, abrir el mismo contrato: debe verse el estado, pero no el formulario.
9. Revisar navegación con teclado, mensajes accesibles y presentación en pantalla pequeña.

## Migración obligatoria antes de desplegar

Un push a `main` dispara el despliegue a producción. Si la tabla `entrega_programada` no
existe en Supabase, el servidor **no arranca** (`DATABASE_SCHEMA_NOT_READY`). Kevin debe
seguir este orden, sin saltarse pasos:

1. `npm run db:inspect` y revisar el inventario: proyecto correcto, ocho tablas existentes
   en `constructora_private` y todas protegidas. Solo lee, así que se puede hacer antes.
2. Con el PR ya aprobado y revisado, aplicar `database/migrations/20261026_hu9a.sql` en
   Supabase **con el mismo usuario de `DATABASE_URL`**. El arranque exige que las tablas
   pertenezcan a ese usuario.
3. Desde la rama `kevin`, ejecutar `npm run db:verify`.
4. Si pasa, fusionar de inmediato y seguir el job `deploy` en Actions hasta que
   `/api/health` responda.

Si `npm run db:verify` falla con `UNSAFE_EXISTING_DATABASE_ACCESS`, **no se fusiona ni se
fuerza nada**. Se avisa al equipo y se revisa con `npm run db:inspect` quién es el dueño de
`entrega_programada` comparado con las demás tablas.

`db:init` también podría preparar la tabla, pero este documento solo usa la migración manual.

### Ventana entre la migración y el despliegue

El arranque revisa la base y es estricto en ambas direcciones. Comprobado en PostgreSQL 16 real:

| Código publicado | Base | Resultado al arrancar |
| --- | --- | --- |
| Anterior | Sin migrar | Arranca |
| Nuevo | Sin migrar | No arranca (`DATABASE_SCHEMA_NOT_READY`) |
| Anterior | Migrada | No arranca (`PRIVATE_SCHEMA_REVIEW_REQUIRED`): el código anterior ve una tabla que no conoce |
| Nuevo | Migrada | Arranca |

El chequeo corre solo al arrancar (`backend/server.mjs`). Una instancia ya encendida sigue
funcionando, pero un reinicio o un arranque en frío fallaría hasta que termine el despliegue
nuevo. Por eso la migración se aplica con el PR ya aprobado y se fusiona de inmediato.

**Rollback**, si el despliegue falla antes de terminar: ejecutar
`DROP TABLE constructora_private.entrega_programada;`, **solo mientras la tabla esté vacía**.
Con eso el código anterior vuelve a arrancar (comprobado).

## Fuera de alcance

- HU9b (notificación de entrega al transportista, de Víctor) no está incluida. Puede usar
  la tabla `entrega_programada` y las rutas `POST /api/entregas` y `GET /api/contratos/:id/entrega`.
- No hay campos de contacto del conductor (teléfono, correo ni similares).

## Qué NO se probó

- PostgreSQL o Supabase reales: todas las pruebas usaron PGlite.
- Un dispositivo móvil real y eventos táctiles: solo se usó un viewport emulado de 390 px.
- Un lector de pantalla: se revisaron los atributos ARIA, no la lectura real.
- Playwright: la verificación en navegador se hizo con el Chromium integrado de la
  herramienta de desarrollo.
