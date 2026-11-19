export interface EntornoPwa {
  modoIndependiente: boolean;
  iosIndependiente: boolean;
  agenteMovil: boolean;
  punteroTactil: boolean;
  anchoPantalla: number;
  altoPantalla: number;
}

type NavegadorPwa = Navigator & {
  standalone?: boolean;
  userAgentData?: { mobile?: boolean };
};

export function detectarEntornoPwa(): EntornoPwa {
  const navegador = window.navigator as NavegadorPwa;
  return {
    modoIndependiente: window.matchMedia('(display-mode: standalone)').matches,
    iosIndependiente: navegador.standalone === true,
    agenteMovil:
      navegador.userAgentData?.mobile === true ||
      /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navegador.userAgent),
    punteroTactil: window.matchMedia('(pointer: coarse)').matches,
    anchoPantalla: window.screen.width,
    altoPantalla: window.screen.height,
  };
}

export function esPwaInstaladaMovil(entorno = detectarEntornoPwa()): boolean {
  const instalada = entorno.modoIndependiente || entorno.iosIndependiente;
  const ladoMenor = Math.min(entorno.anchoPantalla, entorno.altoPantalla);
  const dispositivoMovil = entorno.agenteMovil || (entorno.punteroTactil && ladoMenor <= 1024);
  return instalada && dispositivoMovil;
}
