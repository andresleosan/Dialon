// Nativo: sin URL, no hay paneles de cuenta (la app nativa sigue siendo la DEMO). En web, `panelRoute.web.ts` usa
// `?panel=subscription` y `?panel=admin` en el mismo origen.

export type PanelName = "subscription" | "admin";

export interface PanelRoute {
  read(): PanelName | undefined;
  write(panel: PanelName | undefined): void;
  /** Avisa si el usuario navega con atrás/adelante; devuelve cómo dejar de escuchar. */
  subscribe(onChange: (panel: PanelName | undefined) => void): () => void;
}

export const panelRoute: PanelRoute = {
  read: () => undefined,
  write: () => undefined,
  subscribe: () => () => undefined,
};
