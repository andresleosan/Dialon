import type { PanelName, PanelRoute } from "./panelRoute";

export type { PanelName, PanelRoute } from "./panelRoute";

// Web: el panel va en la URL del mismo origen (`?panel=subscription` / `?panel=admin`). Que la URL pida «admin» no da
// acceso a nada: el panel solo se dibuja si el backend dice que la cuenta es la del propietario.

function parse(search: string): PanelName | undefined {
  const value = new URLSearchParams(search).get("panel");
  return value === "subscription" || value === "admin" ? value : undefined;
}

export const panelRoute: PanelRoute = {
  read: () => parse(window.location.search),
  write(panel) {
    const url = new URL(window.location.href);
    if (panel === undefined) url.searchParams.delete("panel");
    else url.searchParams.set("panel", panel);
    window.history.pushState(null, "", url);
  },
  subscribe(onChange) {
    const listener = () => {
      onChange(parse(window.location.search));
    };
    window.addEventListener("popstate", listener);
    return () => {
      window.removeEventListener("popstate", listener);
    };
  },
};
