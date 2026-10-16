// Progreso interno de la limpieza. Sólo cursores y fechas, sin datos de usuarios ni del comprobante.
type Scan = "receipts-db" | "receipts-r2";

export async function retentionCursor(db: D1Database, scan: Scan): Promise<string | undefined> {
  const row = await db.prepare("SELECT cursor FROM maintenance_cursors WHERE scan = ?1").bind(scan).first<{ cursor: unknown }>();
  return typeof row?.cursor === "string" ? row.cursor : undefined;
}

export async function saveRetentionCursor(db: D1Database, scan: Scan, cursor: string | undefined, now: number): Promise<void> {
  await db.prepare(
    "INSERT INTO maintenance_cursors(scan, cursor, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(scan) DO UPDATE SET cursor=excluded.cursor, updated_at=excluded.updated_at",
  ).bind(scan, cursor ?? null, now).run();
}

interface ExpiredRow {
  readonly id: string;
  readonly proof_key: string;
  readonly receipt_expires_at: number;
}

function decode(cursor: string | undefined): { at: number | null; id: string | null } {
  try {
    const value: unknown = JSON.parse(cursor ?? "null");
    if (Array.isArray(value) && typeof value[0] === "number" && Number.isSafeInteger(value[0]) && typeof value[1] === "string") {
      return { at: value[0], id: value[1] };
    }
  } catch {
    // Un cursor inválido reinicia el barrido; no autoriza a borrar nada.
  }
  return { at: null, id: null };
}

export async function expiredReceiptPage(db: D1Database, now: number, limit: number, cursor: string | undefined) {
  const { at, id } = decode(cursor);
  const { results } = await db.prepare(
    `SELECT id, proof_key, receipt_expires_at FROM payment_requests
     WHERE proof_key IS NOT NULL AND status IN ('approved', 'rejected') AND receipt_expires_at <= ?1
       AND (?3 IS NULL OR receipt_expires_at > ?3 OR (receipt_expires_at = ?3 AND id > ?4))
     ORDER BY receipt_expires_at, id LIMIT ?2`,
  ).bind(now, limit + 1, at, id).all<ExpiredRow>();
  const items = results.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: results.length > limit && last ? JSON.stringify([last.receipt_expires_at, last.id]) : undefined,
  };
}
