# Sprint 1 - HU7: firma simulada desde el teléfono

Responsable según backlog: Kevin Landos.

## Criterios de aceptación

1. Almacenar la firma y vincularla permanentemente al contrato: se guardan los
   trazos en `contrato.firma` (JSONB) y la fecha del servidor en
   `contrato.firmado_en`. La consulta por ID recupera ambos. No se permite
   reemplazar una firma guardada.
2. Impedir envío con el lienzo vacío: el botón Guardar firma se habilita cuando
   existe un trazo visible. La API verifica la misma condición aunque se envíe
   una petición manual, y rechaza puntos idénticos o un clic sin trazo.

## Uso

1. Ejecutar con Node.js 24: `npm ci`, `npm test` y `npm start`.
2. Abrir `http://localhost:3000`, seleccionar una o varias máquinas y completar
   los datos del contrato como en el flujo existente.
3. Generar el contrato y revisar sus cláusulas. Dibujar en el recuadro con dedo,
   lápiz o ratón. Limpiar permite repetir el dibujo antes de guardarlo.
4. Pulsar Guardar firma. Se muestra la firma guardada y su fecha en hora de
   El Salvador. Los controles para cambiarla desaparecen.
5. Descargar PDF: incluye los mismos trazos y la fecha persistidos.
6. Conservar el enlace que aparece en la confirmación. Al abrirlo o recargarlo
   se recuperan el mismo contrato, sus máquinas y su firma sin crear reservas.

El lienzo conserva sus coordenadas al cambiar el tamaño de la pantalla. Los
eventos Pointer Events permiten dedo, lápiz y ratón; solo el recuadro evita el
desplazamiento táctil durante el dibujo.

Para probar en un teléfono físico, usar la dirección del ambiente compartido.
En desarrollo local, conectar PC y teléfono a la misma red y abrir
`http://IP-DE-LA-PC:3000`. `localhost` en el teléfono apunta al propio teléfono.
El servidor existente escucha en `0.0.0.0`; la red y el firewall deben permitir
acceso a ese puerto. Generar el enlace desde esa dirección para conservar un
host accesible desde el celular.

## API

`POST /api/contratos/:id/firma`, con `Content-Type: application/json`:

```json
{
  "firma": {
    "ancho": 600,
    "alto": 240,
    "trazos": [
      [[30, 160], [80, 60], [60, 180], [150, 120]]
    ]
  }
}
```

Cada punto es `[x, y]`. Se aceptan hasta 100 trazos y 4000 puntos en total,
dentro de 600 × 240, con coordenadas finitas normalizadas a un decimal. El
límite del cuerpo de esta ruta es 128 KiB. Los demás endpoints conservan 16 KiB.

Respuesta `200`: `contrato_id`, `firma` y `firmado_en`. La fecha no la fija el
cliente. Reenviar la misma firma devuelve la firma y fecha originales; permite
recuperarse de una conexión perdida sin duplicar ni cambiar datos.

| Caso | Respuesta |
| --- | --- |
| Firma vacía, invisible o mal formada | `400 VALIDATION_ERROR`, con `error.fields.firma` |
| ID mal formado | `400 INVALID_ID` |
| Contrato inexistente | `404 CONTRACT_NOT_FOUND` |
| Otra firma para un contrato ya firmado | `409 CONTRACT_ALREADY_SIGNED` |
| Cuerpo excesivo | `413 BODY_TOO_LARGE` |
| Tipo de contenido incorrecto | `415 CONTENT_TYPE` |
| Método distinto de POST para la ruta de firma | `405 METHOD_NOT_ALLOWED` |

La actualización condicional `WHERE firma IS NULL` evita reemplazos con
peticiones simultáneas, tanto en PostgreSQL como en PGlite. La migración agrega
columnas opcionales sin borrar contratos anteriores. Se ejecuta automáticamente
al iniciar; no hay dependencias nuevas ni cambios en el cálculo o bloqueo de
reservas. El PDF dibuja los trazos guardados como vectores.

## Validación realizada

- Suite completa: 53 pruebas aprobadas, 0 fallidas.
- HU7: lienzo vacío, formato, límites, ID, métodos, guardado, integridad del
  contrato, reintento, concurrencia, migración repetida, reinicio y PDF.
- Interfaz: creación con dos máquinas, habilitar Guardar al dibujar, Limpiar,
  guardado, recuperación por enlace y recarga con viewport de 390 × 844.
- Se utilizó una base local de demostración separada. No se modificó el ambiente
  compartido del equipo. La prueba en teléfono físico queda para la revisión
  conjunta; se verificó el diseño móvil en navegador, no hardware táctil real.

Comando ejecutado en el entorno de verificación:

```sh
node --test --test-isolation=none backend/*.test.mjs
```

Se deshabilitó el aislamiento de procesos porque el entorno de ejecución
rechazaba `spawn` con EPERM. El comando ejecuta todos los archivos que incluye
`npm test`, sin omitir pruebas. El script habitual `npm test` se conserva.

## Revisión del equipo antes de marcar Done

| Paso | Resultado esperado |
| --- | --- |
| Generar contrato y no dibujar | Guardar firma permanece deshabilitado |
| Dibujar y pulsar Limpiar | Lienzo limpio y guardado deshabilitado |
| Firmar en un teléfono | Dibujo y controles utilizables sin desplazarse al dibujar |
| Guardar y recargar el enlace | Misma firma, mismo contrato y misma fecha |
| Descargar el PDF | Firma legible junto al cliente y fecha de registro |
| Abrir en otra sesión | Se recupera la firma y no se permite reemplazarla |
| Probar una falla de conexión y reintentar | Dibujo conservado y fecha original si ya se guardó |

Registrar responsable, fecha y evidencia de esa revisión y obtener la aceptación
del Product Owner, siguiendo el proceso que ya describe el README del equipo.
