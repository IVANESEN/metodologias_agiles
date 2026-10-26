-- Idempotente: las ejecuciones siguientes conservan las tarifas y datos existentes.
INSERT INTO maquinaria (id, nombre, tipo, descripcion, tarifa_diaria, disponible)
VALUES
  (1, 'CAT 336', 'Excavadora', 'Excavadora hidráulica para movimiento de tierra y obras de construcción.', 450.00, TRUE),
  (2, 'JCB 3CX', 'Retroexcavadora', 'Retroexcavadora versátil para excavación, carga y mantenimiento de obras.', 275.00, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Tasas iniciales del portal. El administrador las ajusta desde la plataforma.
INSERT INTO configuracion (clave, valor, etiqueta, unidad, descripcion, minimo, maximo)
VALUES
  ('iva', 13.00, 'IVA', '%', 'Impuesto al valor agregado aplicado a la base gravable del pedido.', 0, 30),
  ('comision_proveedor', 8.00, 'Comisión a proveedores', '%', 'Porcentaje que retiene la plataforma sobre cada venta o renta de un proveedor.', 0, 40),
  ('deposito_garantia', 20.00, 'Depósito de garantía en rentas', '%', 'Depósito reembolsable calculado sobre el subtotal de renta.', 0, 100),
  ('flete_base', 85.00, 'Flete por equipo', 'USD', 'Traslado en cama baja hasta la obra, por cada equipo del pedido.', 0, 5000),
  ('descuento_semanal', 5.00, 'Descuento por renta semanal', '%', 'Se aplica a rentas de 7 a 29 días.', 0, 50),
  ('descuento_mensual', 12.00, 'Descuento por renta mensual', '%', 'Se aplica a rentas de 30 días o más.', 0, 60),
  ('tarifa_operador', 55.00, 'Operador certificado', 'USD/día', 'Costo diario del operador cuando el cliente lo solicita.', 0, 1000)
ON CONFLICT (clave) DO NOTHING;
