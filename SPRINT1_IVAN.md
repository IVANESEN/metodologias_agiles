# Sprint 1 - Formalización del contrato de alquiler

Responsable: Iván

## Objetivo
Formalizar con transparencia las tarifas, fechas, seguros y operador asignado,
brindando certeza jurídica y operativa al acuerdo.

## Criterios cubiertos

1. Guardar contrato con cliente, máquina, fechas, operador y condiciones.
2. Bloquear el guardado y señalar los campos obligatorios faltantes
   (`400 VALIDATION_ERROR` con `error.fields` por campo).
3. Recuperar los datos íntegros del contrato mediante su ID
   (`GET /api/contratos/:id`).

## Campos nuevos de `POST /api/contratos`

| Campo | Obligatorio | Valores |
| --- | --- | --- |
| `operador` | Sí | Nombre, 2 a 160 caracteres |
| `operador_documento` | No | DUI con formato `00000000-0` |
| `seguro` | Sí | `TODO_RIESGO`, `RESPONSABILIDAD_CIVIL`, `POR_CUENTA_DEL_CLIENTE` |
| `forma_pago` | Sí | `EFECTIVO`, `TRANSFERENCIA`, `CHEQUE`, `CREDITO_30_DIAS` |
| `condiciones_especiales` | No | Hasta 1000 caracteres |

## Documento del contrato
`GET /api/contratos/:id/documento` devuelve el texto con 14 cláusulas
(objeto, plazo, precio, operador, seguro, entrega, terminación, fuerza mayor,
jurisdicción, entre otras) basadas en el Código Civil y el Código de Comercio
de El Salvador, la Ley de Protección al Consumidor y la ley del IVA.

> La plantilla es de apoyo y debe ser revisada por un profesional del derecho
> antes de usarse como documento legal definitivo.

## Pruebas
`backend/contrato-formal.test.mjs`. Ejecutar con `npm test`.
