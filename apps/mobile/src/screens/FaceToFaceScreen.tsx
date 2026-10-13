import type { ErrorCode } from "@dialon/contracts";
import type { ConversationState, Participant } from "@dialon/core";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COPY, UI_LANGUAGES, type ButtonKey, type StatusKey, type UiLanguage } from "../copy";
import { useTheme, type Theme } from "../theme";
import { useDemoConversation } from "../useDemoConversation";

export interface FaceToFaceScreenProps {
  /** Genera un UUID v4 por turno (en la app, `randomUUID` de expo-crypto). */
  readonly createRequestId: () => string;
}

// El icono acompaña al texto de estado: el color nunca es la única señal.
const STATUS_ICON: Readonly<Record<StatusKey, string>> = {
  ready: "✓",
  preparing: "…",
  listening: "●",
  otherSpeaking: "●",
  translating: "…",
  speaking: "▶",
  stopping: "■",
};

interface HalfView {
  readonly status: StatusKey;
  readonly button: ButtonKey;
  readonly buttonDisabled: boolean;
  readonly listening: boolean;
  readonly showCancel: boolean;
  readonly received?: string;
  readonly said?: string;
  readonly notice?: ErrorCode;
}

/** Qué ve cada mitad según el estado de la conversación (tabla «Botón principal por estado» de DESIGN.md). */
function describeHalf(state: ConversationState, participant: Participant): HalfView {
  const { last } = state;
  const reading = {
    received: last && last.participant !== participant ? last.result.translation : undefined,
    said: last && last.participant === participant ? last.result.transcript : undefined,
  };
  const quiet = { listening: false, showCancel: false };
  switch (state.status) {
    case "IDLE": {
      const notice = state.error?.participant === participant ? state.error.code : undefined;
      return { ...reading, ...quiet, status: "ready", button: "start", buttonDisabled: false, notice };
    }
    case "PREPARING": {
      const own = state.turn.participant === participant;
      return {
        ...reading,
        ...quiet,
        status: own ? "preparing" : "otherSpeaking",
        button: own ? "preparing" : "wait",
        buttonDisabled: true,
      };
    }
    case "RECORDING_A":
    case "RECORDING_B": {
      const own = state.turn.participant === participant;
      return {
        ...reading,
        status: own ? "listening" : "otherSpeaking",
        button: own ? "finish" : "wait",
        buttonDisabled: !own,
        listening: own,
        showCancel: own,
      };
    }
    case "PROCESSING": {
      const own = state.turn.participant === participant;
      return {
        ...reading,
        status: "translating",
        button: own ? "translating" : "wait",
        buttonDisabled: true,
        listening: false,
        showCancel: own,
      };
    }
    case "SPEAKING":
      return {
        ...reading,
        ...quiet,
        status: state.stopping ? "stopping" : "speaking",
        button: state.stopping ? "stopping" : "stopVoice",
        buttonDisabled: state.stopping,
      };
  }
}

interface HalfProps {
  readonly participant: Participant;
  readonly language: UiLanguage;
  readonly view: HalfView;
  readonly languagesLocked: boolean;
  readonly theme: Theme;
  readonly onPress: () => void;
  readonly onCancel: () => void;
  readonly onSelectLanguage: (language: UiLanguage) => void;
}

function ConversationHalf({
  participant,
  language,
  view,
  languagesLocked,
  theme,
  onPress,
  onCancel,
  onSelectLanguage,
}: HalfProps) {
  const copy = COPY[language];
  const named = (label: string) => `${label}, ${copy.languageName}`;
  const notice = view.notice && (copy.notices[view.notice] ?? copy.noticeFallback);
  const buttonColors = view.buttonDisabled
    ? { background: theme.superficie, border: theme.contorno, text: theme.texto2 }
    : view.listening
      ? { background: theme.grabando, border: theme.grabando, text: theme.sobreGrabando }
      : { background: theme.acento, border: theme.acento, text: theme.sobreAcento };

  return (
    <View
      testID={`mitad-${participant}`}
      style={[
        styles.half,
        { backgroundColor: theme.superficie },
        participant === "A" ? { borderTopColor: theme.contorno, borderTopWidth: StyleSheet.hairlineWidth } : styles.rotated,
      ]}
    >
      {/* Cuerpo desplazable propio: con letra ampliada todo lo informativo se lee entero haciendo scroll. */}
      <ScrollView
        testID={`cuerpo-${participant}`}
        style={styles.body}
        contentContainerStyle={[styles.column, styles.bodyContent]}
      >
        {/* Tarjeta de lectura: la traducción recibida es lo más grande de la mitad y ocupa el hueco libre. */}
        <View style={[styles.reading, { backgroundColor: theme.fondo, borderColor: theme.separador }]}>
          {view.received !== undefined && (
            <Text aria-live="polite" style={[styles.received, { color: theme.texto }]}>
              {view.received}
            </Text>
          )}
          {view.said !== undefined && (
            <Text style={[styles.said, { color: theme.texto2 }]}>{`${copy.youSaid} ${view.said}`}</Text>
          )}
          {view.received === undefined && view.said === undefined && (
            <Text style={[styles.said, { color: theme.texto2 }]}>{copy.empty}</Text>
          )}
        </View>

        {notice !== undefined && (
          <View style={[styles.notice, { backgroundColor: theme.avisoFondo }]}>
            <Text aria-hidden style={[styles.noticeText, { color: theme.avisoTexto }]}>
              !
            </Text>
            <Text role="alert" style={[styles.noticeText, styles.grow, { color: theme.avisoTexto }]}>
              {notice}
            </Text>
          </View>
        )}

        {/* Nota DEMO subordinada: sus dos líneas siempre enteras, con barra lateral de aviso. */}
        <View style={[styles.demo, { borderLeftColor: theme.avisoBorde }]}>
          <Text style={[styles.demoText, styles.demoTitle, { color: theme.avisoTexto }]}>{copy.demoBanner}</Text>
          <Text style={[styles.demoText, { color: theme.texto2 }]}>{copy.noAudio}</Text>
        </View>

        {/* Idioma y estado junto a las acciones. El idioma elegido es tonal con ✓: nunca el azul del botón. */}
        <View style={styles.controls}>
          <View
            role="radiogroup"
            aria-label={copy.languageGroup}
            style={[styles.segments, { backgroundColor: theme.fondo, borderColor: theme.contorno }]}
          >
            {UI_LANGUAGES.map((option, index) => {
              const selected = option === language;
              const name = COPY[option].languageName;
              const color = selected ? theme.sobreSeleccion : languagesLocked ? theme.texto2 : theme.texto;
              return (
                <Pressable
                  key={option}
                  role="radio"
                  aria-label={name}
                  aria-checked={selected}
                  disabled={languagesLocked}
                  onPress={() => {
                    onSelectLanguage(option);
                  }}
                  style={[
                    styles.segment,
                    { outlineColor: theme.acento },
                    index === 0 ? styles.segmentFirst : [styles.segmentNext, { borderLeftColor: theme.contorno }],
                    index === UI_LANGUAGES.length - 1 && styles.segmentLast,
                    selected && { backgroundColor: theme.seleccion },
                  ]}
                >
                  {selected && (
                    <Text aria-hidden style={[styles.segmentText, styles.segmentSelected, { color }]}>
                      ✓
                    </Text>
                  )}
                  <Text style={[styles.segmentText, selected && styles.segmentSelected, { color }]}>{name}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.statusRow}>
            <Text
              aria-hidden
              style={[styles.status, { color: view.status === "listening" ? theme.grabando : theme.texto2 }]}
            >
              {STATUS_ICON[view.status]}
            </Text>
            <Text style={[styles.status, styles.shrink, { color: theme.texto2 }]}>{copy.status[view.status]}</Text>
          </View>
        </View>
      </ScrollView>

      {/* Acciones ancladas fuera del cuerpo: siempre visibles y tocables, aunque el cuerpo esté desplazado. */}
      <View style={[styles.column, styles.actions]}>
        <Pressable
          role="button"
          aria-label={named(copy.button[view.button])}
          disabled={view.buttonDisabled}
          onPress={onPress}
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: buttonColors.background, borderColor: buttonColors.border, outlineColor: theme.acento },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.primaryText, { color: buttonColors.text }]}>{copy.button[view.button]}</Text>
        </Pressable>

        {view.showCancel && (
          <Pressable
            role="button"
            aria-label={named(copy.cancel)}
            onPress={onCancel}
            style={({ pressed }) => [
              styles.secondary,
              { backgroundColor: theme.fondo, borderColor: theme.contorno, outlineColor: theme.acento },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.secondaryText, { color: theme.texto }]}>{copy.cancel}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/**
 * Pantalla cara a cara en modo DEMO: dos mitades iguales, B arriba girada 180° y A abajo. A va primero en el
 * árbol accesible y `column-reverse` la dibuja abajo.
 */
export function FaceToFaceScreen({ createRequestId }: FaceToFaceScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { state, languages, press, cancel, selectLanguage } = useDemoConversation(createRequestId);
  const languagesLocked = state.status !== "IDLE";

  const half = (participant: Participant) => (
    <ConversationHalf
      participant={participant}
      language={languages[participant]}
      view={describeHalf(state, participant)}
      languagesLocked={languagesLocked}
      theme={theme}
      onPress={() => {
        press(participant);
      }}
      onCancel={cancel}
      onSelectLanguage={(language) => {
        selectLanguage(participant, language);
      }}
    />
  );

  return (
    <View
      testID="cara-a-cara"
      style={[
        styles.screen,
        {
          backgroundColor: theme.fondo,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      {half("A")}
      {half("B")}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, flexDirection: "column-reverse" },
  half: { flex: 1 },
  rotated: { transform: [{ rotate: "180deg" }] },
  // Cuerpo y acciones comparten columna: todo el ancho en el teléfono y 760 px centrados en escritorio. Solo
  // cambia el ancho; cada mitad sigue midiendo la mitad del alto.
  column: { width: "100%", maxWidth: 760, alignSelf: "center" },
  // El cuerpo ocupa lo que dejan las acciones y desplaza su contenido. Si sobra alto, la tarjeta de lectura lo
  // llena y deja la nota DEMO y el idioma junto a las acciones.
  body: { flex: 1 },
  bodyContent: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 8 },
  reading: { flexGrow: 1, gap: 8, borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12 },
  demo: { borderLeftWidth: 4, paddingLeft: 12, paddingVertical: 4 },
  demoText: { fontSize: 14, lineHeight: 20 },
  demoTitle: { fontWeight: "600" },
  controls: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  // Selector segmentado: si con letra grande no cabe en una fila, sus opciones bajan a otra sin recortarse.
  segments: { flexDirection: "row", flexWrap: "wrap", flexShrink: 1, borderRadius: 12, borderWidth: 1 },
  segment: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  segmentFirst: { borderTopLeftRadius: 11, borderBottomLeftRadius: 11 },
  segmentNext: { borderLeftWidth: 1 },
  segmentLast: { borderTopRightRadius: 11, borderBottomRightRadius: 11 },
  segmentText: { fontSize: 16, lineHeight: 24, fontWeight: "500" },
  segmentSelected: { fontWeight: "700" },
  // El estado ocupa el hueco junto al selector y parte su texto; si quedan menos de 120 px (letra grande),
  // baja a otra fila en vez de solaparse con el selector.
  statusRow: {
    flex: 1,
    minWidth: 120,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
  },
  shrink: { flexShrink: 1 },
  status: { fontSize: 16, lineHeight: 24, fontWeight: "500" },
  received: { fontSize: 28, lineHeight: 36 },
  said: { fontSize: 16, lineHeight: 24 },
  notice: { flexDirection: "row", gap: 8, borderRadius: 12, padding: 12 },
  noticeText: { fontSize: 16, lineHeight: 24 },
  grow: { flex: 1 },
  // «Cancelar» comparte fila mientras el botón principal tenga al menos 200 px; con letra ampliada baja a otra
  // fila a todo el ancho, sin reducir ni ocultar textos.
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  primary: {
    flexGrow: 3,
    flexBasis: 200,
    minHeight: 64,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { fontSize: 18, lineHeight: 24, fontWeight: "600", textAlign: "center" },
  secondary: {
    flexGrow: 1,
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { fontSize: 18, lineHeight: 24, fontWeight: "600" },
  pressed: { opacity: 0.85 },
});
