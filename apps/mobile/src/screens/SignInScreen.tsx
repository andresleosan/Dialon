import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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

// Avisos con los colores de aviso del panel blanco (contraste ya medido).
const NOTICE = panelOf("A", false);

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
      style={({ pressed }) => [
        styles.action,
        primary ? styles.primary : styles.secondary,
        disabled && styles.dimmed,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.actionText, { color: primary ? COLORS.blanco : COLORS.tinta }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Pantalla inicial en web: «Continuar con Google» o «Probar demo local» (sin cuenta). Paleta fija marino/blanco y
 * cuerpo desplazable para letra grande.
 */
export function SignInScreen({ status, alert, googleDisabled, demoDisabled, onGoogle, onDemo, onRetry }: SignInScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View testID="inicio-sesion" style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom, paddingLeft: 20 + insets.left, paddingRight: 20 + insets.right },
        ]}
      >
        <View style={styles.card}>
          <View style={styles.brand}>
            <BrandBars size={30} color={COLORS.tinta} />
            <Text style={styles.brandText}>{CHROME.brand}</Text>
          </View>
          <Text role="heading" style={styles.title}>
            {AUTH.title}
          </Text>
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
            <View style={[styles.notice, { backgroundColor: NOTICE.avisoFondo }]}>
              <Text aria-hidden style={[styles.noticeText, styles.strong, { color: NOTICE.avisoTexto }]}>
                !
              </Text>
              <Text role="alert" style={[styles.noticeText, styles.shrink, { color: NOTICE.avisoTexto }]}>
                {alert}
              </Text>
            </View>
          )}
          <Text style={styles.note}>{AUTH.note}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.fondo },
  content: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  card: {
    width: "100%",
    maxWidth: 440,
    padding: 28,
    gap: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.linea,
    backgroundColor: COLORS.blanco,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandText: { fontSize: 26, lineHeight: 32, fontWeight: "700", letterSpacing: -1, color: COLORS.tinta },
  title: { fontSize: 28, lineHeight: 34, fontWeight: "700", letterSpacing: -0.8, color: COLORS.marino },
  intro: { fontSize: 15, lineHeight: 22, color: COLORS.apagado },
  actions: { gap: 12, marginTop: 6 },
  action: {
    minHeight: 52,
    paddingHorizontal: 20,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    outlineColor: COLORS.marino,
  },
  primary: { backgroundColor: COLORS.marino },
  secondary: { borderWidth: 1, borderColor: COLORS.pildora, backgroundColor: COLORS.blanco },
  actionText: { fontSize: 16, lineHeight: 20, fontWeight: "600", textAlign: "center" },
  dimmed: { opacity: 0.55 },
  pressed: { opacity: 0.85 },
  status: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: COLORS.tinta },
  notice: { flexDirection: "row", gap: 8, borderRadius: 12, padding: 12 },
  noticeText: { fontSize: 14, lineHeight: 20 },
  strong: { fontWeight: "700" },
  shrink: { flexShrink: 1 },
  note: { fontSize: 12, lineHeight: 18, color: COLORS.apagado },
});
