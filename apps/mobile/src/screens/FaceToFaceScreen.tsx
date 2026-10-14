import type { ErrorCode } from "@dialon/contracts";
import type { ConversationState, Participant } from "@dialon/core";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COPY, UI_LANGUAGES, type ButtonKey, type StatusKey, type UiLanguage } from "../copy";
import { useTheme, type Panel } from "../theme";
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

/**
 * Icono geométrico del micrófono hecho con vistas (sin fuentes ni imágenes): micrófono para hablar, cuadrado para
 * parar y tres puntos mientras no se puede tocar. La forma cambia con el estado, no solo el color.
 */
function MicIcon({ shape, color }: { readonly shape: "mic" | "stop" | "wait"; readonly color: string }) {
  if (shape === "stop") return <View style={[styles.stopIcon, { backgroundColor: color }]} />;
  if (shape === "wait") {
    return (
      <View style={styles.waitIcon}>
        {[0, 1, 2].map((dot) => (
          <View key={dot} style={[styles.waitDot, { backgroundColor: color }]} />
        ))}
      </View>
    );
  }
  return (
    <View style={styles.micIcon}>
      <View style={[styles.micHead, { backgroundColor: color }]} />
      <View style={[styles.micCradle, { borderColor: color }]} />
      <View style={[styles.micStem, { backgroundColor: color }]} />
    </View>
  );
}

interface HalfProps {
  readonly participant: Participant;
  readonly language: UiLanguage;
  readonly view: HalfView;
  readonly languagesLocked: boolean;
  readonly panel: Panel;
  readonly onPress: () => void;
  readonly onCancel: () => void;
  readonly onSelectLanguage: (language: UiLanguage) => void;
}

function ConversationHalf({
  participant,
  language,
  view,
  languagesLocked,
  panel,
  onPress,
  onCancel,
  onSelectLanguage,
}: HalfProps) {
  const copy = COPY[language];
  const named = (label: string) => `${label}, ${copy.languageName}`;
  const notice = view.notice && (copy.notices[view.notice] ?? copy.noticeFallback);
  const circle = view.buttonDisabled
    ? { background: "transparent", border: panel.borde, icon: panel.texto2 }
    : view.listening
      ? { background: panel.grabando, border: panel.grabando, icon: panel.sobreGrabando }
      : { background: panel.circulo, border: panel.circulo, icon: panel.sobreCirculo };
  const shape = view.buttonDisabled ? "wait" : view.listening || view.button === "stopVoice" ? "stop" : "mic";
  const focus = { outlineColor: panel.texto };

  return (
    <View
      testID={`mitad-${participant}`}
      style={[styles.half, { backgroundColor: panel.fondo }, participant === "B" && styles.rotated]}
    >
      {/* Cuerpo desplazable propio: con letra ampliada todo lo informativo se lee entero haciendo scroll. */}
      <ScrollView
        testID={`cuerpo-${participant}`}
        style={styles.body}
        contentContainerStyle={[styles.column, styles.bodyContent]}
      >
        {/* Lectura sin tarjeta: la traducción, o el título vacío, es el texto grande protagonista del panel. */}
        <View style={styles.reading}>
          {view.received !== undefined && (
            <Text aria-live="polite" style={[styles.headline, { color: panel.texto }]}>
              {view.received}
            </Text>
          )}
          {view.said !== undefined && (
            <Text style={[styles.body16, { color: panel.texto2 }]}>{`${copy.youSaid} ${view.said}`}</Text>
          )}
          {view.received === undefined && view.said === undefined && (
            <>
              <Text style={[styles.headline, { color: panel.texto }]}>{copy.emptyTitle}</Text>
              <Text style={[styles.small, { color: panel.texto2 }]}>{copy.empty}</Text>
            </>
          )}
        </View>

        {notice !== undefined && (
          <View style={[styles.notice, { backgroundColor: panel.avisoFondo }]}>
            <Text aria-hidden style={[styles.body16, { color: panel.avisoTexto }]}>
              !
            </Text>
            <Text role="alert" style={[styles.body16, styles.grow, { color: panel.avisoTexto }]}>
              {notice}
            </Text>
          </View>
        )}

        {/* Nota DEMO entera y discreta, siempre en el cuerpo. */}
        <View>
          <Text style={[styles.small, styles.strong, { color: panel.demo }]}>{copy.demoBanner}</Text>
          <Text style={[styles.small, { color: panel.texto2 }]}>{copy.noAudio}</Text>
        </View>

        {/* Idioma discreto al pie del panel, junto al micrófono; el elegido lleva ✓, negrita y subrayado. */}
        <View style={styles.controls}>
          <View role="radiogroup" aria-label={copy.languageGroup} style={styles.languages}>
            {UI_LANGUAGES.map((option) => {
              const selected = option === language;
              const name = COPY[option].languageName;
              const color = selected ? panel.texto : panel.texto2;
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
                  style={[styles.language, focus, selected && { borderBottomColor: panel.texto }]}
                >
                  {selected && (
                    <Text aria-hidden style={[styles.body16, styles.strong, { color }]}>
                      ✓
                    </Text>
                  )}
                  <Text style={[styles.body16, selected ? styles.strong : styles.medium, { color }]}>{name}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.statusRow}>
            <Text aria-hidden style={[styles.body16, styles.medium, { color: panel.texto2 }]}>
              {STATUS_ICON[view.status]}
            </Text>
            <Text style={[styles.body16, styles.medium, styles.shrink, { color: panel.texto2 }]}>
              {copy.status[view.status]}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Acciones ancladas fuera del cuerpo: «Cancelar» discreto y el micrófono circular con su etiqueta corta. */}
      <View style={[styles.column, styles.actions]}>
        {view.showCancel && (
          <Pressable
            role="button"
            aria-label={named(copy.cancel)}
            onPress={onCancel}
            style={({ pressed }) => [styles.cancel, focus, { borderColor: panel.borde }, pressed && styles.pressed]}
          >
            <Text style={[styles.label, { color: panel.texto }]}>{copy.cancel}</Text>
          </Pressable>
        )}
        <Pressable
          role="button"
          aria-label={named(copy.button[view.button])}
          disabled={view.buttonDisabled}
          onPress={onPress}
          style={({ pressed }) => [styles.mic, focus, pressed && styles.pressed]}
        >
          <Text style={[styles.label, styles.shrink, { color: view.buttonDisabled ? panel.texto2 : panel.texto }]}>
            {copy.buttonShort[view.button]}
          </Text>
          <View style={[styles.circle, { backgroundColor: circle.background, borderColor: circle.border }]}>
            <MicIcon shape={shape} color={circle.icon} />
          </View>
        </Pressable>
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
      panel={theme[participant]}
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
          backgroundColor: theme.pantalla,
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
  // El cuerpo ocupa lo que dejan las acciones y desplaza su contenido. Si sobra alto, la lectura lo llena y deja
  // la nota DEMO y el idioma al pie, junto al micrófono.
  body: { flex: 1 },
  bodyContent: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8, gap: 12 },
  reading: { flexGrow: 1, gap: 8 },
  headline: { fontSize: 32, lineHeight: 40 },
  body16: { fontSize: 16, lineHeight: 24 },
  small: { fontSize: 14, lineHeight: 20 },
  medium: { fontWeight: "500" },
  strong: { fontWeight: "700" },
  notice: { flexDirection: "row", gap: 8, borderRadius: 12, padding: 12 },
  grow: { flex: 1 },
  shrink: { flexShrink: 1 },
  controls: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  languages: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  // Opción de idioma discreta: solo texto, con un subrayado transparente que se colorea en la elegida.
  language: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
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
  // «Cancelar» al principio de la fila y el micrófono al final; con letra grande cada uno puede bajar de fila.
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  cancel: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  // Botón principal: etiqueta corta + círculo de 64; el nombre accesible completo va en aria-label.
  mic: {
    marginLeft: "auto",
    flexShrink: 1,
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 12,
    borderRadius: 32,
  },
  label: { fontSize: 18, lineHeight: 24, fontWeight: "600", textAlign: "right" },
  circle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  micIcon: { alignItems: "center" },
  micHead: { width: 12, height: 20, borderRadius: 6 },
  micCradle: {
    width: 20,
    height: 12,
    marginTop: -6,
    borderWidth: 2,
    borderTopWidth: 0,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
  },
  micStem: { width: 2, height: 5 },
  stopIcon: { width: 20, height: 20, borderRadius: 3 },
  waitIcon: { flexDirection: "row", gap: 4 },
  waitDot: { width: 6, height: 6, borderRadius: 3 },
  pressed: { opacity: 0.85 },
});
