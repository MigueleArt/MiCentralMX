/** Logotipo del prototipo: puesto con toldo ámbar sobre fondo verde. */
export function Logotipo({ tamano = 32 }: { tamano?: number }) {
  return (
    <svg width={tamano} height={tamano} viewBox="0 0 32 32" aria-hidden="true" style={{ flex: 'none' }}>
      <rect width="32" height="32" rx="8" fill="#176B5B" />
      <path d="M6 10h20v3a3.33 3.33 0 0 1-6.67 0 3.33 3.33 0 0 1-6.66 0A3.33 3.33 0 0 1 6 13z" fill="#D97706" />
      <path d="M8 17.5V24h16v-6.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      <path d="M14 24v-4h4v4" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function Marca({ tamano = 32, texto = 20 }: { tamano?: number; texto?: number }) {
  return (
    <div className="fila" style={{ gap: 10 }}>
      <Logotipo tamano={tamano} />
      <span className="marca" style={{ fontSize: texto }}>
        MiCentral<span>MX</span>
      </span>
    </div>
  );
}
