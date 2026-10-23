-- Migración aditiva para main e60bd12 (HU5 y HU10).
-- Ejecutar solo tras revisar el inventario del proyecto Supabase correcto.
-- Las siete tablas previas deben existir en constructora_private y estar protegidas.
-- No modifica filas existentes, contraseñas, sesiones, contratos ni pagos.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = constructora_private, pg_catalog;
SELECT pg_advisory_xact_lock(hashtext('constructora-init:constructora_private'));

-- HU5: NULL conserva la ausencia de datos históricos sin inventar valores.
ALTER TABLE constructora_private.maquinaria
  ADD COLUMN IF NOT EXISTS horometro INTEGER CHECK (horometro >= 0);
ALTER TABLE constructora_private.maquinaria
  ADD COLUMN IF NOT EXISTS ficha_tecnica TEXT;
ALTER TABLE constructora_private.maquinaria
  ADD COLUMN IF NOT EXISTS foto_url TEXT;

-- HU10: solo permite recibir equipos incluidos en el detalle del contrato.
CREATE TABLE IF NOT EXISTS constructora_private.recepcion_maquinaria (
  id UUID PRIMARY KEY,
  contrato_id UUID NOT NULL,
  maquinaria_id INTEGER NOT NULL,
  horometro INTEGER NOT NULL,
  fotos JSONB NOT NULL,
  fecha_recepcion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT recepcion_maquinaria_contrato_equipo_fkey
    FOREIGN KEY (contrato_id, maquinaria_id)
    REFERENCES constructora_private.contrato_maquinaria (contrato_id, maquinaria_id)
    ON DELETE RESTRICT,
  CONSTRAINT recepcion_maquinaria_contrato_equipo_key
    UNIQUE (contrato_id, maquinaria_id),
  CONSTRAINT recepcion_maquinaria_horometro_check
    CHECK (horometro >= 0),
  CONSTRAINT recepcion_maquinaria_fotos_tipo_check
    CHECK (jsonb_typeof(fotos) = 'array'),
  CONSTRAINT recepcion_maquinaria_fotos_cantidad_check
    CHECK (jsonb_array_length(fotos) BETWEEN 1 AND 5)
);

CREATE INDEX IF NOT EXISTS recepcion_contrato_idx
  ON constructora_private.recepcion_maquinaria (contrato_id, fecha_recepcion DESC);

ALTER TABLE constructora_private.recepcion_maquinaria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE constructora_private.recepcion_maquinaria
  FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
