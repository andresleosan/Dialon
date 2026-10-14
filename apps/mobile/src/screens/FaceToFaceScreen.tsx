import type { ErrorCode } from "@dialon/contracts";
import type { ConversationState, Participant } from "@dialon/core";
import { useRef, useState } from "react";
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type TextStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { LocalAudio } from "../audio/capture";
import {
  CHROME,
  COPY,
  clipSummary,
  uiLanguageOf,
  withLocalAudio,
  type ButtonKey,
  type Language,
  type PairIssue,
  type StatusKey,
} from "../copy";
import { BrandBars, Icon, MicGlyph } from "../icons";
import { COLORS, PANELS } from "../theme";
import { useDemoConversation, type LocalClip, type Playback } from "../useDemoConversation";
import { LanguagePicker, type Rect } from "./LanguagePicker";

export interface FaceToFaceScreenProps {
  /** Genera un UUID v4 por turno (en la app, `randomUUID` de expo-crypto). */
  readonly createRequestId: () => string;
  /** Web: grabación y reproducción locales reales. Sin él (nativo), la conversación es la DEMO simulada. */
  readonly audio?: LocalAudio;
}

/** Lado corto máximo de una pantalla táctil que, sin otra pista del navegador, se trata como teléfono. */
const PHONE_MAX_SHORT_SIDE = 700;

/** `phone` / `landscape`: teléfono compartido cara a cara, en vertical u horizontal. `desktop`: paneles lado a lado. */
type Layout = "phone" | "landscape" | "desktop";

/** Pistas del navegador; ninguna existe en nativo. */
interface WebHints {
  readonly navigator?: { readonly userAgent?: string; readonly userAgentData?: { readonly mobile?: boolean } };
  readonly matchMedia?: (query: string) => { readonly matches: boolean };
}

/**
 * Teléfono compartido o escritorio, nunca solo por el ancho. Nativo: siempre teléfono. Web: teléfono si el navegador
 * se declara móvil o, sin pista, si es una pantalla táctil pequeña en cualquier orientación. Un navegador de
 * escritorio con ratón sigue en escritorio aunque se estreche la ventana.
 */
function isPhoneDevice(width: number, height: number): boolean {
  if (Platform.OS !== "web") return true;
  const web = globalThis as WebHints;
  const agent = web.navigator?.userAgent ?? "";
  if (web.navigator?.userAgentData?.mobile === true || /Android.+Mobile|iPhone|iPod/i.test(agent)) return true;
  return web.matchMedia?.("(pointer: coarse)").matches === true && Math.min(width, height) <= PHONE_MAX_SHORT_SIDE;
}

// El icono acompaña al texto de estado: el color nunca es la única señal.
const STATUS_ICON: Readonly<Record<Exclude<StatusKey, "ready">, string>> = {
  preparing: "…",
  listening: "●",
  otherSpeaking: "●",
  translating: "…",
  speaking: "▶",
  stopping: "■",
};

interface TextSize {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly letterSpacing?: number;
}

/** Medidas de la maqueta aprobada por disposición. */
interface Sizes {
  readonly padTop: number;
  readonly padX: number;
  readonly padBottom: number;
  readonly radius: number;
  readonly badge: number;
  readonly badgeFont: number;
  readonly person: number;
  readonly personSpacing: number;
  readonly personGap: number;
  readonly state: number;
  readonly readingTop: number;
  readonly readingBottom: number;
  readonly eyebrow: number;
  readonly eyebrowSpacing: number;
  readonly eyebrowGap: number;
  readonly phrase: TextSize;
  readonly empty: TextSize;
  readonly note: TextSize;
  readonly guide: TextSize;
  readonly noteGap: number;
  readonly bottomTop: number;
  readonly selectorWidth: number;
  readonly selectorHeight: number;
  readonly selectorPadX: number;
  readonly caption: number;
  readonly value: number;
  readonly mic: number;
  readonly micIcon: number;
  readonly label: number;
  readonly labelGap: number;
}

const COMPACT = {
  badge: 23,
  badgeFont: 10,
  person: 10,
  personSpacing: 1,
  personGap: 8,
  state: 11,
  readingBottom: 12,
  eyebrow: 9,
  eyebrowSpacing: 1.1,
  eyebrowGap: 12,
  note: { fontSize: 11, lineHeight: 16 },
  guide: { fontSize: 12, lineHeight: 18 },
  noteGap: 12,
  selectorPadX: 13,
  caption: 9,
  value: 15,
  label: 11,
  labelGap: 7,
} as const;

const SIZES: Readonly<Record<Layout, Sizes>> = {
  desktop: {
    padTop: 32,
    padX: 32,
    padBottom: 32,
    radius: 22,
    badge: 27,
    badgeFont: 11,
    person: 12,
    personSpacing: 1.7,
    personGap: 10,
    state: 12,
    readingTop: 40,
    readingBottom: 18,
    eyebrow: 11,
    eyebrowSpacing: 1.5,
    eyebrowGap: 18,
    phrase: { fontSize: 42, lineHeight: 50, letterSpacing: -1.15 },
    empty: { fontSize: 34, lineHeight: 41, letterSpacing: -1.15 },
    note: { fontSize: 12, lineHeight: 18 },
    guide: { fontSize: 14, lineHeight: 22 },
    noteGap: 20,
    bottomTop: 22,
    selectorWidth: 170,
    selectorHeight: 60,
    selectorPadX: 16,
    caption: 10,
    value: 16,
    mic: 64,
    micIcon: 29,
    label: 12,
    labelGap: 8,
  },
  phone: {
    ...COMPACT,
    padTop: 22,
    padX: 20,
    padBottom: 18,
    radius: 17,
    readingTop: 25,
    phrase: { fontSize: 30, lineHeight: 35, letterSpacing: -0.65 },
    empty: { fontSize: 29, lineHeight: 35, letterSpacing: -0.65 },
    bottomTop: 17,
    selectorWidth: 216,
    selectorHeight: 58,
    mic: 60,
    micIcon: 27,
  },
  // Teléfono en horizontal: cada mitad es baja, así que todo es más compacto y los controles se desplazan con el cuerpo.
  landscape: {
    ...COMPACT,
    padTop: 10,
    padX: 20,
    padBottom: 8,
    radius: 14,
    readingTop: 8,
    readingBottom: 8,
    eyebrowGap: 6,
    noteGap: 6,
    phrase: { fontSize: 22, lineHeight: 27, letterSpacing: -0.4 },
    empty: { fontSize: 20, lineHeight: 25, letterSpacing: -0.4 },
    bottomTop: 8,
    selectorWidth: 216,
    selectorHeight: 48,
    mic: 48,
    micIcon: 22,
    labelGap: 4,
  },
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
function describeHalf(state: ConversationState, participant: Participant, pairIssue?: PairIssue): HalfView {
  const { last } = state;
  const reading = {
    received: last && last.participant !== participant ? last.result.translation : undefined,
    said: last && last.participant === participant ? last.result.transcript : undefined,
  };
  const quiet = { listening: false, showCancel: false };
  switch (state.status) {
    case "IDLE": {
      const notice = state.error?.participant === participant ? state.error.code : undefined;
      const blocked = pairIssue !== undefined;
      return {
        ...reading,
        ...quiet,
        status: "ready",
        button: blocked ? "blocked" : "start",
        buttonDisabled: blocked,
        notice,
      };
    }
    case "PREPARING": {
      const own = state.turn.participant === participant;
      // «Cancelar» ya en PREPARING: el permiso del micrófono puede quedarse esperando.
      return {
        ...reading,
        listening: false,
        showCancel: own,
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
  readonly language: Language;
  readonly view: HalfView;
  readonly pairIssue?: PairIssue;
  readonly locked: boolean;
  readonly layout: Layout;
  /** Con audio local los textos dicen que se graba de verdad y que la traducción está pendiente. */
  readonly local: boolean;
  /** Clip local de esta persona, si lo hay. */
  readonly clip?: LocalClip;
  readonly playback: Playback;
  readonly selectorRef: (node: View | null) => void;
  readonly onPress: () => void;
  readonly onCancel: () => void;
  readonly onOpenPicker: () => void;
  readonly onPlay: () => void;
  readonly onStopPlayback: () => void;
}

function ConversationHalf({
  participant,
  language,
  view,
  pairIssue,
  locked,
  layout,
  local,
  clip,
  playback,
  selectorRef,
  onPress,
  onCancel,
  onOpenPicker,
  onPlay,
  onStopPlayback,
}: HalfProps) {
  const panel = PANELS[participant];
  const size = SIZES[layout];
  const desktop = layout === "desktop";
  const landscape = layout === "landscape";
  // «Cancelar» va junto al micrófono si hay ancho de sobra; en el teléfono vertical, en su propia fila encima.
  const inlineCancel = desktop || landscape;
  const baseCopy = COPY[uiLanguageOf(participant, language)];
  const copy = local ? withLocalAudio(baseCopy) : baseCopy;
  const playing = playback === "playing";
  const languageName = copy.languageNames[language];
  const named = (label: string) => `${label}, ${languageName}`;
  const notice = view.notice && (copy.notices[view.notice] ?? copy.noticeFallback);
  const reading = view.received ?? view.said;
  const focus = { outlineColor: panel.texto };
  const blocked = view.button === "blocked";
  const circle = view.buttonDisabled
    ? { background: "transparent", border: panel.apagado, icon: blocked ? panel.apagado : panel.nota }
    : view.listening
      ? { background: panel.grabando, border: panel.grabando, icon: panel.sobreGrabando }
      : { background: panel.circulo, border: panel.circulo, icon: panel.sobreCirculo };
  const shape = view.buttonDisabled && !blocked ? "wait" : view.listening || view.button === "stopVoice" ? "stop" : "mic";
  const note = { color: panel.nota, ...size.note };
  const guide = { color: panel.nota, ...size.guide };

  const topRow = (
    <View style={styles.topRow}>
      <View style={[styles.row, { gap: size.personGap }]}>
        <View
          style={[
            styles.badge,
            { width: size.badge, height: size.badge, borderRadius: size.badge / 2, borderColor: panel.texto },
          ]}
        >
          <Text style={[styles.strong, { color: panel.texto, fontSize: size.badgeFont, lineHeight: size.badgeFont + 3 }]}>
            {participant}
          </Text>
        </View>
        <Text
          style={[
            styles.strong,
            styles.upper,
            { color: panel.texto, fontSize: size.person, lineHeight: size.person + 4, letterSpacing: size.personSpacing },
          ]}
        >
          {`${copy.person} ${participant}`}
        </Text>
      </View>
      <View style={[styles.row, styles.status]}>
        {view.status === "ready" ? (
          <Icon name="check" size={14} color={panel.texto} stroke={2} />
        ) : (
          <Text aria-hidden style={{ color: panel.texto, fontSize: size.state, lineHeight: size.state + 4 }}>
            {STATUS_ICON[view.status]}
          </Text>
        )}
        <Text style={[styles.shrink, { color: panel.texto, fontSize: size.state, lineHeight: size.state + 4 }]}>
          {copy.status[view.status]}
        </Text>
      </View>
    </View>
  );

  const cancelButton = view.showCancel && (
    <Pressable
      role="button"
      aria-label={named(copy.cancel)}
      onPress={onCancel}
      style={({ pressed }) => [
        styles.cancel,
        !inlineCancel && styles.cancelRow,
        focus,
        { borderColor: panel.apagado },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.cancelText, { color: panel.texto }]}>{copy.cancel}</Text>
    </Pressable>
  );

  const controls = (
    <View style={[styles.bottom, { borderTopColor: panel.linea, paddingTop: size.bottomTop }]}>
      {!inlineCancel && cancelButton}
      <View style={styles.controls}>
        {desktop && (
          <Text style={[styles.listenNote, note, { lineHeight: 17 }]}>
            {locked ? copy.languageLocked : copy.listenNote}
          </Text>
        )}
        <View style={[styles.cluster, !desktop && styles.clusterFull]}>
          <Pressable
            ref={selectorRef}
            role="button"
            aria-label={`${copy.iSpeak}: ${languageName}`}
            disabled={locked}
            onPress={onOpenPicker}
            style={({ pressed }) => [
              styles.selector,
              focus,
              {
                width: size.selectorWidth,
                minHeight: size.selectorHeight,
                paddingHorizontal: size.selectorPadX,
                backgroundColor: panel.selectorFondo,
                borderColor: panel.selectorBorde,
              },
              locked && styles.dimmed,
              locked && !desktop && styles.selectorLocked,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.shrink}>
              <Text
                style={[
                  styles.upper,
                  styles.caption,
                  { color: panel.texto, fontSize: size.caption, lineHeight: size.caption + 3 },
                ]}
              >
                {copy.iSpeak}
              </Text>
              <Text style={[styles.value, { color: panel.texto, fontSize: size.value, lineHeight: size.value + 4 }]}>
                {languageName}
              </Text>
            </View>
            {!locked && <Icon name="chevron" size={20} color={panel.texto} />}
          </Pressable>
          {inlineCancel && cancelButton}
          <Pressable
            role="button"
            aria-label={named(copy.button[view.button])}
            disabled={view.buttonDisabled}
            onPress={onPress}
            style={({ pressed }) => [styles.speak, { gap: size.labelGap }, focus, pressed && styles.pressed]}
          >
            <View style={{ width: size.mic, height: size.mic }}>
              <View
                style={[
                  styles.ring,
                  { width: size.mic + 14, height: size.mic + 14, borderRadius: (size.mic + 14) / 2 },
                  { backgroundColor: panel.anillo },
                ]}
              />
              <View
                style={[
                  styles.circle,
                  { borderRadius: size.mic / 2, backgroundColor: circle.background, borderColor: circle.border },
                ]}
              >
                <MicGlyph shape={shape} size={size.micIcon} color={circle.icon} />
              </View>
            </View>
            <Text
              style={[
                styles.strong,
                styles.centered,
                { color: view.buttonDisabled ? panel.nota : panel.texto, fontSize: size.label, lineHeight: size.label + 4 },
              ]}
            >
              {copy.buttonShort[view.button]}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  return (
    <View
      testID={`mitad-${participant}`}
      style={[
        styles.half,
        {
          backgroundColor: panel.fondo,
          borderColor: panel.borde,
          borderRadius: size.radius,
          paddingTop: size.padTop,
          paddingHorizontal: size.padX,
          paddingBottom: size.padBottom,
        },
        participant === "B" && !desktop && styles.rotated,
      ]}
    >
      {desktop && topRow}

      {/* Cuerpo de lectura propio y desplazable: con letra grande todo se lee entero haciendo scroll. */}
      {/* En horizontal el contenido crece a su altura natural y se desplaza: lectura y controles no se encogen encima. */}
      <ScrollView
        testID={`cuerpo-${participant}`}
        style={styles.body}
        contentContainerStyle={landscape ? styles.scrollContent : styles.grow}
      >
        {!desktop && topRow}
        <View
          style={[landscape ? styles.natural : styles.grow, { paddingTop: size.readingTop, paddingBottom: size.readingBottom }]}
        >
          <Text
            style={[
              styles.strong,
              styles.upper,
              {
                color: panel.ceja,
                fontSize: size.eyebrow,
                lineHeight: size.eyebrow + 3,
                letterSpacing: size.eyebrowSpacing,
                marginBottom: size.eyebrowGap,
              },
            ]}
          >
            {clip !== undefined
              ? copy.local.clipEyebrow
              : view.received !== undefined
                ? copy.receivedEyebrow
                : view.said !== undefined
                  ? copy.saidEyebrow
                  : copy.emptyEyebrow}
          </Text>
          {clip !== undefined ? (
            <>
              <Text style={[styles.phrase, { color: panel.texto }, size.empty]}>
                {clipSummary(copy, clip.info.durationMs, clip.info.byteLength)}
              </Text>
              <Text style={[note, { marginTop: size.noteGap }]}>{copy.local.clipNote}</Text>
              {/* Reproducción solo a mano y solo de este clip local. */}
              <Pressable
                role="button"
                aria-label={named(playing ? copy.local.stopPlayback : copy.local.replay)}
                onPress={playing ? onStopPlayback : onPlay}
                style={({ pressed }) => [
                  styles.cancel,
                  styles.clipButton,
                  focus,
                  { borderColor: panel.apagado },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.cancelText, { color: panel.texto }]}>
                  {playing ? copy.local.stopPlayback : copy.local.replay}
                </Text>
              </Pressable>
              {playback === "failed" && (
                <Text role="alert" style={[note, styles.clipFailed]}>
                  {copy.local.playFailed}
                </Text>
              )}
            </>
          ) : reading !== undefined ? (
            <>
              <Text
                aria-live={view.received !== undefined ? "polite" : undefined}
                style={[styles.phrase, { color: panel.texto }, size.phrase]}
              >
                {reading}
              </Text>
              <Text style={[note, { marginTop: size.noteGap }]}>{copy.sampleNote}</Text>
            </>
          ) : (
            <>
              <Text style={[styles.phrase, styles.emptyTitle, { color: panel.texto }, size.empty]}>{copy.emptyTitle}</Text>
              <View style={{ marginTop: size.noteGap }}>
                <Text style={guide}>{copy.guide}</Text>
                <Text style={guide}>{copy.demoNote}</Text>
              </View>
            </>
          )}
          {pairIssue !== undefined && (
            <Text style={[styles.issue, size.guide, { color: panel.texto }]}>{copy.pair[pairIssue]}</Text>
          )}
          {notice !== undefined && (
            <View style={[styles.notice, { backgroundColor: panel.avisoFondo }]}>
              <Text aria-hidden style={[styles.noticeText, styles.strong, { color: panel.avisoTexto }]}>
                !
              </Text>
              <Text role="alert" style={[styles.noticeText, styles.shrink, { color: panel.avisoTexto }]}>
                {notice}
              </Text>
            </View>
          )}
          {locked && !desktop && <Text style={[note, styles.lockedNote]}>{copy.languageLocked}</Text>}
        </View>
        {landscape && controls}
      </ScrollView>

      {/* Controles anclados fuera del cuerpo, salvo en horizontal, donde se desplazan con él para no quedar cortados. */}
      {!landscape && controls}
    </View>
  );
}

function Brand({ size, fontSize, gap }: { readonly size: number; readonly fontSize: number; readonly gap: number }) {
  return (
    <View style={[styles.row, { gap }]}>
      <BrandBars size={size} color={COLORS.tinta} />
      <Text style={[styles.brand, { fontSize, lineHeight: fontSize + 6 }]}>{CHROME.brand}</Text>
    </View>
  );
}

interface PickerState {
  readonly participant: Participant;
  /** Disposición y ancho al abrir: si cambian, el selector se cierra en vez de quedar donde ya no está su botón. */
  readonly layout: Layout;
  readonly width: number;
  readonly anchor?: Rect;
}

/**
 * Pantalla de conversación DEMO. En el teléfono, dos mitades iguales: B arriba girada 180° y A abajo. En escritorio,
 * dos paneles derechos lado a lado (B a la izquierda) o, al elegir «Cara a cara», la vista del teléfono centrada.
 * A va siempre primero en el árbol accesible.
 */
export function FaceToFaceScreen({ createRequestId, audio }: FaceToFaceScreenProps) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { state, languages, pairIssue, press, cancel, selectLanguage, clip, playback, play, stopPlayback } =
    useDemoConversation(createRequestId, audio);
  const [picker, setPicker] = useState<PickerState>();
  const selectors = useRef<Partial<Record<Participant, View | null>>>({});
  const locked = state.status !== "IDLE";
  const layout: Layout = !isPhoneDevice(width, height) ? "desktop" : width > height ? "landscape" : "phone";

  // Si cambia la geometría o empieza un turno, el selector abierto se cierra (y no reaparece al volver).
  const pickerStale =
    picker !== undefined && (picker.layout !== layout || (layout === "desktop" && picker.width !== width) || locked);
  if (pickerStale) setPicker(undefined);
  const openPicker = pickerStale ? undefined : picker;

  const showPicker = (participant: Participant) => {
    setPicker({ participant, layout, width });
    selectors.current[participant]?.measureInWindow((x, y, w, h) => {
      setPicker((current) =>
        current?.participant === participant ? { ...current, anchor: { x, y, width: w, height: h } } : current,
      );
    });
  };

  const closePicker = () => {
    setPicker(undefined);
    // En web, el Modal de react-native-web ya devuelve el foco al selector; en Android/iOS se pide al lector.
    const opener = openPicker && selectors.current[openPicker.participant];
    if (opener && Platform.OS !== "web") AccessibilityInfo.sendAccessibilityEvent(opener, "focus");
  };

  const half = (participant: Participant) => (
    <ConversationHalf
      participant={participant}
      language={languages[participant]}
      view={describeHalf(state, participant, pairIssue)}
      pairIssue={pairIssue}
      locked={locked}
      layout={layout}
      local={audio !== undefined}
      clip={clip?.participant === participant ? clip : undefined}
      playback={playback}
      onPlay={play}
      onStopPlayback={stopPlayback}
      selectorRef={(node) => {
        selectors.current[participant] = node;
      }}
      onPress={() => {
        press(participant);
      }}
      onCancel={cancel}
      onOpenPicker={() => {
        showPicker(participant);
      }}
    />
  );

  const pickerLayer = openPicker && (
    <LanguagePicker
      participant={openPicker.participant}
      copy={COPY[uiLanguageOf(openPicker.participant, languages[openPicker.participant])]}
      current={languages[openPicker.participant]}
      variant={layout === "desktop" ? "popover" : "sheet"}
      rotated={openPicker.participant === "B" && layout !== "desktop"}
      anchor={openPicker.anchor}
      onSelect={(language) => {
        selectLanguage(openPicker.participant, language);
        closePicker();
      }}
      onClose={closePicker}
    />
  );

  if (layout !== "desktop") {
    return (
      <View testID="pantalla" style={styles.screen}>
        {/* Mientras el selector está abierto, el resto queda fuera del árbol accesible. */}
        <View aria-hidden={openPicker !== undefined} style={styles.grow}>
          <View
            style={[
              styles.mobileHeader,
              { paddingTop: insets.top, paddingLeft: 18 + insets.left, paddingRight: 18 + insets.right },
            ]}
          >
            <Brand size={22} fontSize={20} gap={7} />
            <View style={[styles.row, styles.mobileMode]}>
              <Icon name="phone" size={15} color={COLORS.cabeceraModo} />
              <Text style={styles.mobileModeText}>{CHROME.faceToFaceHeader}</Text>
            </View>
            <Text style={styles.mobileDemo}>{CHROME.demo}</Text>
          </View>
          <View
            testID="conversacion"
            style={[
              styles.phoneHalves,
              { paddingBottom: 8 + insets.bottom, paddingLeft: 8 + insets.left, paddingRight: 8 + insets.right },
            ]}
          >
            {half("A")}
            {half("B")}
          </View>
        </View>
        {pickerLayer}
      </View>
    );
  }

  return (
    <View testID="pantalla" style={styles.screen}>
      <ScrollView
        aria-hidden={openPicker !== undefined}
        style={styles.grow}
        contentContainerStyle={[
          styles.canvas,
          { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: 32 + insets.left, paddingRight: 32 + insets.right },
        ]}
      >
        <View style={styles.header}>
          <Brand size={30} fontSize={28} gap={12} />
          <View style={styles.pill}>
            <Text style={styles.pillText}>{CHROME.demo}</Text>
          </View>
        </View>

        <View style={styles.intro}>
          <View style={styles.shrink}>
            <Text role="heading" style={styles.title}>
              {CHROME.title}
            </Text>
            <Text style={styles.subtitle}>{CHROME.subtitle}</Text>
          </View>
        </View>

        <View testID="conversacion" style={styles.sideBySide}>
          {half("A")}
          {half("B")}
        </View>

        <View style={styles.footer}>
          <View style={[styles.row, styles.footerDemo]}>
            <View style={styles.demoBadge}>
              <Text style={styles.demoBadgeText}>{CHROME.demo}</Text>
            </View>
            <Text style={[styles.footerText, styles.shrink]}>{audio ? CHROME.footerLocal : CHROME.footer}</Text>
          </View>
        </View>
      </ScrollView>
      {pickerLayer}
    </View>
  );
}

const upper: TextStyle = { textTransform: "uppercase" };

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.fondo },
  grow: { flex: 1 },
  // Llena el alto disponible pero, si el contenido es mayor, crece en vez de encoger sus hijos.
  scrollContent: { flexGrow: 1 },
  natural: { flexGrow: 1, flexShrink: 0 },
  row: { flexDirection: "row", alignItems: "center" },
  shrink: { flexShrink: 1 },
  strong: { fontWeight: "700" },
  upper,
  centered: { textAlign: "center" },
  rotated: { transform: [{ rotate: "180deg" }] },
  pressed: { opacity: 0.85 },
  dimmed: { opacity: 0.55 },

  // Teléfono: cabecera de 52 y dos mitades iguales con márgenes de 8.
  mobileHeader: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    backgroundColor: COLORS.blanco,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.linea,
  },
  mobileMode: { gap: 7, flexShrink: 1 },
  mobileModeText: { fontSize: 10, lineHeight: 14, fontWeight: "600", letterSpacing: 0.2, color: COLORS.cabeceraModo },
  mobileDemo: { fontSize: 9, lineHeight: 12, letterSpacing: 0.5, color: COLORS.apagado },
  phoneHalves: { flex: 1, flexDirection: "column-reverse", gap: 8, paddingTop: 8 },
  brand: { fontWeight: "700", letterSpacing: -1, color: COLORS.tinta },

  // Escritorio: lienzo de 1320 como máximo con márgenes de 32.
  canvas: { width: "100%", maxWidth: 1320, alignSelf: "center" },
  header: {
    minHeight: 88,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.linea,
  },
  pill: { borderWidth: 1, borderColor: COLORS.pildora, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 12 },
  pillText: { fontSize: 12, lineHeight: 14, fontWeight: "500", color: COLORS.apagado },
  intro: {
    marginTop: 36,
    marginBottom: 28,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 24,
  },
  title: { fontSize: 34, lineHeight: 37, fontWeight: "700", letterSpacing: -1.1, color: COLORS.tinta, marginBottom: 8 },
  subtitle: { fontSize: 15, lineHeight: 18, color: COLORS.apagado },
  sideBySide: { height: 552, flexDirection: "row-reverse", gap: 16 },
  footer: {
    paddingTop: 25,
    paddingBottom: 24,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 24,
  },
  footerDemo: { gap: 9, flexShrink: 1 },
  demoBadge: { borderRadius: 5, paddingVertical: 5, paddingHorizontal: 7, backgroundColor: COLORS.demoFondo },
  demoBadgeText: { fontSize: 10, lineHeight: 12, fontWeight: "700", letterSpacing: 0.7, color: COLORS.demoTexto },
  footerText: { fontSize: 12, lineHeight: 16, color: COLORS.apagado },

  // Panel de cada persona.
  half: { flex: 1, minWidth: 0, borderWidth: 1, overflow: "hidden" },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  badge: { borderWidth: 1, alignItems: "center", justifyContent: "center" },
  status: { gap: 6, flexShrink: 1, justifyContent: "flex-end" },
  body: { flex: 1 },
  phrase: { fontWeight: "500", maxWidth: 510 },
  emptyTitle: { maxWidth: 420 },
  issue: { marginTop: 14, fontWeight: "600" },
  notice: { flexDirection: "row", gap: 8, borderRadius: 12, padding: 12, marginTop: 14 },
  noticeText: { fontSize: 14, lineHeight: 20 },
  bottom: { borderTopWidth: 1 },
  // Al pie del cuerpo, junto a los controles; con letra grande se alcanza desplazando.
  lockedNote: { marginTop: "auto", paddingTop: 12 },
  cancelRow: { alignSelf: "flex-end", marginBottom: 8 },
  controls: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  listenNote: { flexShrink: 1, maxWidth: 150 },
  cluster: { flexDirection: "row", alignItems: "center", gap: 18, flexShrink: 1, marginLeft: "auto" },
  // A escala 1 sobra ancho (space-between); la separación mínima solo cuenta con letra grande.
  clusterFull: { flex: 1, justifyContent: "space-between", gap: 8 },
  selector: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 13,
  },
  selectorLocked: { paddingHorizontal: 8 },
  caption: { fontWeight: "500", opacity: 0.85, marginBottom: 4 },
  value: { fontWeight: "600", letterSpacing: -0.2 },
  cancel: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { fontSize: 14, lineHeight: 18, fontWeight: "600" },
  clipButton: { alignSelf: "flex-start", marginTop: 14 },
  clipFailed: { marginTop: 8 },
  speak: { alignItems: "center", borderRadius: 12 },
  ring: { position: "absolute", top: -7, left: -7 },
  circle: { flex: 1, borderWidth: 2, alignItems: "center", justifyContent: "center" },
});
