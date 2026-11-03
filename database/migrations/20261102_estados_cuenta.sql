-- Migración registrada. La ejecuta el backend dentro de una transacción y bloqueo.
ALTER TABLE pedido ADD COLUMN IF NOT EXISTS es_empresa BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contrato ADD COLUMN IF NOT EXISTS pedido_id UUID UNIQUE REFERENCES pedido(id) ON DELETE RESTRICT;
ALTER TABLE pago ADD COLUMN IF NOT EXISTS tipo_movimiento VARCHAR(20) NOT NULL DEFAULT 'COBRO_CLIENTE';
ALTER TABLE pago ADD COLUMN IF NOT EXISTS pedido_id UUID REFERENCES pedido(id) ON DELETE RESTRICT;
ALTER TABLE pago ADD COLUMN IF NOT EXISTS proveedor_id UUID REFERENCES usuario(id) ON DELETE RESTRICT;
ALTER TABLE pago ADD COLUMN IF NOT EXISTS metodo VARCHAR(20);
ALTER TABLE pago ADD COLUMN IF NOT EXISTS referencia VARCHAR(120);
ALTER TABLE pago ADD COLUMN IF NOT EXISTS registrado_por UUID REFERENCES usuario(id) ON DELETE RESTRICT;
ALTER TABLE pago ALTER COLUMN contrato_id DROP NOT NULL;
ALTER TABLE pago ADD CONSTRAINT pago_destino_check CHECK (
 (tipo_movimiento = 'COBRO_CLIENTE' AND proveedor_id IS NULL AND
   ((contrato_id IS NOT NULL AND pedido_id IS NULL) OR (contrato_id IS NULL AND pedido_id IS NOT NULL)))
 OR (tipo_movimiento = 'PAGO_PROVEEDOR' AND contrato_id IS NULL AND pedido_id IS NOT NULL AND proveedor_id IS NOT NULL)
);
ALTER TABLE pago ADD CONSTRAINT pago_metodo_check CHECK (metodo IS NULL OR metodo IN ('EFECTIVO','TRANSFERENCIA','CHEQUE'));
CREATE INDEX IF NOT EXISTS pago_pedido_tipo_idx ON pago(pedido_id,tipo_movimiento,proveedor_id);
CREATE UNIQUE INDEX pago_comprobante_idx ON pago(tipo_movimiento,COALESCE(contrato_id,pedido_id),
 COALESCE(proveedor_id,'00000000-0000-0000-0000-000000000000'::uuid),metodo,referencia)
 WHERE referencia IS NOT NULL;
