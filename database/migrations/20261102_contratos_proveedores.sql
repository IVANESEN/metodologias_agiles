-- Dentro de la transacción y el bloqueo común de migraciones.
-- Conserva el propietario registrado al migrar; después cada contrato guarda
-- su propia instantánea, independiente de cambios posteriores del catálogo.
ALTER TABLE contrato_maquinaria ADD COLUMN proveedor_id UUID;
UPDATE contrato_maquinaria cm SET proveedor_id = m.proveedor_id
FROM maquinaria m WHERE m.id = cm.maquinaria_id;
ALTER TABLE contrato_maquinaria ADD CONSTRAINT contrato_maquinaria_proveedor_fk
  FOREIGN KEY (proveedor_id) REFERENCES usuario(id) ON DELETE RESTRICT;
CREATE INDEX contrato_maquinaria_proveedor_idx ON contrato_maquinaria(proveedor_id, contrato_id);

-- No derivar obligaciones a partir de un detalle inconsistente con el contrato.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT c.id FROM contrato c JOIN contrato_maquinaria cm ON cm.contrato_id=c.id
    GROUP BY c.id HAVING COUNT(cm.proveedor_id)>0 AND SUM(cm.tarifa_diaria)<>c.tarifa_diaria
  ) THEN
    RAISE EXCEPTION 'Revisa las tarifas del detalle de contratos antes de migrar proveedores';
  END IF;
END
$migration$;

ALTER TABLE pago DROP CONSTRAINT pago_destino_check;
ALTER TABLE pago ADD CONSTRAINT pago_destino_check CHECK (
  ((contrato_id IS NOT NULL AND pedido_id IS NULL) OR (contrato_id IS NULL AND pedido_id IS NOT NULL))
  AND ((tipo_movimiento = 'COBRO_CLIENTE' AND proveedor_id IS NULL)
    OR (tipo_movimiento = 'PAGO_PROVEEDOR' AND proveedor_id IS NOT NULL))
);
-- No se reclasifican abonos históricos: necesitan confirmación administrativa.
