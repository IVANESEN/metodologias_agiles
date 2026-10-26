-- Migración revisada para bases creadas antes del portal multirrol.
-- 1. Amplía los roles permitidos de usuario (residente y gerente se conservan).
-- 2. Las columnas y tablas nuevas se crean con `npm run db:init -- --existing-reviewed`,
--    que aplica database/schema.sql de forma aditiva.
-- No modifica filas existentes, contraseñas, sesiones, contratos ni pagos.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = constructora_private, pg_catalog;
ALTER TABLE usuario DROP CONSTRAINT IF EXISTS usuario_rol_check;
ALTER TABLE usuario ADD CONSTRAINT usuario_rol_check
  CHECK (rol IN ('residente', 'gerente', 'admin', 'empleado', 'proveedor', 'cliente'));
COMMIT;
