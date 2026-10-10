
# Constructora El Salvador

Sistema de alquiler de maquinaria. Incluye HU3 (consulta por tipo, fechas y ciudad) y contratos con una o varias máquinas.

Sprint 1 también incluye reserva por fechas (HU8), formalización del contrato
(HU6a), descarga de PDF (HU6b) y firma simulada desde el teléfono (HU7).
Ver [SPRINT1_KEVIN.md](SPRINT1_KEVIN.md) para el alcance, API y pruebas de la firma.

## Ejecutar y probar

Requiere Node.js 24.

```sh
npm ci
npm test
npm start
```
si lo tienes instalado
```sh
npm.cmd start
```

Abrir `http://localhost:3000`. En desarrollo, sin `DATABASE_URL`, se usa PostgreSQL embebido (PGlite) y los datos se conservan en `data/`. En producción se requiere `DATABASE_URL` de PostgreSQL. El inicio aplica el esquema y sus cambios de forma idempotente; conserva los equipos y contratos existentes.

## Selección y contratos

- **Seleccionar** agrega una máquina al contrato. El mismo botón cambia a **Deseleccionar** para retirarla.
- El resumen permite quitar cada máquina o deseleccionar todas. Se puede seguir buscando por otros tipos o ciudades sin perder los equipos elegidos.
- Todas las máquinas de un contrato comparten cliente, ciudad y fechas. Las fechas de la búsqueda se copian al contrato al elegir el primer equipo; agregar otro no cambia ese período.
- La tarifa diaria del contrato suma las tarifas de las máquinas. El total multiplica esa suma por los días de alquiler, incluyendo inicio y fin.
- Se genera un solo número de contrato. Antes de guardar se comprueba cada equipo; si alguno no existe, está inhabilitado o ya está ocupado, se rechaza toda la operación y no se crean reservas parciales.
- Los contratos históricos de una máquina se conservan. Al iniciar se prepara de forma idempotente su detalle en `contrato_maquinaria`, manteniendo los nombres y tarifas pactados.

La interfaz envía una lista de identificadores únicos, sin tarifas proporcionadas por el cliente:

```json
{
  "maquinaria_ids": [1, 2],
  "cliente": "Cliente de ejemplo",
  "ciudad": "Santa Ana",
  "fecha_inicio": "2027-02-10",
  "fecha_fin": "2027-02-12"
}
```

`POST /api/contratos` sigue aceptando `maquinaria_id` para los clientes anteriores que alquilan una sola máquina. No se envían ambos formatos juntos. `POST` y `GET /api/contratos/:id` devuelven `maquinarias`, con `maquinaria_id`, `maquinaria_nombre`, `tarifa_diaria` y `total` para cada línea. Este detalle es la fuente para mostrar todos los equipos o generar documentos. Los campos históricos `maquinaria_id` y `maquinaria_nombre` del encabezado identifican el primer equipo, ordenado por ID; `tarifa_diaria` y `total` del encabezado representan el contrato completo.

## Consulta de maquinaria (HU3)

- Tipo y ciudad son opcionales. Los nombres se comparan completos sin distinguir mayúsculas y con espacios exteriores eliminados.
- Las fechas son opcionales como pareja: se ingresan ambas o ninguna. La fecha final puede ser igual a la inicial y debe representar una fecha real.
- Sin fechas, el catálogo muestra equipos habilitados; para comprobar disponibilidad de un período se deben ingresar sus fechas.
- Con fechas, se excluyen equipos con contratos confirmados que se solapen con cualquier día solicitado. Inicio y fin se incluyen: un contrato del 10 al 12 ocupa también el 12; el 13 queda libre.
- `disponible` es la habilitación general del equipo. Crear un contrato no cambia este indicador; bloquea únicamente su intervalo. Los dos equipos de ejemplo comienzan habilitados.
- La ciudad se captura al crear el contrato y se conserva en él. En la maquinaria se guarda como referencia la ciudad del último contrato registrado, no como seguimiento de su posición física ni como calendario de ubicaciones.
- No se asignan ciudades inventadas a los equipos iniciales. Se muestran como **Ciudad por definir** y se incluyen al buscar cualquier ciudad mientras no tengan una registrada.
- Una consulta de disponibilidad no reserva el equipo. El servidor vuelve a comprobar posibles conflictos al guardar el contrato.

Ejemplo de consulta:

```text
GET /api/maquinaria?disponible=true&tipo=Excavadora&ubicacion=San%20Salvador&fecha_inicio=2027-01-10&fecha_fin=2027-01-12
```

El endpoint sin parámetros conserva el catálogo completo para compatibilidad. `ubicacion` contiene la ciudad de referencia de la maquinaria. Un rango inválido devuelve HTTP 400 con errores de campo. Una consulta válida sin coincidencias devuelve HTTP 200 y una lista vacía.

Los nuevos contratos incluyen `ciudad` (2 a 100 caracteres) en el cuerpo de `POST /api/contratos`. Los contratos históricos sin ese campo permanecen legibles con `ciudad: null`. La ciudad del contrato y la referencia de la maquinaria se guardan en la misma transacción.

## Revisión manual de HU3

Usar datos de prueba en una base local o de pruebas; las reservas de prueba no deben crearse en producción.

| Caso | Resultado esperado |
| --- | --- |
| Abrir el catálogo inicial | CAT 336 y JCB 3CX habilitadas, con Ciudad por definir. |
| Filtrar tipo Excavadora | Solo CAT 336. |
| Buscar una ciudad sin equipos con ciudad registrada | Se incluyen los equipos con ciudad por definir. |
| Ingresar solo una fecha o fin anterior a inicio | Mensaje claro y consulta bloqueada. |
| Consultar inicio y fin iguales | Consulta válida para un día. |
| Contratar CAT 336 del 10 al 12 de enero de 2027, ciudad San Salvador | Confirmación y contrato recuperado muestran la ciudad. |
| Consultar CAT 336 del 11 al 12 o únicamente el 12 | No aparece disponible. |
| Consultar CAT 336 únicamente el 13 | Aparece disponible. |
| Consultar por San Salvador luego de ese contrato | CAT 336 coincide; se siguen incluyendo equipos sin ciudad. |
| Consultar otra ciudad | CAT 336 no coincide; se siguen incluyendo equipos sin ciudad. |
| Combinar tipo, ciudad y fechas sin coincidencias | Mensaje de búsqueda sin resultados. |
| Limpiar filtros | Se restaura el catálogo habilitado y los campos vacíos. |
| Seleccionar una excavadora y buscar retroexcavadoras | La excavadora permanece en el resumen para poder añadir otra máquina. |
| Otro cliente reserva durante la consulta | Al intentar guardar se muestra el conflicto y se actualiza el catálogo. |
| Navegar con teclado y en celular | Controles, mensajes y tarjetas legibles y utilizables. |

## Revisión de selección múltiple

Usar una base de pruebas y un período libre para todos los equipos.

| Caso | Resultado esperado |
| --- | --- |
| Seleccionar CAT 336 y volver a pulsar su botón | Se deselecciona; el resumen y total se actualizan. |
| Elegir las dos máquinas y quitar una desde el resumen | Solo queda la otra, con su tarifa correspondiente. |
| Pulsar Deseleccionar todas | El resumen queda vacío y Generar contrato se deshabilita. |
| Elegir las dos máquinas del 10 al 12 de febrero de 2027 | Tarifa conjunta de $725 diarios y total de $2,175. |
| Confirmar las dos máquinas | Un solo número de contrato, dos líneas y la misma ciudad y fechas. |
| Consultar disponibilidad durante ese contrato | Ninguna de sus dos máquinas aparece libre. |
| Consultar el 13 de febrero | Ambas aparecen disponibles si no existen otros contratos. |
| Intentar un contrato conjunto con una máquina ya ocupada | Se rechaza completo; no reserva la otra ni cambia sus ciudades. |
| Dos clientes intentan contratar grupos que comparten una máquina | Solo un contrato obtiene el equipo para el período coincidente. |
| Consultar un contrato histórico de una sola máquina | Se recuperan sus datos y una línea de maquinaria. |
| Cambiar ciudad, cliente o fechas y luego quitar un equipo | Se conservan los datos escritos y se recalcula el total. |

La revisión debe realizarla una persona distinta del autor (la estrategia del equipo propone a Mariela). Registrar caso, resultado esperado, resultado obtenido, responsable, fecha y evidencia. Para cerrar la historia también se requiere aceptación del Product Owner y verificación en el ambiente compartido.
