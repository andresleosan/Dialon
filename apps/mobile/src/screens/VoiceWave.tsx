import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

export interface WaveColors {
  /** Trazo principal: el color del texto del panel (máximo contraste). */
  readonly primary: string;
  /** Trazos secundarios: tokens de texto del panel, también ≥4,5:1 sobre su fondo. */
  readonly secondary: string;
  readonly tertiary: string;
}

interface VoiceWaveProps {
  /** Último RMS medido del micrófono (0..1), tal como lo entrega el medidor. */
  readonly level: number;
  readonly height: number;
  readonly colors: WaveColors;
}

// Ancho lógico del dibujo: el SVG se estira al ancho de la zona de lectura y los trazos conservan su grosor.
const VIEW_WIDTH = 320;
const POINTS = 64;
// Suavizado modesto: sube rápido con la voz y cae enseguida al callar.
const ATTACK_MS = 90;
const DECAY_MS = 90;
// Por debajo de esto, en silencio, la onda se da por plana y la animación se detiene.
const SETTLE = 0.01;
// Radianes por segundo a intensidad máxima: la fase solo avanza en proporción a la voz medida.
const PHASE_SPEED = 6;
const REDUCE_MOTION = "(prefers-reduced-motion: reduce)";

// Varias curvas superpuestas, como una cinta: misma envolvente centrada, frecuencias y desfases distintos.
const LAYERS = [
  { tone: "tertiary", gain: 0.42, cycles: 2.8, offset: 3.1, drift: 1.3, width: 1 },
  { tone: "secondary", gain: 0.58, cycles: 2.2, offset: 1.9, drift: -0.8, width: 1.1 },
  { tone: "secondary", gain: 0.8, cycles: 1.6, offset: 0.55, drift: 1, width: 1.3 },
  { tone: "primary", gain: 1, cycles: 1.6, offset: 0, drift: 1, width: 2.2 },
] as const;
const MAX_STROKE = 2.2;

interface Wave {
  /** Intensidad visual suavizada, 0..1. */
  readonly amp: number;
  readonly phase: number;
}

/** Pistas del navegador; ninguna existe en nativo. */
interface WebMotion {
  readonly matchMedia?: (query: string) => MediaQueryList;
  readonly requestAnimationFrame?: typeof requestAnimationFrame;
  readonly cancelAnimationFrame?: typeof cancelAnimationFrame;
}

// Suelo solo visual: el procesado del micrófono del navegador deja colas de RMS diminutas (1e-10, 1e-15…) tras la
// voz que no moverían ni un subpíxel pero mantendrían viva la animación. No toca el audio grabado ni es una puerta de
// audio: una voz débil (RMS ~0,005) queda muy por encima.
const QUIET_FLOOR = 1e-4;

/**
 * RMS → intensidad visual 0..1. La voz normal ronda RMS 0,02–0,2: la raíz la hace visible sin inventar nada. Un valor
 * no finito, negativo o bajo el suelo visual cuenta como silencio.
 */
function visualLevel(level: number): number {
  return Number.isFinite(level) && level >= QUIET_FLOOR ? Math.min(1, Math.sqrt(level) * 1.6) : 0;
}

/** Sigue `prefers-reduced-motion`, también si cambia durante la grabación. */
function useReducedMotion(web: boolean): boolean {
  const [reduced, setReduced] = useState(
    () => web && (globalThis as WebMotion).matchMedia?.(REDUCE_MOTION).matches === true,
  );
  useEffect(() => {
    if (!web) return undefined;
    const query = (globalThis as WebMotion).matchMedia?.(REDUCE_MOTION);
    if (!query) return undefined;
    const update = () => {
      setReduced(query.matches);
    };
    query.addEventListener("change", update);
    return () => {
      query.removeEventListener("change", update);
    };
  }, [web]);
  return reduced;
}

/** Envolvente centrada: huso en el medio y colas tranquilas en los extremos. */
function envelope(x: number): number {
  return Math.sin(Math.PI * x) ** 1.5;
}

function pathOf(layer: (typeof LAYERS)[number], amplitude: number, phase: number, height: number): string {
  const middle = height / 2;
  const points: string[] = [];
  for (let i = 0; i <= POINTS; i += 1) {
    const x = i / POINTS;
    const wave = Math.sin(2 * Math.PI * layer.cycles * x + layer.offset + layer.drift * phase);
    const y = middle + amplitude * layer.gain * envelope(x) * wave;
    points.push(`${(x * VIEW_WIDTH).toFixed(1)} ${y.toFixed(2)}`);
  }
  return `M${points.join(" L")}`;
}

/**
 * Onda de voz de quien graba (solo web, SVG propio): curvas suaves superpuestas cuya amplitud sigue el RMS real del
 * micrófono. Con voz se mueve con suavidad; en silencio queda una línea plana y quieta y no pide cuadros. Con
 * movimiento reducido muestra la intensidad medida al momento, sin animación. En nativo no dibuja nada: allí no hay
 * captura real todavía.
 */
export function VoiceWave({ level, height, colors }: VoiceWaveProps) {
  const web = Platform.OS === "web";
  const reduced = useReducedMotion(web);
  const target = visualLevel(level);
  const [wave, setWave] = useState<Wave>({ amp: 0, phase: 0 });
  // Copia de trabajo de la animación: los cuadros la leen y escriben sin esperar a React.
  const latest = useRef(wave);

  useEffect(() => {
    const browser = globalThis as WebMotion;
    const { requestAnimationFrame: request, cancelAnimationFrame: cancel } = browser;
    if (!web || reduced || !request) return undefined;
    if (target === 0 && latest.current.amp === 0) return undefined;
    let frame: number | undefined;
    let last: number | undefined;
    // Un cuadro ya cancelado que el navegador entregue tarde no pinta ni pide otro.
    let disposed = false;
    const tick = (time: number) => {
      if (disposed) return;
      const elapsed = last === undefined ? 16 : Math.min(100, Math.max(0, time - last));
      last = time;
      const { amp, phase } = latest.current;
      let next = amp + (target - amp) * Math.min(1, elapsed / (target > amp ? ATTACK_MS : DECAY_MS));
      if (target === 0 && next < SETTLE) next = 0;
      const state = { amp: next, phase: phase + (elapsed / 1000) * PHASE_SPEED * next };
      latest.current = state;
      setWave(state);
      frame = target === 0 && next === 0 ? undefined : request(tick);
    };
    frame = request(tick);
    return () => {
      disposed = true;
      if (frame !== undefined) cancel?.(frame);
    };
  }, [web, reduced, target]);

  if (!web) return null;
  const amplitude = (reduced ? target : wave.amp) * (height / 2 - MAX_STROKE / 2);
  return (
    <svg
      aria-hidden
      focusable="false"
      width="100%"
      height={height}
      viewBox={`0 0 ${String(VIEW_WIDTH)} ${String(height)}`}
      preserveAspectRatio="none"
      style={{ display: "block", overflow: "visible" }}
    >
      {LAYERS.map((layer, index) => (
        <path
          // Capas fijas: el índice identifica cada curva.
          key={index}
          d={pathOf(layer, amplitude, wave.phase, height)}
          fill="none"
          stroke={colors[layer.tone]}
          strokeWidth={layer.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
