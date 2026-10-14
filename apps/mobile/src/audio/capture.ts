import type { AudioInfo, ParseResult } from "@dialon/contracts";

/** Clip local de un turno: bytes reales y metadatos ya validados con `validateAudio`. */
export interface AudioClip {
  /** Web: Blob en memoria. Un adaptador nativo usará la URI de su archivo local. */
  readonly audio: Blob | { readonly uri: string };
  readonly info: Required<AudioInfo>;
}

/** Grabación en curso. */
export interface Recording {
  /** Termina la grabación (segundo toque). Repetirla no hace nada. */
  stop(): void;
  /**
   * Se cumple una sola vez: al detener, al llegar al límite de tiempo o de tamaño, o si falla la grabación.
   * Si se cancela la señal de `start`, se rechaza con su motivo y nunca entrega audio.
   */
  readonly result: Promise<ParseResult<AudioClip>>;
}

/** Grabador inyectable (web hoy; un adaptador nativo implementará lo mismo). */
export interface AudioCapture {
  /**
   * Pide el micrófono y empieza a grabar. `signal` cancela en cualquier momento, también con el permiso pendiente:
   * libera el micrófono y la promesa se rechaza con el motivo de la cancelación.
   */
  start(signal: AbortSignal): Promise<ParseResult<Recording>>;
}

/** Reproductor local inyectable. */
export interface AudioPlayer {
  /** Reproduce el clip desde el principio. Se cumple al terminar o al cancelar `signal`; se rechaza si falla. */
  play(clip: AudioClip, signal: AbortSignal): Promise<void>;
}

/** Audio local inyectado en la conversación: en web, grabación y reproducción reales del navegador. */
export interface LocalAudio {
  readonly capture: AudioCapture;
  readonly player: AudioPlayer;
}
