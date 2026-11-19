-- Conversión a kg por producto, ya que cajas y taras pueden variar según el producto.
ALTER TABLE productos ADD COLUMN kilogramos_por_unidad numeric(12, 3);
UPDATE productos p
SET kilogramos_por_unidad = u.kilogramos_por_unidad
FROM unidades u
WHERE p.unidad_id = u.id;
