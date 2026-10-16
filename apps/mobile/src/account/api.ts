// Ruta relativa a propósito: la app aún no declara `@dialon/api-client` como dependencia (enlazarla exige instalar).
import { createApiClient, type ApiClient } from "../../../../packages/api-client/src";

export type { ApiClient, DownloadedReceipt } from "../../../../packages/api-client/src";

/**
 * Cliente del API solo si hay URL pública configurada (`EXPO_PUBLIC_DIALON_API_URL`, vacía por defecto) y el proveedor
 * de sesión sabe dar el ID token. Sin eso: `undefined`, ningún panel de cuenta y ninguna petición.
 */
export function createAccountApi(source: object | undefined, baseUrl: string | undefined): ApiClient | undefined {
  const url = baseUrl?.trim() ?? "";
  if (url === "" || source === undefined || !("getIdToken" in source) || typeof source.getIdToken !== "function") return undefined;
  const getIdToken = source.getIdToken as () => Promise<string | null>;
  try {
    return createApiClient({ baseUrl: url, getIdToken: () => getIdToken.call(source) });
  } catch {
    // URL no válida (no https, con credenciales…): como si no hubiera API.
    return undefined;
  }
}
