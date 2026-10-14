import { View } from "react-native";

// Iconos de la maqueta hechos con vistas (sin fuentes, imágenes ni dependencias), sobre su misma cuadrícula de 24
// (32 en la marca). Líneas: [x1, y1, x2, y2]; cajas con borde: [x, y, ancho, alto, radio].
type Line = readonly [number, number, number, number];
type Box = readonly [number, number, number, number, number];
interface Shape {
  readonly lines: readonly Line[];
  readonly boxes?: readonly Box[];
  /** Caja abierta por arriba con el fondo redondeado (el soporte del micrófono). */
  readonly cup?: Box;
}

const SHAPES = {
  check: { lines: [[5, 12, 9, 16], [9, 16, 19, 6]] },
  chevron: { lines: [[7, 10, 12, 15], [12, 15, 17, 10]] },
  close: { lines: [[7, 7, 17, 17], [17, 7, 7, 17]] },
  search: { lines: [[15, 15, 20, 20]], boxes: [[4, 4, 12, 12, 6]] },
  mic: { lines: [[12, 18, 12, 21], [8, 21, 16, 21]], boxes: [[9, 3, 6, 12, 3]], cup: [6, 10, 12, 8, 6] },
  phone: { lines: [[10, 6, 14, 6], [12, 18, 12, 19]], boxes: [[7, 3, 10, 18, 2]] },
  monitor: { lines: [[8, 21, 16, 21], [12, 16, 12, 21]], boxes: [[3, 4, 18, 12, 2]] },
} satisfies Record<string, Shape>;

export type IconName = keyof typeof SHAPES;

/** Trazo con extremos redondeados, como `stroke-linecap: round`. */
function segment(key: number, [x1, y1, x2, y2]: Line, scale: number, width: number, color: string) {
  const length = Math.hypot(x2 - x1, y2 - y1) * scale + width;
  return (
    <View
      key={key}
      style={{
        position: "absolute",
        left: ((x1 + x2) / 2) * scale - length / 2,
        top: ((y1 + y2) / 2) * scale - width / 2,
        width: length,
        height: width,
        borderRadius: width / 2,
        backgroundColor: color,
        transform: [{ rotate: `${String(Math.atan2(y2 - y1, x2 - x1))}rad` }],
      }}
    />
  );
}

function outline([x, y, w, h, r]: Box, scale: number, width: number, color: string) {
  return {
    position: "absolute",
    left: x * scale - width / 2,
    top: y * scale - width / 2,
    width: w * scale + width,
    height: h * scale + width,
    borderRadius: r * scale + width / 2,
    borderWidth: width,
    borderColor: color,
  } as const;
}

export function Icon({
  name,
  size,
  color,
  stroke = 1.7,
}: {
  readonly name: IconName;
  readonly size: number;
  readonly color: string;
  readonly stroke?: number;
}) {
  const shape: Shape = SHAPES[name];
  const scale = size / 24;
  const width = stroke * scale;
  return (
    <View aria-hidden style={{ width: size, height: size }}>
      {shape.boxes?.map((box, i) => <View key={`b${String(i)}`} style={outline(box, scale, width, color)} />)}
      {shape.cup && (
        <View
          style={[
            outline(shape.cup, scale, width, color),
            { borderTopWidth: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 },
          ]}
        />
      )}
      {shape.lines.map((line, i) => segment(i, line, scale, width, color))}
    </View>
  );
}

/** Icono del botón principal: micrófono, cuadrado para parar o tres puntos de espera; la forma cambia, no solo el color. */
export function MicGlyph({
  shape,
  size,
  color,
}: {
  readonly shape: "mic" | "stop" | "wait";
  readonly size: number;
  readonly color: string;
}) {
  if (shape === "mic") return <Icon name="mic" size={size} color={color} stroke={1.6} />;
  if (shape === "stop") {
    const side = Math.round(size * 0.6);
    return <View aria-hidden style={{ width: side, height: side, borderRadius: 3, backgroundColor: color }} />;
  }
  return (
    <View aria-hidden style={{ flexDirection: "row", gap: 4 }}>
      {[0, 1, 2].map((dot) => (
        <View key={dot} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      ))}
    </View>
  );
}

/** Marca «dialon»: cinco barras de onda de voz en una cuadrícula de 32. */
export function BrandBars({ size, color }: { readonly size: number; readonly color: string }) {
  const scale = size / 32;
  const bars: readonly Line[] = [
    [4, 13, 4, 19],
    [10, 8, 10, 24],
    [16, 4, 16, 28],
    [22, 9, 22, 23],
    [28, 13, 28, 19],
  ];
  return (
    <View aria-hidden style={{ width: size, height: size }}>
      {bars.map((bar, i) => segment(i, bar, scale, 2.3 * scale, color))}
    </View>
  );
}
