-- Sprint 0: esquema compartido por PostgreSQL y PGlite.
CREATE TABLE IF NOT EXISTS maquinaria (
  id INTEGER PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  tipo VARCHAR(80) NOT NULL,
  descripcion TEXT NOT NULL,
  tarifa_diaria NUMERIC(12, 2) NOT NULL CHECK (tarifa_diaria > 0),
  disponible BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS contrato (
  id UUID PRIMARY KEY,
  maquinaria_id INTEGER NOT NULL REFERENCES maquinaria(id) ON DELETE RESTRICT,
  maquinaria_nombre VARCHAR(120) NOT NULL,
  cliente VARCHAR(160) NOT NULL CHECK (length(trim(cliente)) >= 2),
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

CREATE INDEX IF NOT EXISTS contrato_maquinaria_fechas_idx
  ON contrato (maquinaria_id, fecha_inicio, fecha_fin);
