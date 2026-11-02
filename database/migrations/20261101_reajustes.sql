-- H01/H02/H05/H09. Revisar inventario y respaldo antes de aplicar en una copia.
-- Alternativa preferida: npm run db:init -- --existing-reviewed --schema-only.
-- Esta migración supone las 14 tablas de la versión b8a580d en constructora_private.
-- Conserva estados históricos y fotografías originales; no reescribe filas.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = constructora_private, pg_catalog;
SELECT pg_advisory_xact_lock(hashtext('constructora-init:constructora_private'));
ALTER TABLE usuario DROP CONSTRAINT IF EXISTS usuario_rol_check;
ALTER TABLE usuario ADD CONSTRAINT usuario_rol_check CHECK (rol IN
  ('residente', 'gerente', 'admin', 'empleado', 'proveedor', 'cliente'));
ALTER TABLE pedido DROP CONSTRAINT IF EXISTS pedido_estado_check;
ALTER TABLE pedido ADD CONSTRAINT pedido_estado_check CHECK (estado IN
  ('PENDIENTE', 'APROBADO', 'EN_ENTREGA', 'COMPLETADO', 'CANCELADO', 'RECHAZADO', 'FINALIZADO', 'DEVUELTO'));

CREATE TABLE IF NOT EXISTS recepcion_correccion (
  id UUID PRIMARY KEY,
  recepcion_id UUID NOT NULL REFERENCES recepcion_maquinaria(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  fotos JSONB NOT NULL CHECK (jsonb_typeof(fotos) = 'array' AND jsonb_array_length(fotos) BETWEEN 1 AND 5),
  motivo VARCHAR(500) NOT NULL CHECK (length(trim(motivo)) >= 10),
  usuario_id UUID NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (recepcion_id, version)
);
CREATE TABLE IF NOT EXISTS despacho_notificacion (
  id VARCHAR(64) PRIMARY KEY,
  contrato_id UUID NOT NULL REFERENCES contrato(id) ON DELETE RESTRICT,
  orden JSONB NOT NULL,
  estado VARCHAR(20) NOT NULL CHECK (estado IN ('PENDIENTE', 'ENVIADO', 'FALLIDO')),
  intentos INTEGER NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  ultimo_error VARCHAR(250),
  proveedor_id VARCHAR(160),
  usuario_id UUID NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS despacho_notificacion_contrato_idx ON despacho_notificacion (contrato_id, creado_en DESC);
CREATE TABLE IF NOT EXISTS despacho_intento (
  id UUID PRIMARY KEY,
  notificacion_id VARCHAR(64) NOT NULL REFERENCES despacho_notificacion(id) ON DELETE RESTRICT,
  numero INTEGER NOT NULL CHECK (numero > 0),
  estado VARCHAR(20) NOT NULL CHECK (estado IN ('ENVIADO', 'FALLIDO')),
  error VARCHAR(250),
  usuario_id UUID NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (notificacion_id, numero)
);
ALTER TABLE recepcion_correccion ENABLE ROW LEVEL SECURITY;
ALTER TABLE despacho_notificacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE despacho_intento ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON recepcion_correccion, despacho_notificacion, despacho_intento FROM PUBLIC;
DO $migration$
DECLARE api_role TEXT;
BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role') LOOP
    EXECUTE format('REVOKE ALL ON constructora_private.recepcion_correccion, constructora_private.despacho_notificacion, constructora_private.despacho_intento FROM %I', api_role);
  END LOOP;
END
$migration$;
COMMIT;
