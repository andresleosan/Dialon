import type { FC } from "react";
import type { ReceiptType } from "@dialon/contracts";
import { Paragraph } from "./ui";

export interface PickedReceipt {
  readonly data: Blob;
  readonly type: ReceiptType;
  readonly name: string;
  readonly bytes: number;
}

export interface ReceiptPickerProps {
  readonly disabled: boolean;
  readonly onPick: (file: PickedReceipt) => void;
  /** Archivo rechazado antes de subir (tipo o tamaño). */
  readonly onReject: (reason: string) => void;
}

/** Nativo: sin selector de archivos todavía (sin dependencias nuevas). En web, `ReceiptPicker.web.tsx`. */
export const ReceiptPicker: FC<ReceiptPickerProps> = () => {
  return <Paragraph muted>Para subir el comprobante, usa Dialon en el navegador.</Paragraph>;
}
