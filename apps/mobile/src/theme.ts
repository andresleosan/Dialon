import type { Participant } from "@dialon/core";

// Paleta fija aprobada por Luis el 2026-10-14 (maqueta marino/blanco): no sigue el tema oscuro del sistema.
// Cambiar un color exige recalcular su contraste (DESIGN.md). Algunos grises de la maqueta se oscurecieron lo
// mínimo para llegar a 4,5:1 en texto pequeño.
export const COLORS = {
  marino: "#12295C",
  blanco: "#FFFFFF",
  fondo: "#EEF1F6",
  tinta: "#142747",
  apagado: "#606D82",
  linea: "#DCE2EB",
  demoFondo: "#DFE6F0",
  demoTexto: "#223D68",
  pildora: "#CED6E3",
  cabeceraModo: "#5C6E8A",
  velo: "rgba(17, 40, 75, 0.27)",
} as const;

/** Colores del selector de idioma (superficie blanca). */
export const PICKER = {
  borde: "#D7DEEA",
  ceja: "#5E7090",
  cerrarFondo: "#F1F4F8",
  cerrarIcono: "#455979",
  buscadorBorde: "#CDD6E6",
  buscadorIcono: "#657692",
  marcador: "#65768E",
  lista: "#69768A",
  actual: "#EDF2F9",
  autonimo: "#626D83",
  etiqueta: "#606D82",
  etiquetaBorde: "#DDE3EC",
  etiquetaFondo: "#F8FAFC",
  demoTexto: "#27496E",
  demoBorde: "#D0DBE9",
  demoFondo: "#E9EFF7",
  pie: "#67758B",
  pieLinea: "#E0E6EF",
} as const;

// Cada mitad tiene su panel: B marino con texto blanco y A blanca con texto marino.
export interface Panel {
  readonly fondo: string;
  readonly borde: string;
  readonly texto: string;
  readonly ceja: string;
  readonly nota: string;
  readonly linea: string;
  readonly selectorFondo: string;
  readonly selectorBorde: string;
  readonly circulo: string;
  readonly sobreCirculo: string;
  readonly anillo: string;
  readonly apagado: string;
  readonly grabando: string;
  readonly sobreGrabando: string;
  readonly avisoFondo: string;
  readonly avisoTexto: string;
}

// Por tono, no por persona: en el teléfono B es marino y A blanca; en escritorio, al revés (ver `panelOf`).
const PANELS = {
  navy: {
    fondo: COLORS.marino,
    borde: COLORS.marino,
    texto: COLORS.blanco,
    ceja: "#BFCDE7",
    nota: "#C2CEE4",
    linea: "rgba(255, 255, 255, 0.16)",
    selectorFondo: "rgba(255, 255, 255, 0.07)",
    selectorBorde: "rgba(255, 255, 255, 0.19)",
    circulo: COLORS.blanco,
    sobreCirculo: COLORS.marino,
    anillo: "rgba(255, 255, 255, 0.055)",
    apagado: "#AFC0E0",
    grabando: "#FFB4AB",
    sobreGrabando: "#5F1411",
    avisoFondo: "#FFE8A3",
    avisoTexto: "#3D2E00",
  },
  white: {
    fondo: COLORS.blanco,
    borde: COLORS.linea,
    texto: COLORS.marino,
    ceja: "#657594",
    nota: "#62718C",
    linea: "#E1E6EE",
    selectorFondo: "#F1F4F9",
    selectorBorde: "#DCE3EF",
    circulo: COLORS.marino,
    sobreCirculo: COLORS.blanco,
    anillo: "rgba(18, 41, 92, 0.03)",
    apagado: "#6B7089",
    grabando: "#B42318",
    sobreGrabando: COLORS.blanco,
    avisoFondo: "#FFF4D6",
    avisoTexto: "#5C4400",
  },
} as const satisfies Readonly<Record<string, Panel>>;

/**
 * Colores del panel de cada persona según dónde se dibuja. Teléfono: B marino arriba (girada) y A blanca abajo.
 * Escritorio: A marino a la izquierda y B blanca a la derecha. Solo cambia el aspecto; la persona sigue siendo la misma.
 */
export function panelOf(participant: Participant, desktop: boolean): Panel {
  const navy = desktop ? participant === "A" : participant === "B";
  return navy ? PANELS.navy : PANELS.white;
}
