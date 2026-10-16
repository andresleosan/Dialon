/**
 * Guarda un archivo descargado. Nativo: todavía no (sin dependencias nuevas); devuelve `undefined` y la interfaz lo
 * explica. En web, `saveFile.web.ts`. Si se guarda, devuelve cómo liberar lo que quede en memoria.
 */
export const saveFile: (bytes: Uint8Array, type: string, filename: string) => (() => void) | undefined = () => undefined;
