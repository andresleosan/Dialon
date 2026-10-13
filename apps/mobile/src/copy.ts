import type { ErrorCode } from "@dialon/contracts";

/** Idiomas con textos de interfaz. Cada mitad muestra los suyos en el idioma de su persona. */
export const UI_LANGUAGES = ["es", "en"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export type ButtonKey = "start" | "preparing" | "finish" | "translating" | "stopVoice" | "stopping" | "wait";
export type StatusKey =
  | "ready"
  | "preparing"
  | "listening"
  | "otherSpeaking"
  | "translating"
  | "speaking"
  | "stopping";

interface Copy {
  readonly languageName: string;
  readonly languageGroup: string;
  readonly demoBanner: string;
  readonly noAudio: string;
  readonly empty: string;
  readonly youSaid: string;
  readonly cancel: string;
  readonly button: Readonly<Record<ButtonKey, string>>;
  readonly status: Readonly<Record<StatusKey, string>>;
  readonly notices: Readonly<Partial<Record<ErrorCode, string>>>;
  readonly noticeFallback: string;
}

export const COPY: Readonly<Record<UiLanguage, Copy>> = {
  es: {
    languageName: "Español",
    languageGroup: "Idioma",
    demoBanner: "DEMO: traducción simulada, no real",
    noAudio: "No usa el micrófono ni reproduce audio.",
    empty: "Conversación de ejemplo: toca el botón y verás una frase traducida en la otra mitad.",
    youSaid: "Dijiste:",
    cancel: "Cancelar",
    button: {
      start: "Toca para hablar",
      preparing: "Preparando…",
      finish: "Escucha simulada: toca para terminar",
      translating: "Traduciendo…",
      stopVoice: "Detener voz simulada",
      stopping: "Deteniendo…",
      wait: "Espera: habla la otra persona",
    },
    status: {
      ready: "Listo",
      preparing: "Preparando",
      listening: "Escucha simulada",
      otherSpeaking: "Habla la otra persona",
      translating: "Traducción simulada",
      speaking: "Voz simulada",
      stopping: "Deteniendo",
    },
    notices: {
      MIC_PERMISSION_DENIED: "Dialon necesita el micrófono. Actívalo en Ajustes.",
      TOO_SHORT: "Muy corto. Toca, habla y vuelve a tocar.",
      NO_SPEECH: "No se oyó nada. Inténtalo de nuevo.",
      SERVICE_UNAVAILABLE: "El traductor no está disponible ahora.",
      NETWORK: "Sin conexión. Revisa tu red.",
      VOICE_UNAVAILABLE: "No hay voz para este idioma: lee la traducción.",
      PLAYBACK_INTERRUPTED: "La voz se interrumpió: lee la traducción.",
      UNSUPPORTED_LANGUAGE: "Elige un idioma distinto para cada persona.",
    },
    noticeFallback: "Algo falló. Inténtalo de nuevo.",
  },
  en: {
    languageName: "English",
    languageGroup: "Language",
    demoBanner: "DEMO: simulated translation, not real",
    noAudio: "It doesn't use the microphone or play audio.",
    empty: "Example conversation: tap the button to see a translated phrase on the other half.",
    youSaid: "You said:",
    cancel: "Cancel",
    button: {
      start: "Tap to speak",
      preparing: "Getting ready…",
      finish: "Simulated listening: tap to finish",
      translating: "Translating…",
      stopVoice: "Stop simulated voice",
      stopping: "Stopping…",
      wait: "Wait: the other person is speaking",
    },
    status: {
      ready: "Ready",
      preparing: "Getting ready",
      listening: "Simulated listening",
      otherSpeaking: "The other person is speaking",
      translating: "Simulated translation",
      speaking: "Simulated voice",
      stopping: "Stopping",
    },
    notices: {
      MIC_PERMISSION_DENIED: "Dialon needs the microphone. Turn it on in Settings.",
      TOO_SHORT: "Too short. Tap, speak, then tap again.",
      NO_SPEECH: "Nothing was heard. Try again.",
      SERVICE_UNAVAILABLE: "The translator isn't available right now.",
      NETWORK: "No connection. Check your network.",
      VOICE_UNAVAILABLE: "No voice for this language: read the translation.",
      PLAYBACK_INTERRUPTED: "The voice was interrupted: read the translation.",
      UNSUPPORTED_LANGUAGE: "Choose a different language for each person.",
    },
    noticeFallback: "Something went wrong. Try again.",
  },
};

export function isUiLanguage(code: string): code is UiLanguage {
  return UI_LANGUAGES.some((language) => language === code);
}
