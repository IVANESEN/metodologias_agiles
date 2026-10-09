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
