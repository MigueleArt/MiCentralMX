-- Migración 0010: movimiento_id en liquidacion_conceptos, compra_id en movimientos_dinero y comision_tipo mixta
-- Permite rastrear mermas cobradas por ID, aislar pagos de compras y admitir cortes con múltiples comisiones.

-- 1. Agregar movimiento_id a liquidacion_conceptos con índice único parcial
alter table liquidacion_conceptos
  add column if not exists movimiento_id uuid references movimientos_inventario (id);

create unique index if not exists liquidacion_conceptos_movimiento_id_idx
  on liquidacion_conceptos (movimiento_id)
  where movimiento_id is not null;

-- 2. Agregar compra_id a movimientos_dinero para aislar pagos de compras a crédito
alter table movimientos_dinero
  add column if not exists compra_id uuid references compras (id);

-- 3. Permitir tipo 'mixta' en liquidaciones (cuando entran cargas con comisiones distintas)
alter table liquidaciones drop constraint if exists liquidaciones_comision_tipo_check;
alter table liquidaciones add constraint liquidaciones_comision_tipo_check check (comision_tipo in ('porcentaje', 'por_unidad', 'mixta'));
