import type { ErrorCode } from "@dialon/contracts";
import type { Participant } from "@dialon/core";

/** Idiomas con textos de interfaz y ejemplos DEMO. Cada mitad muestra sus textos en el idioma de su persona. */
export const UI_LANGUAGES = ["es", "en"] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

/**
 * Catálogo del selector. Solo los de UI_LANGUAGES tienen textos y ejemplos DEMO; el resto está por validar: se
 * pueden elegir, pero bloquean «Hablar» (ningún idioma usa traducción real todavía).
 */
export const LANGUAGES = ["es", "en", "pt", "fr", "de", "it"] as const;
export type Language = (typeof LANGUAGES)[number];

/** Nombre de cada idioma en su propia lengua (autónimo). */
export const AUTONYMS: Readonly<Record<Language, string>> = {
  es: "Español",
  en: "English",
  pt: "Português",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
};

// Sin textos propios, la mitad de un idioma por validar sigue en el idioma de interfaz inicial de su persona.
const FALLBACK_UI: Readonly<Record<Participant, UiLanguage>> = { A: "es", B: "en" };

export type ButtonKey =
  | "start"
  | "blocked"
  | "preparing"
  | "finish"
  | "translating"
  | "stopVoice"
  | "stopping"
  | "wait";
export type StatusKey =
  | "ready"
  | "preparing"
  | "listening"
  | "otherSpeaking"
  | "translating"
  | "speaking"
  | "stopping";
export type PairIssue = "same" | "pending";

export interface Copy {
  /** «Persona» / «Person»: se le añade la letra de la mitad. */
  readonly person: string;
  readonly languageNames: Readonly<Record<Language, string>>;
  readonly iSpeak: string;
  readonly languageLocked: string;
  readonly pair: Readonly<Record<PairIssue, string>>;
  readonly emptyEyebrow: string;
  readonly emptyTitle: string;
  readonly guide: string;
  readonly demoNote: string;
  readonly saidEyebrow: string;
  readonly receivedEyebrow: string;
  readonly sampleNote: string;
  readonly listenNote: string;
  readonly cancel: string;
  /** Nombre accesible completo del botón principal (se le añade el idioma). */
  readonly button: Readonly<Record<ButtonKey, string>>;
  /** Etiqueta visible bajo el micrófono: corta y contenida en el nombre completo. */
  readonly buttonShort: Readonly<Record<ButtonKey, string>>;
  readonly status: Readonly<Record<StatusKey, string>>;
  readonly notices: Readonly<Partial<Record<ErrorCode, string>>>;
  readonly noticeFallback: string;
  /** Web con audio local: grabación real en el dispositivo, sin traducción todavía. */
  readonly local: {
    readonly note: string;
    readonly listening: string;
    readonly finishing: string;
    readonly finish: string;
    readonly finishingButton: string;
    readonly clipEyebrow: string;
    readonly clipNote: string;
    readonly replay: string;
    readonly stopPlayback: string;
    readonly playFailed: string;
    /** Permiso del micrófono denegado: en web se concede en el navegador, no en los Ajustes del sistema. */
    readonly micDenied: string;
    /** Separador decimal de la duración del clip. */
    readonly decimal: string;
  };
  readonly picker: {
    readonly title: string;
    readonly close: string;
    readonly search: string;
    readonly listLabel: string;
    readonly demo: string;
    readonly pending: string;
    readonly noResults: string;
    readonly foot: string;
  };
}

export const COPY: Readonly<Record<UiLanguage, Copy>> = {
  es: {
    person: "Persona",
    languageNames: { es: "Español", en: "Inglés", pt: "Portugués", fr: "Francés", de: "Alemán", it: "Italiano" },
    iSpeak: "Yo hablo",
    languageLocked: "El idioma se cambia al terminar el turno.",
    pair: {
      same: "Hablar no está disponible: elige un idioma distinto para cada persona.",
      pending:
        "Hablar no está disponible: la demo solo tiene ejemplos en español e inglés; los demás idiomas están por validar.",
    },
    emptyEyebrow: "Tu traducción",
    emptyTitle: "Habla y lee\nla traducción.",
    guide: "Toca Hablar. Toca de nuevo para terminar.",
    demoNote: "Demo: sin audio ni traducción real.",
    saidEyebrow: "Lo que dijiste",
    receivedEyebrow: "Traducción para ti",
    sampleNote: "Frase de ejemplo · traducción simulada",
    listenNote: "Una conversación,\nun turno a la vez.",
    cancel: "Cancelar",
    button: {
      start: "Toca para hablar",
      blocked: "Hablar no disponible",
      preparing: "Preparando…",
      finish: "Escucha simulada: toca para terminar",
      translating: "Traduciendo…",
      stopVoice: "Detener voz simulada",
      stopping: "Deteniendo…",
      wait: "Espera: habla la otra persona",
    },
    buttonShort: {
      start: "Hablar",
      blocked: "Hablar",
      preparing: "Preparando…",
      finish: "Terminar",
      translating: "Traduciendo…",
      stopVoice: "Detener",
      stopping: "Deteniendo…",
      wait: "Espera",
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
      RECORDER_FAILED: "No se pudo grabar audio en este navegador.",
      INVALID_AUDIO: "No se grabó audio. Inténtalo de nuevo.",
      AUDIO_TOO_LARGE: "El audio es demasiado grande. Graba un turno más corto.",
      AUDIO_TOO_LONG: "Demasiado largo. Graba hasta 30 segundos.",
    },
    noticeFallback: "Algo falló. Inténtalo de nuevo.",
    local: {
      note: "Graba audio en este dispositivo; la traducción aún no está disponible.",
      listening: "Grabando",
      finishing: "Terminando",
      finish: "Grabando: toca para terminar",
      finishingButton: "Terminando…",
      clipEyebrow: "Tu audio",
      clipNote: "Audio local · traducción pendiente",
      replay: "Escuchar",
      stopPlayback: "Detener",
      playFailed: "No se pudo reproducir el audio.",
      micDenied: "Permite el micrófono en el navegador para grabar.",
      decimal: ",",
    },
    picker: {
      title: "Elige tu idioma",
      close: "Cerrar selector de idioma",
      search: "Buscar idioma",
      listLabel: "Idiomas para esta conversación",
      demo: "Demo",
      pending: "Por validar",
      noResults: "No se encontraron idiomas.",
      foot: "Español e inglés tienen ejemplos en la demo. Los demás están pendientes de validar; ningún idioma usa traducción real todavía.",
    },
  },
  en: {
    person: "Person",
    languageNames: { es: "Spanish", en: "English", pt: "Portuguese", fr: "French", de: "German", it: "Italian" },
    iSpeak: "I speak",
    languageLocked: "You can change the language after the turn.",
    pair: {
      same: "Speak is unavailable: choose a different language for each person.",
      pending:
        "Speak is unavailable: the demo only has examples in Spanish and English; other languages are pending validation.",
    },
    emptyEyebrow: "Your translation",
    emptyTitle: "Speak and read\nthe translation.",
    guide: "Tap Speak. Tap again to finish.",
    demoNote: "Demo: no real audio or translation.",
    saidEyebrow: "What you said",
    receivedEyebrow: "Translation for you",
    sampleNote: "Example phrase · simulated translation",
    listenNote: "Your conversation,\none turn at a time.",
    cancel: "Cancel",
    button: {
      start: "Tap to speak",
      blocked: "Speak unavailable",
      preparing: "Getting ready…",
      finish: "Simulated listening: tap to finish",
      translating: "Translating…",
      stopVoice: "Stop simulated voice",
      stopping: "Stopping…",
      wait: "Wait: the other person is speaking",
    },
    buttonShort: {
      start: "Speak",
      blocked: "Speak",
      preparing: "Getting ready…",
      finish: "Finish",
      translating: "Translating…",
      stopVoice: "Stop",
      stopping: "Stopping…",
      wait: "Wait",
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
      RECORDER_FAILED: "Couldn't record audio in this browser.",
      INVALID_AUDIO: "No audio was recorded. Try again.",
      AUDIO_TOO_LARGE: "The audio is too large. Record a shorter turn.",
      AUDIO_TOO_LONG: "Too long. Record up to 30 seconds.",
    },
    noticeFallback: "Something went wrong. Try again.",
    local: {
      note: "Records audio on this device; translation isn't available yet.",
      listening: "Recording",
      finishing: "Finishing",
      finish: "Recording: tap to finish",
      finishingButton: "Finishing…",
      clipEyebrow: "Your audio",
      clipNote: "Local audio · translation pending",
      replay: "Replay",
      stopPlayback: "Stop",
      playFailed: "Couldn't play the audio.",
      micDenied: "Allow the microphone in your browser to record.",
      decimal: ".",
    },
    picker: {
      title: "Choose your language",
      close: "Close language picker",
      search: "Search language",
      listLabel: "Languages for this conversation",
      demo: "Demo",
      pending: "Pending",
      noResults: "No languages found.",
      foot: "Spanish and English have demo examples. The others are pending validation; no language uses real translation yet.",
    },
  },
};

/** Textos generales de la pantalla (cabecera, vista y pie), en español. */
export const CHROME = {
  brand: "dialon",
  demo: "DEMO",
  faceToFaceHeader: "Cara a cara · 50/50",
  title: "Conversación",
  subtitle: "Cada persona elige su idioma y habla por turnos.",
  footer: "Frases de ejemplo. Sin micrófono, audio ni traducción real.",
  footerLocal: "Audio local en este navegador. Sin traducción real todavía.",
} as const;

/** Textos de una mitad con audio local: misma interfaz, pero grabar y terminar dicen lo que de verdad ocurre. */
export function withLocalAudio(copy: Copy): Copy {
  const { local } = copy;
  return {
    ...copy,
    demoNote: local.note,
    button: { ...copy.button, finish: local.finish, translating: local.finishingButton },
    buttonShort: { ...copy.buttonShort, translating: local.finishingButton },
    status: { ...copy.status, listening: local.listening, translating: local.finishing },
    notices: { ...copy.notices, MIC_PERMISSION_DENIED: local.micDenied },
  };
}

/** «2,5 s · 40 KB»: duración y tamaño reales del clip. */
export function clipSummary(copy: Copy, durationMs: number, byteLength: number): string {
  const seconds = (durationMs / 1000).toFixed(1).replace(".", copy.local.decimal);
  return `${seconds} s · ${String(Math.max(1, Math.round(byteLength / 1024)))} KB`;
}

export function isUiLanguage(code: string): code is UiLanguage {
  return UI_LANGUAGES.some((language) => language === code);
}

/** Idioma de los textos de una mitad: el de su persona o, si está por validar, su respaldo. */
export function uiLanguageOf(participant: Participant, language: Language): UiLanguage {
  return isUiLanguage(language) ? language : FALLBACK_UI[participant];
}
