import { useColorScheme } from "react-native";

// Tokens de DESIGN.md (adaptación de Singapore Airlines Translation Assistant, sin su marca): cambiar un color
// exige recalcular su contraste. Cada mitad tiene su panel: B marino con texto blanco y A blanca con texto marino.
export interface Panel {
  readonly fondo: string;
  readonly texto: string;
  readonly texto2: string;
  readonly borde: string;
  readonly circulo: string;
  readonly sobreCirculo: string;
  readonly grabando: string;
  readonly sobreGrabando: string;
  readonly demo: string;
  readonly avisoFondo: string;
  readonly avisoTexto: string;
}

export interface Theme {
  readonly pantalla: string;
  readonly A: Panel;
  readonly B: Panel;
}

const light: Theme = {
  pantalla: "#FFFFFF",
  B: {
    fondo: "#12295C",
    texto: "#FFFFFF",
    texto2: "#C9D4EA",
    borde: "#AFC0E0",
    circulo: "#FFFFFF",
    sobreCirculo: "#12295C",
    grabando: "#FFB4AB",
    sobreGrabando: "#5F1411",
    demo: "#FFD98A",
    avisoFondo: "#FFE8A3",
    avisoTexto: "#3D2E00",
  },
  A: {
    fondo: "#FFFFFF",
    texto: "#12295C",
    texto2: "#4B5568",
    borde: "#6B7089",
    circulo: "#12295C",
    sobreCirculo: "#FFFFFF",
    grabando: "#B42318",
    sobreGrabando: "#FFFFFF",
    demo: "#6B4E00",
    avisoFondo: "#FFF4D6",
    avisoTexto: "#5C4400",
  },
};

const dark: Theme = {
  pantalla: "#121417",
  B: {
    fondo: "#0E2149",
    texto: "#FFFFFF",
    texto2: "#C2CDE6",
    borde: "#A3B4D8",
    circulo: "#E8EEFB",
    sobreCirculo: "#0E2149",
    grabando: "#FFB4AB",
    sobreGrabando: "#5F1411",
    demo: "#FFD98A",
    avisoFondo: "#3A2E00",
    avisoTexto: "#FFE08A",
  },
  A: {
    fondo: "#121417",
    texto: "#D6E3FF",
    texto2: "#B4B9C2",
    borde: "#8C929C",
    circulo: "#8AB4F8",
    sobreCirculo: "#0A1B33",
    grabando: "#F2B8B5",
    sobreGrabando: "#410E0B",
    demo: "#FFE08A",
    avisoFondo: "#3A2E00",
    avisoTexto: "#FFE08A",
  },
};

/** Tema claro u oscuro según el sistema. */
export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}
