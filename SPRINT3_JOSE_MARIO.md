# Sprint 3 - HU2: funciones y permisos según el rol

Responsable: José Mario Sandoval. Tarjeta 11. Fecha: 22/10/2026.

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
| Consultar cobros y registrar pagos | No | Sí |
| Aprobar gastos | No | Sí, permiso reservado |
| Autorizar modificaciones de contratos | No | Sí, permiso reservado |

Supuestos: README, documentos de sprints y ADR revisados no definen una matriz
más específica. Se aplica la propuesta de HU2. Reservar cobros y pagos al gerente
es un supuesto de esta historia, pendiente de aceptación del Product Owner.
Consultar un contrato conserva sus campos existentes de saldo y estado de pago;
la restricción corresponde al panel/listado de cobros y al registro de pagos.
Crear un contrato o elegir su forma de pago no registra dinero recibido, no
aprueba gastos ni autoriza modificaciones.

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
tampoco después de crear contratos; `#cobros` muestra un aviso y vuelve a una
sección permitida. Un 403 muestra el aviso de permisos sin cerrar la sesión;
un 401 conserva la redirección al login.

## Validación

`npm test` se ejecutó, pero el entorno rechaza la creación de procesos con
`spawn EPERM`. Se ejecutó la misma suite completa con la alternativa que ya
documenta el README, sin modificar el script ni desactivar la autorización:

```sh
node --test --test-isolation=none backend/*.test.mjs
```

Resultado integrado: **165 pruebas aprobadas, 0 fallidas, 0 omitidas** (138 s).
Incluye 11 pruebas nuevas de permisos backend y 14 de interfaz, además de la
regresión de autenticación, recuperación, reservas, contratos, PDF, firma y pagos.
Las pruebas nuevas de backend usan `requireAuth: true`, sesiones reales y PGlite
temporal explícito, sin leer `.env` ni conectarse a PostgreSQL remoto. Verifican
401/403, roles falsificados, cambios de rol en BD, ausencia de consultas/escrituras
tras un rechazo, permisos omitidos y métodos/rutas exactos.

Las pruebas UI ejecutan los módulos reales con `node:vm` y un DOM simulado, sin
dependencias nuevas: controles ocultos, espera de sesión, solicitudes iniciales
y posteriores a crear contratos, hash restringido, pago separado de consulta,
401/403, cierre y restauración desde historial. Sintaxis de módulos y comprobación
del diff correctas (considerando finales de línea de Windows). No hubo navegador
disponible para validar visualmente diseño, teclado o celular; esa revisión queda
en los pasos manuales siguientes.

Archivos de HU2: `backend/permisos.mjs` (matriz y registro de rutas),
`backend/auth.mjs` (sesión y guardia), `backend/app.mjs` (despacho autorizado),
`frontend/sesion.js`, `frontend/index.html`, `frontend/app.js`,
`frontend/alertas.js` y `frontend/cobros.mjs` (vistas y solicitudes por permiso),
`backend/permisos.test.mjs`, `backend/permisos-frontend.test.mjs` y este documento.

## Demostración local

1. Usar una terminal nueva para separar esta demostración de otras configuraciones.
   Establecer `$env:DATABASE_URL=''`, `$env:DATA_DIR='data/hu2-demo'`,
   `$env:NODE_ENV='development'`, `$env:HOST='127.0.0.1'`, `$env:PORT='3000'` y
   `$env:APP_URL='http://127.0.0.1:3000'`. Ejecutar los comandos siguientes sin
   `--env-file` para no cargar la conexión remota de `.env`.
2. Crear dos usuarios con `node backend/crear-usuario.mjs`, definiendo antes
   `USUARIO_CORREO`, `USUARIO_NOMBRE`, `USUARIO_CLAVE` y `USUARIO_ROL` según
   `SPRINT2_AUTH.md`. Usar correos locales distintos y roles `residente` y
   `gerente`. Elegir claves de prueba de al menos ocho caracteres sin guardarlas
   en Git y retirar `USUARIO_CLAVE` de la terminal después de crear las cuentas.
3. Ejecutar `node backend/server.mjs` y abrir `http://127.0.0.1:3000`.
   Ingresar como residente: ver Catálogo, Contrato y Alertas; Cobros no aparece.
   Abrir `/#cobros`: aparece aviso y vuelve al catálogo. Crear un contrato para
   un período libre, consultar sus cláusulas, firmar y descargar el PDF.
4. Desde la consola del navegador del residente, ejecutar
   `fetch('/api/cobros').then(async r => [r.status, await r.json()])` y repetir con
   `fetch('/api/contratos/ID/pagos', {method:'POST', headers:{'Content-Type':'application/json','rol':'gerente'}, body:JSON.stringify({monto:'1.00',rol:'gerente'})})`,
   sustituyendo `ID` por el contrato creado: ambas solicitudes devuelven 403 y
   no registran pagos. El aviso no redirige al login.
5. Cerrar sesión e ingresar como gerente: Cobros muestra el contrato. Registrar
   un abono y comprobar el nuevo saldo; liquidarlo y verificar que sale del
   listado. Sin sesión o con una sesión vencida, las API protegidas devuelven 401.
   Revisar también navegación con teclado y tamaño de celular.

## Dependencias pendientes

No existen módulos, tablas ni rutas específicas para aprobar gastos o autorizar
modificaciones de contratos en esta versión. Se reservan `gastos.aprobar` y
`contratos.modificaciones.autorizar` exclusivamente al gerente. Sus futuras
operaciones deberán incorporarse explícitamente al registro de rutas y probarse
con ambos roles. Estos dos flujos no se implementaron ni se declaran validados.
La aceptación del supuesto de cobros y la revisión del equipo/PO permanecen
pendientes. No se cambiaron esquemas, bases remotas ni dependencias. La entrega
se versiona en la rama `jose`; no incluye despliegue.
