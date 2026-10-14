import type { AudioPlayer } from "./capture";

function asError(error: unknown) {
  return error instanceof Error ? error : new Error("no se pudo reproducir el audio");
}

/**
 * Reproducción local en el navegador, solo de clips grabados aquí (Blob). Cada reproducción crea su propia URL del
 * Blob y la revoca al terminar, al fallar (también si algo lanza en el acto) o al cancelarse: repetir siempre
 * funciona y no quedan URLs vivas. Un clip con URI es de un adaptador nativo y se rechaza: nunca se pide nada a la red.
 */
export const webAudioPlayer: AudioPlayer = {
  play(clip, signal) {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const { audio } = clip;
      if ("uri" in audio) {
        reject(new TypeError("el reproductor web solo reproduce clips locales"));
        return;
      }
      let url: string | undefined;
      let element: HTMLAudioElement | undefined;
      let done = false;

      const finish = (error?: Error) => {
        if (done) return;
        done = true;
        signal.removeEventListener("abort", onAbort);
        if (element) {
          element.onended = null;
          element.onerror = null;
          element.pause();
          element.removeAttribute("src");
          element.load();
        }
        if (url !== undefined) URL.revokeObjectURL(url);
        if (error === undefined) resolve();
        else reject(error);
      };
      const onAbort = () => {
        finish();
      };

      try {
        url = URL.createObjectURL(audio);
        element = new Audio(url);
        element.onended = () => {
          finish();
        };
        element.onerror = () => {
          finish(new Error("no se pudo reproducir el audio"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        element.play().catch((error: unknown) => {
          finish(asError(error));
        });
      } catch (error) {
        finish(asError(error));
      }
    });
  },
};
