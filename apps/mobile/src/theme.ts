import { useColorScheme } from "react-native";

// Tokens de DESIGN.md (borrador pendiente de aprobación): cambiar un color exige recalcular su contraste.
const light = {
  fondo: "#FFFFFF",
  superficie: "#F3F4F6",
  texto: "#1B1D20",
  texto2: "#4B5059",
  acento: "#1D5BBF",
  sobreAcento: "#FFFFFF",
  grabando: "#B42318",
  sobreGrabando: "#FFFFFF",
  contorno: "#6B7079",
  avisoFondo: "#FFF4D6",
  avisoTexto: "#5C4400",
};

export type Theme = typeof light;

const dark: Theme = {
  fondo: "#121417",
  superficie: "#1C1F24",
  texto: "#E8EAED",
  texto2: "#B4B9C2",
  acento: "#8AB4F8",
  sobreAcento: "#0A1B33",
  grabando: "#F2B8B5",
  sobreGrabando: "#410E0B",
  contorno: "#8C929C",
  avisoFondo: "#3A2E00",
  avisoTexto: "#FFE08A",
};

/** Tema claro u oscuro según el sistema. */
export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}
