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


-- Sprint 2 HU5: ficha técnica de maquinaria
ALTER TABLE maquinaria
ADD COLUMN IF NOT EXISTS horometro INTEGER
CHECK (horometro >= 0);

ALTER TABLE maquinaria
ADD COLUMN IF NOT EXISTS ficha_tecnica TEXT;

ALTER TABLE maquinaria
ADD COLUMN IF NOT EXISTS foto_url TEXT;

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
  rol VARCHAR(20) NOT NULL DEFAULT 'residente' CHECK (rol IN ('residente','gerente','admin','empleado','proveedor','cliente')),
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

-- HU1b: solo se almacena el hash del enlace temporal de recuperación.
CREATE TABLE IF NOT EXISTS token_recuperacion (
  id UUID PRIMARY KEY,
  usuario_id UUID NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  expira_en TIMESTAMPTZ NOT NULL,
  usado_en TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS token_recuperacion_usuario_idx ON token_recuperacion (usuario_id);
-- Sprint 3 HU10: Registro de recepción de maquinaria en obra
CREATE TABLE IF NOT EXISTS recepcion_maquinaria (
  id UUID PRIMARY KEY,
  contrato_id UUID NOT NULL,
  maquinaria_id INTEGER NOT NULL,
  horometro INTEGER NOT NULL,
  fotos JSONB NOT NULL,
  fecha_recepcion TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT recepcion_maquinaria_contrato_equipo_fkey
    FOREIGN KEY (contrato_id, maquinaria_id)
    REFERENCES contrato_maquinaria(contrato_id, maquinaria_id)
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
  ON recepcion_maquinaria (contrato_id, fecha_recepcion DESC);

-- Portal multirrol (admin, empleado, proveedor, cliente). Columnas aditivas:
-- los registros históricos conservan sus valores y reciben los predeterminados.
-- Las bases creadas antes de este cambio necesitan la migración revisada
-- database/migrations/20261026_portal_multirrol.sql para ampliar los roles.
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS telefono VARCHAR(30);
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS empresa VARCHAR(160);
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS documento VARCHAR(30);
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS ultimo_acceso TIMESTAMPTZ;

-- Ficha comercial del producto (alta tipo tienda en línea para proveedores).
-- proveedor_id NULL identifica la flota propia de la constructora.
ALTER TABLE maquinaria ADD COLUMN IF NOT EXISTS proveedor_id UUID;
ALTER TABLE maquinaria ADD COLUMN IF NOT EXISTS marca VARCHAR(80);
ALTER TABLE maquinaria ADD COLUMN IF NOT EXISTS modelo VARCHAR(80);
ALTER TABLE maquinaria ADD COLUMN IF NOT EXISTS anio INTEGER CHECK (anio IS NULL OR anio BETWEEN 1950 AND 2100);
ALTER TABLE maquinaria ADD COLUMN IF NOT EXISTS condicion VARCHAR(20)
  CHECK (condicion IS NULL OR condicion IN ('NUEVO', 'USADO', 'REACONDICIONADO'));
ALTER TABLE maquinaria ADD COLUMN IF NOT EXISTS modalidad VARCHAR(10) NOT NULL DEFAULT 'RENTA'
  CHECK (modalidad IN ('RENTA', 'VENTA', 'AMBAS'));
ALTER TABLE maquinaria ADD COLUMN IF NOT EXISTS precio_venta NUMERIC(14, 2) CHECK (precio_venta IS NULL OR precio_venta > 0);
ALTER TABLE maquinaria ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 1 CHECK (stock >= 0);
ALTER TABLE maquinaria ADD COLUMN IF NOT EXISTS sku VARCHAR(40);
ALTER TABLE maquinaria ADD COLUMN IF NOT EXISTS estado_publicacion VARCHAR(12) NOT NULL DEFAULT 'ACTIVO'
  CHECK (estado_publicacion IN ('BORRADOR', 'PENDIENTE', 'ACTIVO', 'RECHAZADO', 'ARCHIVADO'));
ALTER TABLE maquinaria ADD COLUMN IF NOT EXISTS motivo_rechazo TEXT;
ALTER TABLE maquinaria ADD COLUMN IF NOT EXISTS imagenes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE maquinaria ADD COLUMN IF NOT EXISTS especificaciones JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE maquinaria ADD COLUMN IF NOT EXISTS destacado BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE maquinaria ADD COLUMN IF NOT EXISTS creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE maquinaria ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS maquinaria_proveedor_idx ON maquinaria (proveedor_id);

-- Tasas que el administrador ajusta sin desplegar código.
CREATE TABLE IF NOT EXISTS configuracion (
  clave VARCHAR(40) PRIMARY KEY,
  valor NUMERIC(12, 2) NOT NULL CHECK (valor >= 0),
  etiqueta VARCHAR(120) NOT NULL,
  unidad VARCHAR(12) NOT NULL,
  descripcion TEXT NOT NULL,
  minimo NUMERIC(12, 2) NOT NULL DEFAULT 0,
  maximo NUMERIC(12, 2) NOT NULL,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_por UUID
);

-- Pedidos del portal: compras y reservas de renta hechas por clientes.
CREATE TABLE IF NOT EXISTS pedido (
  id UUID PRIMARY KEY,
  numero INTEGER UNIQUE NOT NULL CHECK (numero > 0),
  cliente_id UUID NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
  tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('COMPRA', 'RENTA', 'MIXTO')),
  estado VARCHAR(14) NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'APROBADO', 'EN_ENTREGA', 'COMPLETADO', 'CANCELADO', 'RECHAZADO')),
  ciudad VARCHAR(100) NOT NULL CHECK (length(trim(ciudad)) >= 2),
  direccion VARCHAR(240) NOT NULL CHECK (length(trim(direccion)) >= 5),
  metodo_pago VARCHAR(30) NOT NULL CHECK (metodo_pago IN ('EFECTIVO', 'TRANSFERENCIA', 'CHEQUE', 'CREDITO_30_DIAS')),
  notas TEXT CHECK (notas IS NULL OR length(notas) <= 1000),
  subtotal NUMERIC(14, 2) NOT NULL CHECK (subtotal >= 0),
  descuento NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  operador NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (operador >= 0),
  flete NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (flete >= 0),
  iva NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (iva >= 0),
  deposito NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (deposito >= 0),
  total NUMERIC(14, 2) NOT NULL CHECK (total > 0),
  tasas JSONB NOT NULL,
  atendido_por UUID,
  motivo TEXT CHECK (motivo IS NULL OR length(motivo) <= 500),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS pedido_cliente_idx ON pedido (cliente_id, creado_en DESC);

CREATE TABLE IF NOT EXISTS pedido_item (
  id UUID PRIMARY KEY,
  pedido_id UUID NOT NULL REFERENCES pedido(id) ON DELETE CASCADE,
  maquinaria_id INTEGER NOT NULL REFERENCES maquinaria(id) ON DELETE RESTRICT,
  nombre VARCHAR(120) NOT NULL,
  proveedor_id UUID,
  modalidad VARCHAR(10) NOT NULL CHECK (modalidad IN ('COMPRA', 'RENTA')),
  cantidad INTEGER NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  fecha_inicio DATE,
  fecha_fin DATE,
  dias INTEGER CHECK (dias IS NULL OR dias > 0),
  con_operador BOOLEAN NOT NULL DEFAULT FALSE,
  precio_unitario NUMERIC(14, 2) NOT NULL CHECK (precio_unitario > 0),
  subtotal NUMERIC(14, 2) NOT NULL CHECK (subtotal > 0),
  CHECK (modalidad = 'COMPRA' OR (fecha_inicio IS NOT NULL AND fecha_fin IS NOT NULL AND fecha_fin >= fecha_inicio AND cantidad = 1))
);
CREATE INDEX IF NOT EXISTS pedido_item_maquinaria_idx ON pedido_item (maquinaria_id, fecha_inicio, fecha_fin);
CREATE INDEX IF NOT EXISTS pedido_item_pedido_idx ON pedido_item (pedido_id);

CREATE TABLE IF NOT EXISTS pedido_evento (
  id UUID PRIMARY KEY,
  pedido_id UUID NOT NULL REFERENCES pedido(id) ON DELETE CASCADE,
  estado VARCHAR(14) NOT NULL,
  nota TEXT,
  usuario_id UUID,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS pedido_evento_pedido_idx ON pedido_evento (pedido_id, creado_en);

-- Bitácora de acciones administrativas; no guarda contraseñas ni tokens.
CREATE TABLE IF NOT EXISTS auditoria (
  id UUID PRIMARY KEY,
  usuario_id UUID,
  accion VARCHAR(60) NOT NULL,
  entidad VARCHAR(40) NOT NULL,
  entidad_id VARCHAR(60),
  detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS auditoria_fecha_idx ON auditoria (creado_en DESC);
