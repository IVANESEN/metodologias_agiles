# Migración automática del PR #25

## Problema y decisión

La versión anterior tiene 14 tablas. El PR incorpora `recepcion_correccion`,
`despacho_notificacion` y `despacho_intento`, y exige los roles y estados ampliados.
El servidor comprueba ese contrato antes de escuchar conexiones: publicar solo el
código dejaría el despliegue fallido si la base aún conserva el esquema anterior.

Se registra exclusivamente `database/migrations/20261101_reajustes.sql` como una
actualización de esta versión. No se ejecuta la inicialización general ni se
buscan y ejecutan automáticamente todos los archivos de una carpeta.

## Proceso al integrar en main

1. El pipeline verifica dependencias, sintaxis y pruebas. Las pruebas usan bases
   aisladas, sin credenciales ni acceso al proyecto Supabase del equipo.
2. El job de despliegue solicita a Render el commit probado y espera su estado
   `live`, seguido de `/api/health`.
3. Render ejecuta `npm start`. npm lanza antes `prestart` → `db:migrate` con las
   variables privadas que ya tiene el servicio.
4. El ejecutor exige conexión verificada, propiedad del esquema y de las tablas,
   RLS y ausencia de políticas o permisos ajenos. Solo reconoce la versión previa
   completa, las ampliaciones compatibles o el esquema actual.
5. Si hay cambios pendientes, adquiere el mismo bloqueo asesor de `db:init`, vuelve
   a inspeccionar bajo bloqueo, ejecuta el SQL y verifica las 17 tablas antes del
   commit. Se conserva `lock_timeout=10s` y `statement_timeout=60s`.
6. Si termina correctamente, npm inicia el servidor; si falla, devuelve un error
   seguro y la nueva aplicación no abre el puerto.

El SQL conserva su envoltura `BEGIN/COMMIT` para ejecución manual revisada. El
ejecutor extrae únicamente esa envoltura para que una transacción exterior controle
el commit posterior a la validación. No se añaden tablas de control al esquema.

## Conservación y repetición

- Los seis roles y los estados anteriores siguen siendo válidos.
- No se reescriben usuarios, contraseñas, contratos, pagos, recepciones o fotos.
- Las tablas nuevas tienen RLS y revocación para `PUBLIC`, `anon`, `authenticated`
  y `service_role`; el backend sigue usando su conexión PostgreSQL privada.
- Dos arranques coordinan la actualización mediante el bloqueo asesor. El segundo
  vuelve a comprobar el esquema y omite el DDL si el primero ya lo actualizó.
- En sucesivos arranques, una base válida se comprueba sin repetir los `ALTER`.
- Bases vacías, esquemas distintos de `constructora_private` pendientes de esta
  migración o estructuras incompatibles requieren preparación explícita; no se
  intenta reconstruirlas ni eliminar objetos.

## Operación y límites

No hace falta cambiar secretos de Actions, variables de Render o el plan gratuito.
El servicio debe conservar `npm start` como comando de inicio. La comprobación
directa del servidor (`assertPostgresReady`) sigue siendo de solo lectura.

Conservar y ensayar el respaldo del entorno compartido antes de la actualización.
Un fallo dentro de la migración revierte el DDL. Un fallo posterior de la aplicación
requiere una corrección compatible con el esquema ampliado: el rollback de Render
no restaura la base y una versión antigua puede rechazar las tablas nuevas.

La validación local o de CI no acredita un despliegue real ni una restauración de
Supabase. Esos resultados deben registrarse después de la integración y verificación
del entorno publicado.
