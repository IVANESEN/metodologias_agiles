-- Sprint 0: esquema compartido por PostgreSQL y PGlite.
CREATE TABLE IF NOT EXISTS maquinaria (
  id INTEGER PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  tipo VARCHAR(80) NOT NULL,
  descripcion TEXT NOT NULL,
  tarifa_diaria NUMERIC(12, 2) NOT NULL CHECK (tarifa_diaria > 0),
  disponible BOOLEAN NOT NULL DEFAULT TRUE,
  ubicacion VARCHAR(100) CHECK (ubicacion IS NULL OR length(trim(ubicacion)) >= 2)
);

CREATE TABLE IF NOT EXISTS contrato (
  id UUID PRIMARY KEY,
  -- Legacy reference to the first machine. The detail table lists all machines;
  -- the header's daily rate and total cover the entire selection.
  maquinaria_id INTEGER NOT NULL REFERENCES maquinaria(id) ON DELETE RESTRICT,
  maquinaria_nombre VARCHAR(120) NOT NULL,
  cliente VARCHAR(160) NOT NULL CHECK (length(trim(cliente)) >= 2),
  ciudad VARCHAR(100) CHECK (ciudad IS NULL OR length(trim(ciudad)) >= 2),
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  dias INTEGER NOT NULL CHECK (dias > 0),
  tarifa_diaria NUMERIC(12, 2) NOT NULL CHECK (tarifa_diaria > 0),
  total NUMERIC(14, 2) NOT NULL CHECK (total > 0),
  estado VARCHAR(20) NOT NULL DEFAULT 'CONFIRMADO' CHECK (estado = 'CONFIRMADO'),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (fecha_fin >= fecha_inicio),
  CHECK (dias = fecha_fin - fecha_inicio + 1),
  CHECK (total = dias * tarifa_diaria)
);

-- Additive upgrade for databases initialized before HU3. Historical records have
-- no known city; keep them NULL rather than inventing locations or deleting data.
ALTER TABLE maquinaria ADD COLUMN IF NOT EXISTS ubicacion VARCHAR(100)
  CHECK (ubicacion IS NULL OR length(trim(ubicacion)) >= 2);
ALTER TABLE contrato ADD COLUMN IF NOT EXISTS ciudad VARCHAR(100)
  CHECK (ciudad IS NULL OR length(trim(ciudad)) >= 2);

CREATE TABLE IF NOT EXISTS contrato_maquinaria (
  contrato_id UUID NOT NULL REFERENCES contrato(id) ON DELETE CASCADE,
  maquinaria_id INTEGER NOT NULL REFERENCES maquinaria(id) ON DELETE RESTRICT,
  maquinaria_nombre VARCHAR(120) NOT NULL,
  tarifa_diaria NUMERIC(12, 2) NOT NULL CHECK (tarifa_diaria > 0),
  PRIMARY KEY (contrato_id, maquinaria_id)
);

-- Only legacy contracts without detail need backfilling. Preserve their recorded
-- name and price; current catalog prices may already have changed.
INSERT INTO contrato_maquinaria (contrato_id, maquinaria_id, maquinaria_nombre, tarifa_diaria)
SELECT c.id, c.maquinaria_id, c.maquinaria_nombre, c.tarifa_diaria FROM contrato c
WHERE NOT EXISTS (SELECT 1 FROM contrato_maquinaria cm WHERE cm.contrato_id = c.id)
ON CONFLICT (contrato_id, maquinaria_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS contrato_maquinaria_equipo_idx
  ON contrato_maquinaria (maquinaria_id, contrato_id);

CREATE INDEX IF NOT EXISTS contrato_maquinaria_fechas_idx
  ON contrato (maquinaria_id, fecha_inicio, fecha_fin);

-- HU: formalización del contrato (operador, seguro y condiciones). Columnas
-- aditivas y opcionales para no alterar contratos históricos.
ALTER TABLE contrato ADD COLUMN IF NOT EXISTS operador VARCHAR(160)
  CHECK (operador IS NULL OR length(trim(operador)) >= 2);
ALTER TABLE contrato ADD COLUMN IF NOT EXISTS operador_documento VARCHAR(20);
ALTER TABLE contrato ADD COLUMN IF NOT EXISTS seguro VARCHAR(30)
  CHECK (seguro IS NULL OR seguro IN ('TODO_RIESGO', 'RESPONSABILIDAD_CIVIL', 'POR_CUENTA_DEL_CLIENTE'));
ALTER TABLE contrato ADD COLUMN IF NOT EXISTS forma_pago VARCHAR(30)
  CHECK (forma_pago IS NULL OR forma_pago IN ('EFECTIVO', 'TRANSFERENCIA', 'CHEQUE', 'CREDITO_30_DIAS'));
ALTER TABLE contrato ADD COLUMN IF NOT EXISTS condiciones_especiales TEXT
  CHECK (condiciones_especiales IS NULL OR length(condiciones_especiales) <= 1000);

-- HU7: firma simulada persistente. Los contratos anteriores siguen sin firma.
ALTER TABLE contrato ADD COLUMN IF NOT EXISTS firma JSONB;
ALTER TABLE contrato ADD COLUMN IF NOT EXISTS firmado_en TIMESTAMPTZ;

-- Cobros: each confirmed payment is recorded once. Balance and payment status
-- are derived from the contract total and these entries, independently of estado.
-- Historical contracts receive no invented payments when this table is added.
CREATE TABLE IF NOT EXISTS pago (
  id UUID PRIMARY KEY,
  contrato_id UUID NOT NULL REFERENCES contrato(id) ON DELETE RESTRICT,
  monto NUMERIC(14, 2) NOT NULL CHECK (monto > 0),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS pago_contrato_idx ON pago (contrato_id);

-- HU1a: usuarios y sesiones privadas; sin credenciales de demostración.
CREATE TABLE IF NOT EXISTS usuario (
  id UUID PRIMARY KEY,
  correo VARCHAR(254) UNIQUE NOT NULL CHECK (correo = lower(trim(correo))),
  nombre VARCHAR(160) NOT NULL CHECK (length(trim(nombre)) > 0),
  clave_hash TEXT NOT NULL,
  rol VARCHAR(20) NOT NULL DEFAULT 'residente' CHECK (rol IN ('residente','gerente')),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sesion (
  id UUID PRIMARY KEY,
  usuario_id UUID NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expira_en TIMESTAMPTZ NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS sesion_usuario_idx ON sesion (usuario_id);
