import OperacionDiaria from '../carga/OperacionDiaria';

/** Nueva venta usa el flujo de inventario y ticket del diseño de operación diaria. */
export default function NuevaVenta() {
  return <OperacionDiaria soloVentas />;
}
