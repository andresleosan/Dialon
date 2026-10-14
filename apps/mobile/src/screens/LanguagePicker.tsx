import type { Participant } from "@dialon/core";
import { useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AUTONYMS, LANGUAGES, isUiLanguage, type Copy, type Language } from "../copy";
import { Icon } from "../icons";
import { COLORS, PICKER } from "../theme";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface LanguagePickerProps {
  readonly participant: Participant;
  readonly copy: Copy;
  readonly current: Language;
  /** Hoja inferior en el móvil; ventana flotante junto a su selector en pantallas anchas. */
  readonly variant: "sheet" | "popover";
  /** B en cara a cara: todo el selector gira 180° y aparece en su lado (búsqueda, opciones y cierre incluidos). */
  readonly rotated: boolean;
  /** Selector que lo abrió, en coordenadas de ventana; hasta medirlo, la ventana flotante va centrada abajo. */
  readonly anchor?: Rect;
  readonly onSelect: (language: Language) => void;
  readonly onClose: () => void;
}

const POPOVER_WIDTH = 382;

/** Minúsculas y sin tildes: «PORTUGUES» encuentra «Portugués». */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Encima del selector y alineada con su borde derecho, como en la maqueta; si no cabe, ocupa el alto disponible.
 * Con B girada se calcula en el sistema de B, porque la capa del modal también gira 180°.
 */
function popoverPlace(anchor: Rect | undefined, width: number, height: number, rotated: boolean) {
  if (anchor === undefined) {
    return { left: Math.max(16, (width - POPOVER_WIDTH) / 2), bottom: 24, maxHeight: height - 48 };
  }
  const top = rotated ? height - anchor.y - anchor.height : anchor.y;
  const right = rotated ? width - anchor.x : anchor.x + anchor.width;
  const left = Math.max(16, Math.min(right - POPOVER_WIDTH, width - POPOVER_WIDTH - 16));
  const room = top - 14 - 16;
  return room >= 320
    ? { left, bottom: height - top + 14, maxHeight: room }
    : { left, bottom: 24, maxHeight: height - 48 };
}

/**
 * Selector de idioma de una persona: modal real (en web, react-native-web atrapa Tab/Mayús+Tab, cierra con Escape
 * y devuelve el foco al selector; en Android, «atrás» lo cierra). Busca por nombre y autónimo.
 */
export function LanguagePicker({
  participant,
  copy,
  current,
  variant,
  rotated,
  anchor,
  onSelect,
  onClose,
}: LanguagePickerProps) {
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const search = useRef<TextInput>(null);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wanted = fold(query.trim());
  const matches = LANGUAGES.filter((code) => fold(`${copy.languageNames[code]} ${AUTONYMS[code]}`).includes(wanted));
  const sheet = variant === "sheet";
  const place = sheet
    ? {
        left: 8 + insets.left,
        right: 8 + insets.right,
        bottom: 8 + (rotated ? insets.top : insets.bottom),
        maxHeight: height - 70,
      }
    : popoverPlace(anchor, width, height, rotated);

  return (
    <Modal
      testID={`selector-${participant}`}
      aria-label={copy.picker.title}
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
      // Al mostrarse (y no al montar, para que el modal web recuerde antes qué selector lo abrió).
      onShow={() => search.current?.focus()}
    >
      <View testID="capa-selector" style={[StyleSheet.absoluteFill, rotated && styles.rotated]}>
        <View
          testID="fondo-selector"
          style={[StyleSheet.absoluteFill, styles.scrim]}
          onStartShouldSetResponder={() => true}
          onResponderRelease={onClose}
        />
        <View style={[styles.surface, sheet ? styles.sheet : styles.popover, place]}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={sheet ? styles.sheetContent : styles.popoverContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.head}>
              <View style={styles.grow}>
                <Text style={styles.owner}>{`${copy.person} ${participant}`}</Text>
                <Text role="heading" style={[styles.title, sheet && styles.titleSheet]}>
                  {copy.picker.title}
                </Text>
              </View>
              {/* Círculo de 32 como en la maqueta dentro de una zona táctil de 48. */}
              <Pressable role="button" aria-label={copy.picker.close} onPress={onClose} style={styles.closeHit}>
                <View style={styles.closeCircle}>
                  <Icon name="close" size={20} color={PICKER.cerrarIcono} />
                </View>
              </Pressable>
            </View>

            <View style={[styles.search, searchFocused && styles.searchFocused]}>
              <Icon name="search" size={20} color={PICKER.buscadorIcono} />
              <TextInput
                ref={search}
                value={query}
                onChangeText={setQuery}
                placeholder={copy.picker.search}
                aria-label={copy.picker.search}
                placeholderTextColor={PICKER.marcador}
                autoCapitalize="none"
                autoCorrect={false}
                onFocus={() => {
                  setSearchFocused(true);
                }}
                onBlur={() => {
                  setSearchFocused(false);
                }}
                style={styles.searchInput}
              />
            </View>

            <Text style={styles.listLabel}>{copy.picker.listLabel}</Text>
            <View role="radiogroup" aria-label={copy.picker.listLabel}>
              {matches.map((code) => {
                const selected = code === current;
                const demo = isUiLanguage(code);
                const name = copy.languageNames[code];
                const badge = demo ? copy.picker.demo : copy.picker.pending;
                const label = name === AUTONYMS[code] ? `${name}, ${badge}` : `${name} (${AUTONYMS[code]}), ${badge}`;
                return (
                  <Pressable
                    key={code}
                    role="radio"
                    aria-checked={selected}
                    aria-label={label}
                    onPress={() => {
                      onSelect(code);
                    }}
                    style={({ pressed }) => [
                      styles.option,
                      sheet && styles.optionSheet,
                      selected && styles.optionCurrent,
                      pressed && styles.pressed,
                    ]}
                  >
                    {/* La opción actual se distingue por ✓ y por su forma de fondo, no solo por el color. */}
                    <View style={styles.check}>
                      {selected && <Icon name="check" size={18} color={COLORS.marino} stroke={2} />}
                    </View>
                    <View style={styles.grow}>
                      <Text style={styles.optionName}>{name}</Text>
                      <Text style={styles.autonym}>{AUTONYMS[code]}</Text>
                    </View>
                    <View style={[styles.badge, demo && styles.badgeDemo]}>
                      <Text style={[styles.badgeText, demo && styles.badgeDemoText]}>{badge}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            {matches.length === 0 && <Text style={styles.noResults}>{copy.picker.noResults}</Text>}
            <Text style={styles.foot}>{copy.picker.foot}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  rotated: { transform: [{ rotate: "180deg" }] },
  scrim: { backgroundColor: COLORS.velo },
  surface: {
    position: "absolute",
    backgroundColor: COLORS.blanco,
    borderWidth: 1,
    borderColor: PICKER.borde,
    shadowColor: "#172D53",
    shadowOpacity: 0.14,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
    overflow: "hidden",
  },
  sheet: { borderRadius: 23 },
  popover: { width: POPOVER_WIDTH, borderRadius: 20 },
  scroll: { flexGrow: 0 },
  sheetContent: { paddingVertical: 24, paddingHorizontal: 22 },
  popoverContent: { padding: 24 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 18 },
  grow: { flex: 1 },
  owner: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: PICKER.ceja,
    marginBottom: 7,
  },
  title: { fontSize: 22, lineHeight: 25, fontWeight: "700", letterSpacing: -0.6, color: COLORS.tinta },
  titleSheet: { fontSize: 23, lineHeight: 26 },
  closeHit: {
    width: 48,
    height: 48,
    margin: -8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
    outlineColor: COLORS.marino,
  },
  closeCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: PICKER.cerrarFondo,
    alignItems: "center",
    justifyContent: "center",
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: PICKER.buscadorBorde,
    borderRadius: 11,
  },
  // Foco visible del buscador: borde marino de 2 px (se compensa el relleno para que nada se mueva).
  searchFocused: { borderWidth: 2, borderColor: COLORS.marino, paddingHorizontal: 12 },
  // Ocupa todo el alto del recuadro (toque fácil); su anillo propio se quita porque el foco ya lo marca el borde.
  searchInput: {
    flex: 1,
    alignSelf: "stretch",
    minWidth: 0,
    fontSize: 14,
    color: COLORS.tinta,
    backgroundColor: "transparent",
    outlineStyle: "solid",
    outlineWidth: 0,
  },
  listLabel: {
    marginTop: 20,
    marginBottom: 8,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: PICKER.lista,
  },
  option: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 7,
    paddingHorizontal: 10,
    // En la maqueta los márgenes de 2 entre opciones colapsan: 1 arriba y 1 abajo dan la misma separación.
    marginVertical: 1,
    borderRadius: 10,
    outlineColor: COLORS.marino,
  },
  optionSheet: { minHeight: 52 },
  optionCurrent: { backgroundColor: PICKER.actual },
  pressed: { opacity: 0.85 },
  check: { width: 18, alignItems: "center" },
  optionName: { fontSize: 14, lineHeight: 18, fontWeight: "600", color: COLORS.tinta },
  autonym: { marginTop: 3, fontSize: 11, lineHeight: 14, color: PICKER.autonimo },
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: PICKER.etiquetaBorde,
    backgroundColor: PICKER.etiquetaFondo,
  },
  badgeDemo: { borderColor: PICKER.demoBorde, backgroundColor: PICKER.demoFondo },
  badgeText: { fontSize: 10, lineHeight: 12, color: PICKER.etiqueta },
  badgeDemoText: { color: PICKER.demoTexto },
  noResults: { paddingVertical: 20, paddingHorizontal: 8, fontSize: 14, lineHeight: 20, color: PICKER.etiqueta },
  foot: {
    marginTop: 17,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: PICKER.pieLinea,
    fontSize: 11,
    lineHeight: 17,
    color: PICKER.pie,
  },
});
