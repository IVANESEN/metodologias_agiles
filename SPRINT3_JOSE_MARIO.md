# Sprint 3 - HU2: funciones y permisos según el rol

Responsable: José Mario Sandoval. Tarjeta 11. Fecha inicial: 22/10/2026.
Revisión y entrega en `victo`: 26/10/2026.

## Base de trabajo e integración

Se leyeron README, documentos de sprints y ADR; no se encontraron archivos
`AGENTS.md`. El repositorio corresponde a `IVANESEN/metodologias_agiles` y el
árbol inicial estaba limpio en `main`. Después de `git fetch origin` se comprobó
que no existían `victo` ni `origin/victo`; `victor` es una rama diferente. Se
informó esa situación antes de crear `victo` desde `origin/main`, commit
`2f9b92ebe538c530336d9a9b6019c94cd9af8a00`. La rama nueva no sigue `origin/main`.

La base ya contiene HU2 (`04d2f37`, integrada por PR #17), autenticación y
recuperación, cobros, recepción de Mariela, entregas de Kevin y el portal de Iván.
Se conserva esa implementación y sus permisos. Esta entrega completa accesos
directos de interfaz y regresiones de autorización; no rehace esas historias.
Los aportes anteriores ya están en `origin/main`, por lo que no se vuelven a
introducir como diferencias del futuro PR `victo` → `main`.

## Alcance y matriz

La sesión identifica al usuario y su rol vigente en `usuario`. El backend
centraliza la matriz en `backend/permisos.mjs` y entrega los permisos mediante
`GET /api/auth/sesion`; la interfaz no mantiene otra matriz por rol.

| Función | Residente | Gerente |
| --- | --- | --- |
| Consultar catálogo, disponibilidad y fechas ocupadas | Sí | Sí |
| Crear y consultar contratos | Sí | Sí |
| Consultar documento y descargar PDF | Sí | Sí |
| Usar la firma simulada existente | Sí | Sí |
| Consultar alertas de vencimiento | Sí | Sí |
| Crear y consultar recepciones de maquinaria (HU10) | Sí | Sí |
| Consultar programación de entrega (HU9a) | Sí | Sí |
| Programar o reprogramar entrega (HU9a) | No | Sí |
| Consultar cobros y registrar pagos | No | Sí |
| Aprobar gastos | No | Sí, permiso reservado |
| Autorizar modificaciones de contratos | No | Sí, permiso reservado |

Supuestos: se conserva la propuesta documentada de HU2. Reservar cobros y pagos al gerente
es un supuesto de esta historia, pendiente de aceptación del Product Owner.
Consultar un contrato conserva sus campos existentes de saldo y estado de pago;
la restricción corresponde al panel/listado de cobros y al registro de pagos.
Crear un contrato o elegir su forma de pago no registra dinero recibido, no
aprueba gastos ni autoriza modificaciones.

Se conservan las ampliaciones documentadas por HU9a y Sprint 4: `admin` hereda
los permisos de gerente; `empleado` comparte las funciones de obra y consulta
entregas, sin programarlas ni registrar pagos. `cliente` y `proveedor` utilizan
el portal y no adquieren permisos de obra. Esta revisión no concede permisos
nuevos. El supuesto de programación de entregas también está pendiente de
confirmación del Product Owner, según `SPRINT3_KEVIN.md`.

## API protegida

| Método y ruta | Permiso |
| --- | --- |
| `GET /api/maquinaria` | `maquinaria.consultar` |
| `GET /api/reservas/ocupadas` | `maquinaria.consultar` |
| `POST /api/contratos` | `contratos.crear` |
| `GET /api/contratos/:id` | `contratos.consultar` |
| `GET /api/contratos/:id/documento` | `contratos.documento` |
| `GET /api/contratos/:id/pdf` | `contratos.pdf` |
| `POST /api/contratos/:id/firma` | `contratos.firmar` |
| `GET /api/contratos/por-vencer` | `alertas.consultar` |
| `GET /api/cobros` | `cobros.consultar` |
| `POST /api/contratos/:id/pagos` | `pagos.registrar` |
| `POST /api/recepciones` | `recepciones.crear` |
| `GET /api/contratos/:id/recepciones` | `recepciones.consultar` |
| `POST /api/entregas` | `entregas.programar` |
| `GET /api/contratos/:id/entrega` | `entregas.consultar` |

Cada operación exige registrar método, ruta completa y permiso. La autorización
ocurre antes de leer el cuerpo o consultar/escribir datos de negocio. Un permiso
omitido o desconocido no concede acceso; no hay autorización por prefijo de
contratos. Tras validar la sesión, las rutas inexistentes devuelven 404 y los
métodos incorrectos en rutas conocidas, 405. Los identificadores inválidos
conservan sus errores 400.

Sin sesión válida: `401 UNAUTHENTICATED`. Con sesión sin permiso:
`403 FORBIDDEN`, con `error.code` y `error.message`. El rol enviado por body,
query, cabeceras o navegador no concede privilegios. Se conservan las rutas
públicas de login, recuperación, restablecimiento y health, cookies, validación
de origen, cierre de sesión y `Cache-Control: no-store` para datos privados.
`backend/server.mjs` sigue iniciando con `requireAuth: true`; el valor por defecto
del servidor de pruebas se conserva para pruebas históricas de negocio.

La interfaz espera la sesión antes de inicializar paneles y solicitudes. Los
controles sujetos a permisos comienzan ocultos. Un residente no carga Cobros,
tampoco después de crear contratos; `#cobros` y los enlaces a sus controles o
descendientes muestran un aviso y vuelven a una sección permitida, incluyendo
identificadores codificados en la URL. Un 403 muestra el aviso sin cerrar la sesión;
un 401 conserva la redirección al login.

## Validación

`npm test` se ejecutó, pero el entorno rechaza la creación de procesos con
`spawn EPERM`. Se ejecutó la misma suite completa con la alternativa que ya
documenta el README, sin modificar el script ni desactivar la autorización:

```sh
node --test --test-isolation=none backend/*.test.mjs
```

Resultados del 26/10/2026 con Node.js 24.21.0:

- Suite completa final: **217 aprobadas, 0 fallidas, 0 omitidas** (97 s).
- `node --test --test-isolation=none backend/permisos.test.mjs`: **14/14**.
- `node --test --test-isolation=none backend/permisos-frontend.test.mjs`: **23/23**.
- `node --check` en todos los `.js` y `.mjs` versionados y `git diff --check`:
  correctos.

Se añaden tres regresiones backend y siete de interfaz a las pruebas heredadas.
El backend usa `requireAuth: true`, sesiones reales y PGlite temporal explícito,
sin leer `.env` ni conectarse a PostgreSQL remoto. Verifica 401/403, login y
registro con roles falsificados, cookies inválidas o duplicadas, sesión revocada,
cambios de rol en BD, permisos omitidos y métodos/rutas exactos. Los rechazos
ocurren antes de consultas/transacciones de negocio y conservan pagos, contratos
y entregas. La suite completa incluye autenticación, recuperación, contratos,
reservas, cobros, PDF, firma, recepción, entregas y portal.

Las pruebas UI ejecutan los módulos reales con `node:vm` y un DOM simulado, sin
dependencias nuevas: controles ocultos, espera de sesión, solicitudes iniciales
y posteriores a crear contratos, hash restringido, pago separado de consulta,
401/403, cierre y restauración desde historial. Se prueban enlaces iniciales y
`hashchange` a descendientes de una sección, fragmentos codificados o malformados
y navegación permitida del gerente. No se ejecutó revisión visual en navegador,
con teclado ni en celular; queda en los pasos manuales siguientes.

Archivos heredados de HU2: `backend/permisos.mjs` (matriz y registro de rutas),
`backend/auth.mjs` (sesión y guardia), `backend/app.mjs` (despacho autorizado),
`frontend/sesion.js`, `frontend/index.html`, `frontend/app.js`,
`frontend/alertas.js` y `frontend/cobros.mjs` (vistas y solicitudes por permiso),
`backend/permisos.test.mjs`, `backend/permisos-frontend.test.mjs` y este documento.

Modificados en esta entrega: `frontend/sesion.js`, ambas pruebas de permisos,
`README.md` y este documento; se añade `doc/PR_SPRINT3_HU2.md` con el título y la
descripción preparados. No se modifica la matriz existente, el esquema ni login.

## Demostración local

1. Usar una terminal nueva para separar esta demostración de otras configuraciones.
   Establecer `$env:DATABASE_URL=''`, `$env:DATA_DIR='data/hu2-demo'`,
   `$env:NODE_ENV='development'`, `$env:HOST='127.0.0.1'`, `$env:PORT='3000'`,
   `$env:APP_URL='http://127.0.0.1:3000'` y `$env:DEMO_DATA='false'`.
   Ejecutar los comandos siguientes sin
   `--env-file` para no cargar la conexión remota de `.env`.
2. Crear dos usuarios con `node backend/crear-usuario.mjs`, definiendo antes
   `USUARIO_CORREO`, `USUARIO_NOMBRE`, `USUARIO_CLAVE` y `USUARIO_ROL` según
   `SPRINT2_AUTH.md`. Usar correos locales distintos y roles `residente` y
   `gerente`. Elegir claves de prueba de al menos ocho caracteres sin guardarlas
   en Git y retirar `USUARIO_CLAVE` de la terminal después de crear las cuentas.
3. Ejecutar `node backend/server.mjs` y abrir `http://127.0.0.1:3000`.
   Ingresar como residente: ver Catálogo, Contrato, Alertas y Recepción; Cobros no aparece.
   Abrir `/#cobros`, `/#cobros-title` y `/#%63obros-list`: aparece aviso y vuelve
   al catálogo; no se solicita `/api/cobros`. Crear un contrato para
   un período libre, consultar sus cláusulas, firmar y descargar el PDF. Puede
   consultar la entrega pero no ve el formulario para programarla.
4. Desde la consola del navegador del residente, ejecutar
   `fetch('/api/cobros').then(async r => [r.status, await r.json()])` y repetir con
   `fetch('/api/contratos/ID/pagos', {method:'POST', headers:{'Content-Type':'application/json','rol':'gerente'}, body:JSON.stringify({monto:'1.00',rol:'gerente'})})`,
   sustituyendo `ID` por el contrato creado: ambas solicitudes devuelven 403 y
   no registran pagos. El aviso no redirige al login.
5. Cerrar sesión e ingresar como gerente: Cobros muestra el contrato. Los enlaces
   a su título y controles permanecen permitidos. Registrar
   un abono y comprobar el nuevo saldo; liquidarlo y verificar que sale del
   listado. El formulario de programación de entregas también es visible. Sin
   sesión o con una sesión vencida, las API protegidas devuelven 401.
   Revisar también navegación con teclado y tamaño de celular.

## Dependencias pendientes

No existen módulos, tablas ni rutas específicas para aprobar gastos o autorizar
modificaciones de contratos en esta versión. Entre residente y gerente, se reservan
`gastos.aprobar` y `contratos.modificaciones.autorizar` al gerente; `admin` los
hereda por la matriz de Sprint 4. Sus futuras
operaciones deberán incorporarse explícitamente al registro de rutas y probarse
con ambos roles. Estos dos flujos no se implementaron ni se declaran validados.
La aceptación del supuesto de cobros y la revisión del equipo/PO permanecen
pendientes. No se cambiaron esquemas, bases remotas ni dependencias. La entrega
se prepara en la rama `victo`, con destino futuro `main`; no incluye despliegue.
