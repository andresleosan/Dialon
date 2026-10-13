export interface Limits {
  /** Por debajo se considera un toque accidental (TOO_SHORT). */
  readonly minAudioMs: number;
  /** El cliente debe detener la grabación con margen antes de llegar aquí. */
  readonly maxAudioMs: number;
  readonly maxAudioBytes: number;
  /** Máximo para transcripción, traducción y mensajes de error. */
  readonly maxTextChars: number;
  /** Tipos MIME base admitidos; se confirman contra el ASR real cuando se conecte el Mac. */
  readonly audioTypes: readonly string[];
  /** Idiomas ofrecidos (ISO 639, minúsculas). */
  readonly languages: readonly string[];
}

export const DEFAULT_LIMITS: Limits = {
  minAudioMs: 300,
  maxAudioMs: 30_000,
  maxAudioBytes: 2 * 1024 * 1024,
  maxTextChars: 2_000,
  audioTypes: ["audio/mp4", "audio/aac", "audio/webm", "audio/wav"],
  languages: ["es", "en"],
};

export const LANGUAGE_CODE = /^[a-z]{2,3}$/;
const AUDIO_TYPE = /^audio\/[a-z0-9.+-]+$/;

/** Combina los valores por defecto con la configuración y lanza si el resultado es incoherente. */
export function createLimits(overrides: Partial<Limits> = {}): Limits {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const key of ["minAudioMs", "maxAudioMs", "maxAudioBytes", "maxTextChars"] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0) {
      throw new RangeError(`Límite inválido: ${key} debe ser un entero positivo`);
    }
  }
  if (limits.minAudioMs >= limits.maxAudioMs) {
    throw new RangeError("Límite inválido: minAudioMs debe ser menor que maxAudioMs");
  }
  if (limits.audioTypes.length === 0 || !limits.audioTypes.every((type) => AUDIO_TYPE.test(type))) {
    throw new RangeError("Límite inválido: audioTypes debe contener tipos audio/*");
  }
  const distinctLanguages = new Set(limits.languages).size;
  if (
    distinctLanguages < 2 ||
    distinctLanguages !== limits.languages.length ||
    !limits.languages.every((code) => LANGUAGE_CODE.test(code))
  ) {
    throw new RangeError("Límite inválido: languages necesita al menos dos códigos ISO 639 distintos, sin repetir");
  }
  return limits;
}
