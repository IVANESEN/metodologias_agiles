# Sprint 1 - HU8: Reserva y bloqueo automático de maquinaria

Responsable: Mariela Flores

## Objetivo
Garantizar que una maquinaria reservada no pueda ser
alquilada a otro cliente durante las mismas fechas.

## Funcionalidades verificadas

1. Bloqueo de fechas después de confirmar una reserva.
2. Rechazo de reservas con fechas superpuestas.
3. Control de solicitudes simultáneas para evitar
   reservas duplicadas.

## Implementación
La lógica se encuentra en backend/app.mjs,
principalmente en la función saveContract().

Se utiliza una transacción de base de datos,
SELECT FOR UPDATE y una consulta de solapamiento
para evitar conflictos entre reservas.

## Evidencia de pruebas

Prueba 1: Crear reserva
- Maquinaria: CAT 336
- Cliente: Mariela Flores
- Fechas: 15 al 18 de octubre de 2026
- Resultado: HTTP 201 Created

Prueba 2: Intentar reserva superpuesta
- Maquinaria: CAT 336
- Fechas: 16 al 19 de octubre de 2026
- Resultado: HTTP 409 Conflict
- Código: DATE_CONFLICT

Prueba 3: Concurrencia
- Dos solicitudes simultáneas para una máquina.
- Resultado: solamente se genera un contrato.

## Pruebas automatizadas
Comando: npm test

Resultados:
- 13 pruebas ejecutadas
- 13 aprobadas
- 0 fallidas

## Conclusión
Los criterios de aceptación de HU8 se verificaron
correctamente mediante pruebas manuales y automatizadas.

## Implementación adicional de Sprint 1

Se implementó una interfaz web para reservar maquinaria.

Funcionalidades:
- Seleccionar maquinaria disponible.
- Ingresar nombre del cliente y fechas de alquiler.
- Consultar los períodos ocupados de cada maquinaria.
- Mostrar mensajes de confirmación y conflictos.
- Actualizar las fechas ocupadas después de confirmar una reserva.

Archivos implementados:
- frontend/index.html
- backend/app.mjs
- backend/reservas.test.mjs

Nueva ruta:
GET /api/reservas/ocupadas?maquinaria_id=1

## Resultados finales de las pruebas

- 14 pruebas automatizadas aprobadas.
- 0 pruebas fallidas.
- Reserva confirmada desde la interfaz web.
- Bloqueo de fechas superpuestas comprobado.
- Concurrencia comprobada mediante pruebas automatizadas.
