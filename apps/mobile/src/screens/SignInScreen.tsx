import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type PressableStateCallbackType } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AUTH, CHROME } from "../copy";
import { BrandBars } from "../icons";
import { COLORS, panelOf } from "../theme";

export interface SignInScreenProps {
  /** Estado en curso («Comprobando sesión…», «Abriendo Google…»…), anunciado con educación. */
  readonly status?: string;
  /** Aviso seguro (error o fallo al leer la sesión). */
  readonly alert?: string;
  readonly googleDisabled: boolean;
  readonly demoDisabled: boolean;
  readonly onGoogle: () => void;
  readonly onDemo: () => void;
  /** Solo si la sesión no se pudo leer. */
  readonly onRetry?: () => void;
}

/** Desde este ancho, dos zonas (marca y ejemplo a la izquierda, acceso a la derecha); por debajo, una columna. */
const WIDE_MIN_WIDTH = 960;

// Textos solo de esta pantalla. El ejemplo es una ilustración fija (las frases de ejemplo de la demo), no una
// conversación ni un resultado real.
const PITCH = "Dos personas, un teléfono. Un espacio para cada idioma.";
const EXAMPLE = {
  label: "Ejemplo",
  name: "Ejemplo de conversación",
  a: { who: "Persona A · Español", text: "Hola, ¿cómo estás?" },
  b: { who: "Person B · English", text: "Hello, how are you?" },
} as const;

// Colores de los paneles A y B y del aviso, ya medidos (DESIGN.md).
const PANEL_A = panelOf("A", false);
const PANEL_B = panelOf("B", false);

function Action({
  label,
  primary,
  disabled,
  onPress,
}: {
  readonly label: string;
  readonly primary: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      role="button"
      aria-label={label}
      disabled={disabled}
      onPress={onPress}
      style={(state: PressableStateCallbackType & { hovered?: boolean }) => [
        styles.action,
        primary ? styles.primary : styles.secondary,
        state.hovered === true && !disabled && (primary ? styles.primaryHover : styles.secondaryHover),
        disabled && styles.dimmed,
        state.pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.actionText, { color: primary ? COLORS.blanco : COLORS.tinta }]}>{label}</Text>
    </Pressable>
  );
}

function Brand({ onNavy }: { readonly onNavy: boolean }) {
  const color = onNavy ? COLORS.blanco : COLORS.tinta;
  return (
    <View style={styles.brand}>
      <BrandBars size={30} color={color} />
      <Text style={[styles.brandText, { color }]}>{CHROME.brand}</Text>
    </View>
  );
}

/**
 * Ejemplo estático con los mismos paneles que la conversación: A blanca y B marino (sobre fondo marino, B usa su tono
 * traslúcido). Sin botones, micrófono ni animación: solo ilustra.
 */
function Example({ onNavy }: { readonly onNavy: boolean }) {
  return (
    <View role="group" aria-label={EXAMPLE.name} style={styles.example}>
      <View style={[styles.exampleTag, onNavy ? styles.exampleTagOnNavy : styles.exampleTagOnLight]}>
        <Text style={[styles.exampleTagText, { color: onNavy ? COLORS.blanco : COLORS.marino }]}>{EXAMPLE.label}</Text>
      </View>
      <View style={[styles.bubble, { backgroundColor: PANEL_A.fondo, borderColor: PANEL_A.borde }]}>
        <Text style={[styles.who, { color: PANEL_A.ceja }]}>{EXAMPLE.a.who}</Text>
        <Text style={[styles.phrase, { color: PANEL_A.texto }]}>{EXAMPLE.a.text}</Text>
      </View>
      <View
        style={[
          styles.bubble,
          onNavy
            ? { backgroundColor: PANEL_B.selectorFondo, borderColor: PANEL_B.selectorBorde }
            : { backgroundColor: PANEL_B.fondo, borderColor: PANEL_B.borde },
        ]}
      >
        <Text style={[styles.who, { color: PANEL_B.ceja }]}>{EXAMPLE.b.who}</Text>
        <Text style={[styles.phrase, { color: PANEL_B.texto }]}>{EXAMPLE.b.text}</Text>
      </View>
    </View>
  );
}

/**
 * Pantalla inicial en web: «Continuar con Google» o «Probar demo local» (sin cuenta). En escritorio, dos zonas: marca,
 * propuesta y ejemplo sobre marino a la izquierda y el acceso sobre blanco a la derecha. En el teléfono, una columna
 * con el acceso pronto y el ejemplo al final. Todo se desplaza si no cabe (letra grande, horizontal).
 */
export function SignInScreen({ status, alert, googleDisabled, demoDisabled, onGoogle, onDemo, onRetry }: SignInScreenProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_MIN_WIDTH;

  const access = (
    <View style={[styles.access, wide && styles.accessWide]}>
      <Text style={styles.intro}>{AUTH.intro}</Text>
      <View style={styles.actions}>
        <Action label={AUTH.google} primary disabled={googleDisabled} onPress={onGoogle} />
        <Action label={AUTH.demo} primary={false} disabled={demoDisabled} onPress={onDemo} />
        {onRetry && <Action label={AUTH.retry} primary={false} disabled={false} onPress={onRetry} />}
      </View>
      {status !== undefined && (
        <Text aria-live="polite" style={styles.status}>
          {status}
        </Text>
      )}
      {alert !== undefined && (
        <View style={[styles.notice, { backgroundColor: PANEL_A.avisoFondo }]}>
          <Text aria-hidden style={[styles.noticeText, styles.strong, { color: PANEL_A.avisoTexto }]}>
            !
          </Text>
          <Text role="alert" style={[styles.noticeText, styles.shrink, { color: PANEL_A.avisoTexto }]}>
            {alert}
          </Text>
        </View>
      )}
      <Text style={styles.note}>{AUTH.note}</Text>
    </View>
  );

  if (wide) {
    return (
      <View testID="inicio-sesion" style={styles.screen}>
        <ScrollView contentContainerStyle={styles.wideContent}>
          <View
            style={[
              styles.story,
              { paddingTop: 40 + insets.top, paddingBottom: 40 + insets.bottom, paddingLeft: 56 + insets.left },
            ]}
          >
            <View style={styles.storyInner}>
              <Brand onNavy />
              <View style={styles.storyBody}>
                <Text role="heading" style={[styles.title, styles.titleWide]}>
                  {AUTH.title}
                </Text>
                <Text style={styles.pitch}>{PITCH}</Text>
                <Example onNavy />
              </View>
            </View>
          </View>
          <View
            style={[
              styles.accessZone,
              { paddingTop: 40 + insets.top, paddingBottom: 40 + insets.bottom, paddingRight: 56 + insets.right },
            ]}
          >
            {access}
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View testID="inicio-sesion" style={styles.screen}>
      <ScrollView contentContainerStyle={styles.narrowContent}>
        <View
          style={[
            styles.hero,
            { paddingTop: 24 + insets.top, paddingLeft: 20 + insets.left, paddingRight: 20 + insets.right },
          ]}
        >
          <View style={[styles.narrowInner, styles.heroInner]}>
            <Brand onNavy />
            <Text role="heading" style={styles.title}>
              {AUTH.title}
            </Text>
          </View>
        </View>
        <View style={[styles.column, { paddingLeft: 20 + insets.left, paddingRight: 20 + insets.right }]}>
          <View style={styles.narrowInner}>{access}</View>
        </View>
        {/* Última sección: se estira hasta el final con su fondo (sin min-height ni scroll de más). */}
        <View
          style={[
            styles.column,
            styles.about,
            { paddingBottom: 28 + insets.bottom, paddingLeft: 20 + insets.left, paddingRight: 20 + insets.right },
          ]}
        >
          <View style={[styles.narrowInner, styles.aboutInner]}>
            <Text style={styles.pitchLight}>{PITCH}</Text>
            <Example onNavy={false} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.blanco },

  // Escritorio: dos zonas a toda la altura (~55/45); el contenido se desplaza si no cabe.
  wideContent: { flexGrow: 1, flexDirection: "row" },
  story: { flex: 55, backgroundColor: COLORS.marino, paddingRight: 56 },
  storyInner: { flex: 1, width: "100%", maxWidth: 560, alignSelf: "center", gap: 32 },
  storyBody: { flex: 1, justifyContent: "center", gap: 20 },
  accessZone: { flex: 45, backgroundColor: COLORS.blanco, justifyContent: "center", alignItems: "center", paddingLeft: 56 },

  // Teléfono: banda marina compacta, acceso pronto y el ejemplo al final.
  narrowContent: { flexGrow: 1 },
  narrowInner: { width: "100%", maxWidth: 560, alignSelf: "center" },
  hero: { backgroundColor: COLORS.marino, paddingBottom: 24 },
  heroInner: { gap: 18 },
  column: { paddingTop: 24 },
  about: { flexGrow: 1, backgroundColor: COLORS.fondo, marginTop: 28, paddingTop: 24 },
  aboutInner: { gap: 16 },

  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandText: { fontSize: 26, lineHeight: 32, fontWeight: "700", letterSpacing: -1 },
  title: { fontSize: 30, lineHeight: 36, fontWeight: "700", letterSpacing: -0.8, color: COLORS.blanco },
  titleWide: { fontSize: 48, lineHeight: 54, letterSpacing: -1.6 },
  pitch: { fontSize: 18, lineHeight: 27, color: PANEL_B.nota, maxWidth: 480 },
  pitchLight: { fontSize: 15, lineHeight: 22, color: COLORS.apagado },

  access: { width: "100%", gap: 14 },
  accessWide: { maxWidth: 400 },
  intro: { fontSize: 20, lineHeight: 28, fontWeight: "600", letterSpacing: -0.3, color: COLORS.marino },
  actions: { gap: 12, marginTop: 4 },
  action: {
    minHeight: 52,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    outlineColor: COLORS.marino,
  },
  primary: { backgroundColor: COLORS.marino },
  primaryHover: { backgroundColor: COLORS.tinta },
  secondary: { borderWidth: 1, borderColor: COLORS.pildora, backgroundColor: COLORS.blanco },
  secondaryHover: { backgroundColor: COLORS.fondo },
  actionText: { fontSize: 16, lineHeight: 20, fontWeight: "600", textAlign: "center" },
  dimmed: { opacity: 0.55 },
  pressed: { opacity: 0.85 },
  status: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: COLORS.tinta },
  notice: { flexDirection: "row", gap: 8, borderRadius: 12, padding: 12 },
  noticeText: { fontSize: 14, lineHeight: 20 },
  strong: { fontWeight: "700" },
  shrink: { flexShrink: 1 },
  note: { fontSize: 13, lineHeight: 19, color: COLORS.apagado },

  example: { gap: 10, maxWidth: 440 },
  exampleTag: { alignSelf: "flex-start", borderWidth: 1, borderRadius: 12, paddingVertical: 4, paddingHorizontal: 10 },
  exampleTagOnNavy: { borderColor: PANEL_B.selectorBorde },
  exampleTagOnLight: { borderColor: COLORS.pildora, backgroundColor: COLORS.blanco },
  exampleTagText: { fontSize: 12, lineHeight: 16, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  bubble: { borderWidth: 1, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, gap: 6 },
  who: { fontSize: 11, lineHeight: 14, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  phrase: { fontSize: 20, lineHeight: 26, fontWeight: "500" },
});
