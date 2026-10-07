-- Idempotente: las ejecuciones siguientes conservan las tarifas y datos existentes.
INSERT INTO maquinaria (id, nombre, tipo, descripcion, tarifa_diaria, disponible)
VALUES
  (1, 'CAT 336', 'Excavadora', 'Excavadora hidráulica para movimiento de tierra y obras de construcción.', 450.00, TRUE),
  (2, 'JCB 3CX', 'Retroexcavadora', 'Retroexcavadora versátil para excavación, carga y mantenimiento de obras.', 275.00, TRUE)
ON CONFLICT (id) DO NOTHING;
