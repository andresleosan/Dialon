import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { COLORS } from "../theme";

// Piezas comunes de los paneles de cuenta: paleta marino/blanco, objetivos de 48 como mínimo, foco visible y etiquetas
// visibles. Todo se envuelve (sin anchos fijos) para leerse a 320 de ancho y con el texto al 200 %.

export function Heading({ children }: { readonly children: string }) {
  return (
    <Text role="heading" style={styles.heading}>
      {children}
    </Text>
  );
}

export function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text role="heading" style={styles.sectionTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function Paragraph({ children, muted = false }: { readonly children: ReactNode; readonly muted?: boolean }) {
  return <Text style={[styles.paragraph, muted && styles.muted]}>{children}</Text>;
}

/** Error anunciado como alerta. */
export function Alert({ children }: { readonly children: string | undefined }) {
  if (children === undefined) return null;
  return (
    <Text role="alert" style={styles.alert}>
      {children}
    </Text>
  );
}

/** Confirmación anunciada sin interrumpir. */
export function Status({ children }: { readonly children: string | undefined }) {
  if (children === undefined) return null;
  return (
    <Text aria-live="polite" style={styles.status}>
      {children}
    </Text>
  );
}

interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly primary?: boolean;
  readonly accessibilityLabel?: string;
  readonly current?: boolean;
}

export function Button({ label, onPress, disabled = false, primary = false, accessibilityLabel, current }: ButtonProps) {
  return (
    <Pressable
      role="button"
      aria-label={accessibilityLabel ?? label}
      aria-selected={current}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary || current ? styles.primary : styles.secondary,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, (primary || current) && styles.primaryText]}>{label}</Text>
    </Pressable>
  );
}

export function Row({ children }: { readonly children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

interface ChoiceProps<T extends string> {
  readonly label: string;
  readonly value: T | undefined;
  readonly options: readonly { readonly value: T; readonly label: string; readonly disabled?: boolean }[];
  readonly onChange: (value: T) => void;
}

/** Grupo de opciones excluyentes (radio). */
export function Choice<T extends string>({ label, value, options, onChange }: ChoiceProps<T>) {
  return (
    <View accessible role="radiogroup" accessibilityLabel={label} style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              role="radio"
              aria-checked={selected}
              aria-label={option.label}
              disabled={option.disabled}
              onPress={() => {
                onChange(option.value);
              }}
              style={({ pressed }) => [
                styles.option,
                selected && styles.optionSelected,
                option.disabled && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.optionText, selected && styles.primaryText]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Checkbox({ label, checked, onChange }: { readonly label: string; readonly checked: boolean; readonly onChange: (checked: boolean) => void }) {
  return (
    <Pressable
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onPress={() => {
        onChange(!checked);
      }}
      style={({ pressed }) => [styles.checkbox, pressed && styles.pressed]}
    >
      <View style={[styles.box, checked && styles.boxChecked]}>{checked && <Text style={styles.tick}>✓</Text>}</View>
      <Text style={[styles.paragraph, styles.shrink]}>{label}</Text>
    </Pressable>
  );
}

interface FieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly hint?: string;
  readonly multiline?: boolean;
  readonly numeric?: boolean;
  /** Importes con punto decimal (teclado decimal). */
  readonly decimal?: boolean;
  readonly maxLength?: number;
}

export function Field({ label, value, onChangeText, hint, multiline = false, numeric = false, decimal = false, maxLength }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        aria-label={label}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        inputMode={decimal ? "decimal" : numeric ? "numeric" : "text"}
        maxLength={maxLength}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, multiline && styles.multiline]}
      />
      {hint !== undefined && <Text style={[styles.paragraph, styles.muted]}>{hint}</Text>}
    </View>
  );
}

/** Par «etiqueta: valor» de solo lectura. */
export function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <Text style={styles.paragraph}>
      <Text style={styles.strong}>{`${label}: `}</Text>
      {value}
    </Text>
  );
}

export function Card({ children, testID }: { readonly children: ReactNode; readonly testID?: string }) {
  return (
    <View testID={testID} style={styles.card}>
      {children}
    </View>
  );
}

const focus = { outlineColor: COLORS.marino };

const styles = StyleSheet.create({
  heading: { fontSize: 28, lineHeight: 34, fontWeight: "700", letterSpacing: -0.6, color: COLORS.tinta },
  section: { gap: 12, paddingVertical: 20, borderTopWidth: 1, borderTopColor: COLORS.linea },
  sectionTitle: { fontSize: 19, lineHeight: 25, fontWeight: "700", color: COLORS.tinta },
  paragraph: { fontSize: 15, lineHeight: 22, color: COLORS.tinta },
  muted: { color: COLORS.apagado },
  strong: { fontWeight: "700" },
  shrink: { flexShrink: 1 },
  alert: { fontSize: 15, lineHeight: 22, fontWeight: "600", color: "#8A1C12", backgroundColor: "#FDECEA", padding: 12, borderRadius: 12 },
  status: { fontSize: 15, lineHeight: 22, fontWeight: "600", color: COLORS.marino, backgroundColor: "#E8EEF8", padding: 12, borderRadius: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  button: { maxWidth: "100%", flexShrink: 1, paddingVertical: 12, minHeight: 48, minWidth: 48, justifyContent: "center", paddingHorizontal: 18, borderRadius: 24, borderWidth: 1, ...focus },
  primary: { backgroundColor: COLORS.marino, borderColor: COLORS.marino },
  secondary: { backgroundColor: COLORS.blanco, borderColor: COLORS.pildora },
  buttonText: { fontSize: 15, lineHeight: 20, fontWeight: "600", color: COLORS.tinta, textAlign: "center" },
  primaryText: { color: COLORS.blanco },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  field: { gap: 6 },
  label: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: COLORS.tinta },
  input: {
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.apagado,
    borderRadius: 10,
    backgroundColor: COLORS.blanco,
    fontSize: 16,
    color: COLORS.tinta,
    ...focus,
  },
  multiline: { minHeight: 96, textAlignVertical: "top" },
  option: { maxWidth: "100%", flexShrink: 1, paddingVertical: 12, minHeight: 48, justifyContent: "center", paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: COLORS.pildora, backgroundColor: COLORS.blanco, ...focus },
  optionSelected: { backgroundColor: COLORS.marino, borderColor: COLORS.marino },
  optionText: { fontSize: 15, lineHeight: 20, fontWeight: "600", color: COLORS.tinta },
  checkbox: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, ...focus },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: COLORS.marino, alignItems: "center", justifyContent: "center" },
  boxChecked: { backgroundColor: COLORS.marino },
  tick: { color: COLORS.blanco, fontSize: 15, lineHeight: 18, fontWeight: "700" },
  card: { gap: 8, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: COLORS.linea, backgroundColor: COLORS.blanco },
});
