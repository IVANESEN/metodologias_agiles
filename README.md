
# Constructora El Salvador

Sistema de alquiler de maquinaria. Esta entrega implementa HU3: consulta de maquinaria disponible por tipo, fechas y ciudad.

## Ejecutar y probar

Requiere Node.js 24.

```sh
npm ci
npm test
npm start
```

Abrir `http://localhost:3000`. En desarrollo, sin `DATABASE_URL`, se usa PostgreSQL embebido (PGlite) y los datos se conservan en `data/`. En producción se requiere `DATABASE_URL` de PostgreSQL. El inicio aplica el esquema y sus cambios de forma idempotente; conserva los equipos y contratos existentes.

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
| Cambiar filtros con una máquina seleccionada | Se elimina la selección si deja de coincidir. |
| Otro cliente reserva durante la consulta | Al intentar guardar se muestra el conflicto y se actualiza el catálogo. |
| Navegar con teclado y en celular | Controles, mensajes y tarjetas legibles y utilizables. |

La revisión debe realizarla una persona distinta del autor (la estrategia del equipo propone a Mariela). Registrar caso, resultado esperado, resultado obtenido, responsable, fecha y evidencia. Para cerrar la historia también se requiere aceptación del Product Owner y verificación en el ambiente compartido.
