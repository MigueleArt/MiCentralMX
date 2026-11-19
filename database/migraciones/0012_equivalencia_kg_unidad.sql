-- Equivalencia opcional para convertir unidades de venta a kilogramos.
ALTER TABLE unidades ADD COLUMN kilogramos_por_unidad numeric(12, 3);
UPDATE unidades SET kilogramos_por_unidad = 15 WHERE lower(nombre) = 'tara';
UPDATE unidades SET kilogramos_por_unidad = 1 WHERE lower(nombre) = 'kg';
