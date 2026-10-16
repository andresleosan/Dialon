import { RECEIPT_MAX_BYTES, RECEIPT_TYPES } from "@dialon/contracts";
import { useId, type ChangeEvent } from "react";
import { COLORS } from "../theme";
import type { ReceiptPickerProps } from "./ReceiptPicker";

export type { PickedReceipt, ReceiptPickerProps } from "./ReceiptPicker";

// Web: un `<input type="file">` nativo del navegador con su etiqueta visible (teclado y lector de pantalla incluidos).
// Solo se comprueba tipo y tamaño aquí; la firma real la comprueba el servidor. El archivo no se lee ni se muestra.

const LABEL = "Elegir comprobante (PDF, PNG o JPG)";

export function ReceiptPicker({ disabled, onPick, onReject }: ReceiptPickerProps) {
  const id = useId();
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Se vacía para poder elegir otra vez el mismo archivo.
    input.value = "";
    if (!file) return;
    const type = RECEIPT_TYPES.find((candidate) => candidate === file.type);
    if (!type) {
      onReject("Ese tipo de archivo no vale: elige un PDF, PNG o JPG.");
      return;
    }
    if (file.size === 0 || file.size > RECEIPT_MAX_BYTES) {
      onReject(file.size === 0 ? "El archivo está vacío." : "El archivo pasa de 5 MiB.");
      return;
    }
    onPick({ data: file, type, name: file.name, bytes: file.size });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label htmlFor={id} style={{ fontSize: 14, lineHeight: "20px", fontWeight: 600, color: COLORS.tinta, fontFamily: "inherit" }}>
        {LABEL}
      </label>
      <input
        id={id}
        type="file"
        accept={RECEIPT_TYPES.join(",")}
        disabled={disabled}
        onChange={onChange}
        style={{ minHeight: 48, fontSize: 16, color: COLORS.tinta, maxWidth: "100%" }}
      />
    </div>
  );
}
