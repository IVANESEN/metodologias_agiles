-- Migración aditiva para HU9a (programación de entrega y transportista).
-- Ejecutar a mano en Supabase solo después de `npm run db:inspect` y de revisar
-- que el inventario corresponde al proyecto correcto. Las ocho tablas previas
-- deben existir en constructora_private y estar protegidas.
-- Crea una tabla nueva; no modifica filas existentes, contratos ni pagos.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = constructora_private, pg_catalog;
SELECT pg_advisory_xact_lock(hashtext('constructora-init:constructora_private'));

-- Supuesto: un solo flete por contrato, aunque incluya varias máquinas.
CREATE TABLE IF NOT EXISTS constructora_private.entrega_programada (
  contrato_id UUID PRIMARY KEY
    REFERENCES constructora_private.contrato (id) ON DELETE RESTRICT,
  fecha_entrega DATE NOT NULL,
  hora_desde TIME NOT NULL,
  hora_hasta TIME NOT NULL,
  transportista VARCHAR(160) NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT entrega_programada_transportista_check CHECK (length(trim(transportista)) >= 2),
  CONSTRAINT entrega_programada_ventana_check CHECK (hora_hasta > hora_desde)
);

ALTER TABLE constructora_private.entrega_programada ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE constructora_private.entrega_programada
  FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
