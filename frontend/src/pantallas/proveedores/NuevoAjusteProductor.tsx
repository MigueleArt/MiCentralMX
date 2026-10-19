import { useLiveQuery } from 'dexie-react-hooks';
import { CircleAlert, HelpCircle, Scale, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { mensajeError } from '../../api/cliente';
import { useAvisos } from '../../componentes/Avisos';
import { AvisoLinea, Esqueleto } from '../../componentes/Estados';
import { Campo, Entrada, EntradaImporte, Segmentado } from '../../componentes/Formulario';
import { db } from '../../db/db';
import { registrarAjusteProductor } from '../../dominio/operaciones';
import { EncabezadoSecundario } from '../../layout/Encabezados';
import { aImporte, D, formatoMXN } from '../../lib/dinero';
import { useConectividad } from '../../sync/conectividad';

export default function NuevoAjusteProductor() {
  const { id } = useParams();
  const navegar = useNavigate();
  const avisar = useAvisos();
  const { enLinea } = useConectividad();

  const datos = useLiveQuery(async () => {
    if (!id) return null;
    const [proveedor, ventas, cargas] = await Promise.all([
      db.proveedores.get(id),
      db.ventas.toArray(),
      db.cargas.where('proveedorId').equals(id).toArray(),
    ]);

    const cargaIds = new Set(cargas.map((c) => c.id));
    const ventasDelProductor = ventas.filter((v) =>
      v.estado !== 'cancelada' && v.renglones.some((r) => r.cargaId && cargaIds.has(r.cargaId)),
    );

    return { proveedor, ventas: ventasDelProductor };
  }, [id]);

  const [tipo, setTipo] = useState<'cargo' | 'abono'>('cargo');
  const [categoria, setCategoria] = useState<'incobrable' | 'otro'>('incobrable');
  const [concepto, setConcepto] = useState('');
  const [monto, setMonto] = useState('');
  const [ventaIdSeleccionada, setVentaIdSeleccionada] = useState<string>('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (datos === undefined) {
    return (
      <>
        <EncabezadoSecundario titulo="Cargo o abono" volverA={`/proveedores/${id}`} />
        <main className="pag-main con-enc-sec"><Esqueleto filas={3} /></main>
      </>
    );
  }

  if (!datos?.proveedor) {
    return (
      <>
        <EncabezadoSecundario titulo="Cargo o abono" volverA="/proveedores" />
        <main className="pag-main con-enc-sec">
          <p className="t-aux" style={{ textAlign: 'center' }}>Proveedor no encontrado.</p>
        </main>
      </>
    );
  }

  const { proveedor, ventas } = datos;

  // Ayuda para incobrables: calcula lo no cobrado * (1 - tasaComision)
  const aplicarAyudaIncobrable = (vId: string) => {
    setVentaIdSeleccionada(vId);
    if (!vId) return;

    const v = ventas.find((x) => x.id === vId);
    if (!v) return;

    // Calcular proporción de fruta de este productor en la venta
    const cargasProv = new Set(ventas.flatMap((vt) => vt.renglones.filter((r) => r.cargaId).map((r) => r.cargaId!)));
    let importeVentaProductor = D(0);
    for (const r of v.renglones) {
      if (r.cargaId && cargasProv.has(r.cargaId)) {
        importeVentaProductor = importeVentaProductor.plus(r.importe);
      }
    }

    // Tasa de comisión estimada (si tiene comisión configurada)
    let tasa = D(0.10); // 10% por omisión si no hay dato
    if (proveedor.comisionTipo === 'porcentaje' && proveedor.comisionValor) {
      tasa = D(proveedor.comisionValor).div(100);
    }

    // La pérdida que absorbe el productor = lo vendido menos la comisión
    // cargo = importe * (1 - tasa)
    const cargoSugerido = importeVentaProductor.times(D(1).minus(tasa));
    setMonto(aImporte(cargoSugerido));
    setConcepto(`Incobrable venta #${v.folio ?? '—'}`);
  };

  const guardar = async () => {
    if (!concepto.trim()) {
      setError('Escribe el concepto del ajuste.');
      return;
    }
    const m = D(monto || 0);
    if (!m.isFinite() || m.lte(0)) {
      setError('Escribe un monto mayor que cero.');
      return;
    }

    setGuardando(true);
    setError(null);

    try {
      await registrarAjusteProductor({
        proveedorId: proveedor.id,
        tipo,
        categoria,
        concepto: concepto.trim(),
        monto: aImporte(m),
        ventaId: ventaIdSeleccionada || null,
      });

      avisar(`${tipo === 'cargo' ? 'Cargo' : 'Abono'} de ${formatoMXN(m)} registrado`);
      navegar(`/proveedores/${proveedor.id}`, { replace: true });
    } catch (err) {
      setError(mensajeError(err));
      setGuardando(false);
    }
  };

  return (
    <>
      <EncabezadoSecundario
        titulo={`Nuevo ${tipo} · ${proveedor.nombre}`}
        volverA={`/proveedores/${proveedor.id}`}
      />

      <main className="pag-main con-enc-sec">
        <form
          className="pila-16 contenedor-form"
          style={{ margin: '0 auto' }}
          onSubmit={(e) => {
            e.preventDefault();
            void guardar();
          }}
        >
          {!enLinea && (
            <AvisoLinea tono="warn" icono={<WifiOff className="ic" />}>
              Registrar cargos o abonos requiere conexión con el servidor.
            </AvisoLinea>
          )}

          <Segmentado<'cargo' | 'abono'>
            etiqueta="Tipo de ajuste"
            valor={tipo}
            alCambiar={setTipo}
            opciones={[
              { valor: 'cargo', texto: 'Cargo (reduce lo que se le debe)' },
              { valor: 'abono', texto: 'Abono (aumenta lo que se le debe)' },
            ]}
          />

          <Segmentado<'incobrable' | 'otro'>
            etiqueta="Categoría"
            valor={categoria}
            alCambiar={setCategoria}
            opciones={[
              { valor: 'incobrable', texto: 'Incobrable / Pérdida cliente' },
              { valor: 'otro', texto: 'Otro concepto' },
            ]}
          />

          {categoria === 'incobrable' && (
            <div className="card pila-12" style={{ padding: 12, background: 'var(--fondo-superficie)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <HelpCircle className="ic" style={{ color: 'var(--primario)' }} />
                <p style={{ fontWeight: 600, fontSize: 13 }}>Ayuda para incobrables</p>
              </div>
              <p className="t-aux" style={{ fontSize: 12 }}>
                Si un cliente no pagó, el productor absorbe lo vendido menos la comisión comercial. Elige la venta para
                calcular la sugerencia automáticamente:
              </p>
              <select
                className="inp"
                value={ventaIdSeleccionada}
                onChange={(e) => aplicarAyudaIncobrable(e.target.value)}
              >
                <option value="">Seleccionar venta del productor...</option>
                {ventas.map((v) => (
                  <option key={v.id} value={v.id}>
                    Venta #{v.folio ?? '—'} · {formatoMXN(v.total)} ({v.clienteNombre ?? 'Público general'})
                  </option>
                ))}
              </select>
            </div>
          )}

          <Campo etiqueta="Concepto del ajuste" id="conc">
            <Entrada
              id="conc"
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              placeholder="Ej. Pérdida cliente Juan no pagó / Descuento extra"
            />
          </Campo>

          <Campo etiqueta="Monto ($)" id="monto">
            <EntradaImporte id="monto" grande valor={monto} alCambiar={setMonto} placeholder="0" />
          </Campo>

          {error && <AvisoLinea tono="err" icono={<CircleAlert className="ic" />}>{error}</AvisoLinea>}

          <button
            type="submit"
            className="btn btn-p btn-lg"
            disabled={!enLinea || guardando || !monto || !concepto.trim()}
          >
            <Scale className="ic" />
            {guardando ? 'Guardando...' : `Registrar ${tipo} · ${formatoMXN(monto || 0)}`}
          </button>
        </form>
      </main>
    </>
  );
}
