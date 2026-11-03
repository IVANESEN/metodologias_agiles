# Estados de cuenta y alquileres de Constructora

Esta ampliación reutiliza las 17 tablas existentes. Separa cobros de clientes y pagos a proveedores, conserva los abonos históricos y permite que los empleados contraten maquinaria para Constructora El Salvador.

## Pantallas y permisos

| Perfil | Consulta | Escritura |
| --- | --- | --- |
| Administrador | Cuentas por cobrar y por pagar; historial por operación | Registrar cobro o pago, vincular un contrato con su pedido |
| Proveedor | Solo sus operaciones y abonos, netos de la comisión histórica | Ninguna operación de dinero |
| Empleado | Obligaciones de pedidos de la empresa; catálogo, carrito y todos los pedidos de la empresa | Crear pedidos de empresa y conservar las funciones operativas existentes |
| Cliente | Sus pedidos, como antes | Sus pedidos, como antes; sin acceso al estado de cuenta administrativo |

Los roles residente y gerente conservan los permisos previos del módulo operativo. El gerente sigue usando los cobros de contratos independientes; no recibe permisos para los nuevos movimientos del portal.

El backend establece `pedido.es_empresa=true` únicamente cuando crea el pedido un empleado. No toma esta decisión del cuerpo de la solicitud ni del texto editable `usuario.empresa`. Todos los empleados pertenecen a la única organización operadora de este alcance. Conservan su consulta operativa de pedidos externos; el filtro «Alquileres de la empresa» y su estado de cuenta seleccionan solo pedidos marcados como empresa.

## Qué se contabiliza

- Un pedido genera obligación al estar APROBADO, EN_ENTREGA, COMPLETADO, FINALIZADO o DEVUELTO. Las solicitudes pendientes, rechazadas o canceladas no son deudas aprobadas.
- Los pedidos externos generan una cuenta por cobrar por su total. Los pedidos de la empresa no generan un cobro contra Constructora.
- Cada proveedor de una operación tiene una cuenta por pagar. Su importe es la suma de los subtotales de sus líneas, menos la comisión guardada en `pedido.tasas`, con redondeo de dos decimales. Se conserva el criterio de liquidación que ya mostraba el portal: descuentos del cliente, operador, flete, IVA y depósito no se reparten automáticamente entre proveedores.
- Los contratos independientes mantienen sus cuentas por cobrar y pagos históricos.
- Saldo = importe de la obligación − suma de sus movimientos. No se guardan copias del saldo en otra tabla.
- Los movimientos dejan constancia de comprobantes. No ejecutan transferencias, pagos bancarios ni facturación fiscal. No hay conciliación bancaria ni reembolsos automáticos en esta versión.

## Evitar una deuda duplicada

En la cuenta por cobrar de un pedido externo de renta, el administrador puede seleccionar «Vincular contrato» e introducir el UUID del contrato que documenta esa misma operación. Esta es una decisión explícita del administrador; no se adivina por nombres o importes.

La vinculación exige que ambos registros estén sin movimientos y que no estén vinculados a otra operación. Después, el pedido es la fuente económica única: el contrato sale de los pendientes del módulo anterior y no admite pagos por su endpoint antiguo. El documento contractual permanece disponible. La vinculación no crea ni cambia reservas, tarifas, documentos o fechas; tampoco convierte automáticamente pedidos en contratos.

Los registros históricos no se vinculan ni se reclasifican automáticamente. Antes de registrar el primer pago, el administrador debe comprobar si pedido y contrato representan la misma operación. No existe detección automática de duplicados históricos por texto.

## Cambios de base de datos

| Tabla | Ampliación |
| --- | --- |
| pedido | `es_empresa BOOLEAN NOT NULL DEFAULT FALSE` |
| contrato | `pedido_id UUID UNIQUE` con FK restrictiva al pedido |
| pago | Tipo de movimiento, pedido, proveedor, método, referencia y usuario registrador |

`pago.contrato_id` pasa a admitir NULL bajo un CHECK de destino: un cobro pertenece exactamente a contrato o pedido y no lleva proveedor; un pago a proveedor pertenece a pedido, exige proveedor y no lleva contrato. El importe sigue siendo positivo y las nuevas referencias usan FK con ON DELETE RESTRICT. Los pagos anteriores reciben el tipo COBRO_CLIENTE y conservan ID, importe, contrato y fecha; los metadatos que no se conocen quedan NULL.

La referencia del comprobante se normaliza a mayúsculas. Un índice único impide repetir método y referencia en la misma operación, tipo y proveedor. El UUID del movimiento se conserva durante los reintentos del formulario y su repetición con los mismos datos no vuelve a abonar. Reutilizarlo con datos diferentes genera conflicto.

Las escrituras bloquean la cabecera de la operación dentro de una transacción, comprueban el saldo y guardan movimiento y auditoría conjuntamente. Si falla la auditoría se revierte el abono. Los pedidos con movimientos no se pueden cancelar ni rechazar por el flujo normal; requieren revisión de conciliación.

## Migración y despliegue

La migración registrada es `database/migrations/20261102_estados_cuenta.sql`. `npm start` continúa ejecutando `db:migrate` antes del servidor: primero prepara los reajustes anteriores y después esta ampliación. No se introducen nuevas credenciales ni servicios.

La ampliación requiere el esquema privado compatible, TLS verificado, revisión de acceso y el mismo bloqueo de migraciones. Se ejecuta en una transacción con límites de bloqueo y ejecución. El estado final se valida antes de confirmar. Si ya está aplicada se omite; si se detecta una ampliación parcial o incompatible se rechaza para revisión. No añade políticas públicas ni modifica la protección RLS de las tablas existentes.

En PGlite y en la preparación explícita de PostgreSQL, `applyCompatibilityConstraints` aplica la misma ampliación después del esquema base. Por eso ejecutar únicamente el SQL base a mano no sustituye a los comandos de preparación.

Antes de fusionar, revisar el PR y los resultados del pipeline. El push a la rama de trabajo y el PR no despliegan. Después del merge a main, el pipeline ejecuta las verificaciones y solicita el despliegue; el prestart aplica las migraciones.

Revisar el respaldo del entorno antes del despliegue. No se proporciona una migración descendente que elimine movimientos: si ya existen pagos del portal, volver a la versión anterior puede hacer que su comprobación de esquema rechace el arranque. Ante un problema, conservar los datos y publicar una corrección compatible.

## Verificación

- `cuentas.test.mjs`: integración HTTP autenticada; separación de cuentas y empresa; proveedor aislado; permisos; validación; abonos; reintento y comprobante duplicado; concurrencia; rollback de auditoría; cancelación protegida y vinculación sin doble cobro.
- `cuentas-frontend.test.mjs`: escape de nombres y referencias; controles de escritura reservados; presentación del estado de cuenta empresarial.
- `cuentas-migracion.test.mjs`: migración sobre esquema anterior, conservación de pagos, rollback después de DDL real en PGlite, repetición y rechazo de configuraciones incompatibles.
- `deploy-migrations-postgres.test.mjs`: amplía la prueba existente de CI con rollback de la ampliación, dos conexiones que migran una sola vez y dos pagos concurrentes contra el mismo saldo en PostgreSQL 17 aislado.
- Suite anterior: debe conservar sus comprobaciones. La expectativa de pago sin contrato ni pedido cambia de NOT NULL a violación del CHECK de destino; el caso sigue rechazándose.

Las pruebas usan bases aisladas; no leen ni modifican la base productiva. Las comprobaciones de migración de PGlite simulan únicamente la evidencia del transporte TLS; no certifican una conexión a Supabase. La aceptación visual y de negocio corresponde al revisor antes del merge.
