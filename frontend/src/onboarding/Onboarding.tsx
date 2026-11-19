import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Boxes,
  Check,
  ClipboardList,
  HandCoins,
  PackageSearch,
  ReceiptText,
  ShoppingCart,
  Sparkles,
  Sprout,
  Store,
  Truck,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useSesionActiva } from '../auth/SesionContext';
import { Marca } from '../componentes/Marca';
import { VERSION_TERMINOS, guardarOnboarding, leerOnboarding, type DatosOnboarding } from './estado';

interface Opcion {
  id: string;
  titulo: string;
  texto: string;
  icono: LucideIcon;
}

const OBJETIVOS: Opcion[] = [
  { id: 'ventas', titulo: 'Registrar ventas', texto: 'Contado, transferencias y crédito.', icono: ReceiptText },
  { id: 'inventario', titulo: 'Controlar inventario', texto: 'Existencias, cargas, ajustes y mermas.', icono: Boxes },
  { id: 'cobranza', titulo: 'Dar seguimiento a cobros', texto: 'Deudas, vencimientos y abonos.', icono: HandCoins },
  { id: 'compras', titulo: 'Administrar compras', texto: 'Proveedores, costos y mercancía recibida.', icono: ShoppingCart },
  { id: 'productores', titulo: 'Trabajar con productores', texto: 'Cargas, comisiones y liquidaciones.', icono: Sprout },
  { id: 'reportes', titulo: 'Consultar el negocio', texto: 'Resumen operativo, historial y reportes.', icono: ClipboardList },
];

const MERCANCIAS = ['Frutas', 'Verduras', 'Abarrotes', 'Granos y semillas', 'Carnes y lácteos', 'Otros'];

function alternar(lista: string[], valor: string) {
  return lista.includes(valor) ? lista.filter((item) => item !== valor) : [...lista, valor];
}

function OpcionObjetivo({ opcion, activa, alCambiar }: { opcion: Opcion; activa: boolean; alCambiar: () => void }) {
  const Icono = opcion.icono;
  return (
    <button type="button" className={`onb-opcion${activa ? ' activa' : ''}`} aria-pressed={activa} onClick={alCambiar}>
      <span className="onb-opcion-icono"><Icono aria-hidden="true" /></span>
      <span className="onb-opcion-texto">
        <strong>{opcion.titulo}</strong>
        <span>{opcion.texto}</span>
      </span>
      <span className="onb-check" aria-hidden="true">{activa && <Check />}</span>
    </button>
  );
}

export function Onboarding({ children }: { children: ReactNode }) {
  const { sesion } = useSesionActiva();
  const negocioId = sesion.negocio.id;
  const [completado, setCompletado] = useState(() => leerOnboarding(window.localStorage, negocioId) !== null);
  const [paso, setPaso] = useState(0);
  const [objetivos, setObjetivos] = useState<string[]>([]);
  const [mercancias, setMercancias] = useState<string[]>([]);
  const [descripcion, setDescripcion] = useState('');
  const [aceptaTerminos, setAceptaTerminos] = useState(false);
  const [aceptaPrivacidad, setAceptaPrivacidad] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tituloRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setCompletado(leerOnboarding(window.localStorage, negocioId) !== null);
    setPaso(0);
  }, [negocioId]);

  useEffect(() => {
    if (!completado) tituloRef.current?.focus();
  }, [paso, completado]);

  if (completado) return children;

  const siguiente = () => {
    setError(null);
    if (paso === 1 && objetivos.length === 0) {
      setError('Elige al menos una forma en la que usarás MiCentralMX.');
      return;
    }
    if (paso === 2 && mercancias.length === 0 && descripcion.trim().length < 2) {
      setError('Selecciona o escribe qué mercancía vende tu negocio.');
      return;
    }
    setPaso((actual) => Math.min(3, actual + 1));
  };

  const terminar = () => {
    setError(null);
    if (!aceptaTerminos || !aceptaPrivacidad) {
      setError('Debes aceptar los términos de uso y el aviso de privacidad para continuar.');
      return;
    }
    const datos: DatosOnboarding = {
      version: 1,
      negocioId,
      objetivos,
      mercancias,
      descripcionMercancias: descripcion.trim(),
      terminosVersion: VERSION_TERMINOS,
      completadoEn: new Date().toISOString(),
    };
    if (!guardarOnboarding(window.localStorage, datos)) {
      setError('No pudimos guardar la configuración en este dispositivo. Revisa que el navegador permita almacenamiento local.');
      return;
    }
    setCompletado(true);
  };

  const contenido = [
    <div className="onb-bienvenida" key="bienvenida">
      <span className="onb-ilustracion" aria-hidden="true"><Store /></span>
      <div className="onb-hero">
        <p className="onb-eyebrow"><Sparkles /> Configuración inicial</p>
        <h1 ref={tituloRef} tabIndex={-1}>Bienvenido a MiCentralMX</h1>
        <p>Configuremos la aplicación para conocer mejor cómo trabajas. Te tomará menos de un minuto.</p>
      </div>
      <div className="onb-beneficios" aria-label="Lo que podrás hacer">
        <span><ReceiptText /> Ventas y cobros</span>
        <span><PackageSearch /> Inventario</span>
        <span><Truck /> Proveedores</span>
      </div>
    </div>,
    <div className="onb-paso" key="objetivos">
      <div className="onb-encabezado">
        <p className="onb-eyebrow">Paso 1 de 3</p>
        <h1 ref={tituloRef} tabIndex={-1}>¿Para qué usarás MiCentralMX?</h1>
        <p>Puedes elegir todas las opciones que necesites.</p>
      </div>
      <div className="onb-opciones">
        {OBJETIVOS.map((opcion) => (
          <OpcionObjetivo key={opcion.id} opcion={opcion} activa={objetivos.includes(opcion.id)} alCambiar={() => setObjetivos(alternar(objetivos, opcion.id))} />
        ))}
      </div>
    </div>,
    <div className="onb-paso" key="mercancias">
      <div className="onb-encabezado">
        <p className="onb-eyebrow">Paso 2 de 3</p>
        <h1 ref={tituloRef} tabIndex={-1}>¿Qué vendes en tu negocio?</h1>
        <p>Esta información es solo de referencia y no creará productos automáticamente.</p>
      </div>
      <fieldset className="onb-fieldset">
        <legend>Selecciona una o varias opciones</legend>
        <div className="onb-chips">
          {MERCANCIAS.map((mercancia) => {
            const activa = mercancias.includes(mercancia);
            return (
              <button key={mercancia} type="button" className={`onb-chip${activa ? ' activa' : ''}`} aria-pressed={activa} onClick={() => setMercancias(alternar(mercancias, mercancia))}>
                {activa && <Check aria-hidden="true" />}{mercancia}
              </button>
            );
          })}
        </div>
      </fieldset>
      <label className="onb-campo" htmlFor="onb-descripcion">
        <span>Cuéntanos un poco más <small>(opcional)</small></span>
        <textarea id="onb-descripcion" className="inp" rows={4} maxLength={240} placeholder="Ej. Jitomate, aguacate, chile y cebolla por caja y por kilo" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        <small>{descripcion.length}/240</small>
      </label>
    </div>,
    <div className="onb-paso" key="terminos">
      <div className="onb-encabezado">
        <p className="onb-eyebrow">Paso 3 de 3</p>
        <h1 ref={tituloRef} tabIndex={-1}>Antes de comenzar</h1>
        <p>Revisa y acepta las condiciones para usar MiCentralMX en este dispositivo.</p>
      </div>
      <div className="onb-resumen">
        <BadgeCheck aria-hidden="true" />
        <div><strong>Todo está listo para {sesion.negocio.nombre}</strong><span>Podrás cambiar la configuración operativa desde la aplicación.</span></div>
      </div>
      <div className="onb-acuerdos">
        <details>
          <summary>Términos de uso</summary>
          <p>Usarás MiCentralMX para registrar información legítima de tu negocio, protegerás tus credenciales y verificarás que las operaciones pendientes se sincronicen antes de cambiar de dispositivo o borrar sus datos.</p>
        </details>
        <details>
          <summary>Aviso de privacidad</summary>
          <p>Estas preferencias de introducción se guardan únicamente en este dispositivo. Los datos operativos del negocio se almacenan localmente para trabajar sin conexión y se sincronizan con el servidor configurado por tu organización.</p>
        </details>
        <label className="onb-consentimiento">
          <input type="checkbox" checked={aceptaTerminos} onChange={(e) => setAceptaTerminos(e.target.checked)} />
          <span>Acepto los términos de uso de MiCentralMX.</span>
        </label>
        <label className="onb-consentimiento">
          <input type="checkbox" checked={aceptaPrivacidad} onChange={(e) => setAceptaPrivacidad(e.target.checked)} />
          <span>He leído y acepto el aviso de privacidad.</span>
        </label>
      </div>
    </div>,
  ][paso];

  return (
    <div className="onb">
      <header className="onb-top"><Marca tamano={36} texto={21} /></header>
      <main className="onb-contenedor">
        {paso > 0 && (
          <div className="onb-progreso" aria-label={`Paso ${paso} de 3`}>
            {[1, 2, 3].map((numero) => <span key={numero} className={numero <= paso ? 'activo' : ''} />)}
          </div>
        )}
        <section className="onb-card">{contenido}</section>
        {error && <p className="onb-error" role="alert">{error}</p>}
        <nav className="onb-acciones" aria-label="Navegación de configuración">
          {paso > 0 && <button type="button" className="btn btn-q btn-lg" onClick={() => { setError(null); setPaso(paso - 1); }}><ArrowLeft /> Atrás</button>}
          {paso < 3 ? (
            <button type="button" className="btn btn-p btn-lg" onClick={siguiente}>{paso === 0 ? 'Comenzar' : 'Continuar'} <ArrowRight /></button>
          ) : (
            <button type="button" className="btn btn-p btn-lg" onClick={terminar} disabled={!aceptaTerminos || !aceptaPrivacidad}><Check /> Entrar a MiCentralMX</button>
          )}
        </nav>
      </main>
      <footer className="onb-pie"><WalletCards /> Tus preferencias quedan guardadas en este dispositivo.</footer>
    </div>
  );
}
