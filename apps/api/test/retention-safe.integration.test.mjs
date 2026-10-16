// Retención segura en D1/R2 LOCALES de Miniflare: la purga solo con RECEIPT_PURGE_ENABLED === "true" (exacto), nunca
// de solicitudes pendientes, y una previsualización de solo lectura con contadores agregados. Filas y objetos
// sintéticos; sin red externa, cron, credenciales ni documentos reales.
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as routes from "../src/paymentRoutes";
import { applyMigrations } from "./support/local-d1.mjs";

const DAY = 86_400_000;
const NOW = Date.now();
// La limpieza se evalúa en un instante futuro: todo lo subido «hoy» tiene ya más de 90 días.
const FUTURE = NOW + 91 * DAY;
const PDF = "%PDF-1.4 SOLO QA";
const bundle = join(import.meta.dirname, "..", "..", "..", ".tools", "api", "bundle", "index.js");

let mf;
afterEach(async () => {
  await mf?.dispose();
  mf = undefined;
});

async function fixture(scriptPath) {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      ...(scriptPath ? { scriptPath } : { script: "export default { fetch() { return new globalThis.Response('QA'); } };" }),
      compatibilityDate: "2026-10-06",
      compatibilityFlags: ["nodejs_compat"],
      // Sin RECEIPT_PURGE_ENABLED: el valor por defecto real.
      bindings: { ALLOWED_ORIGINS: "https://dialon.pages.dev", OWNER_EMAIL: "qa@example.com", OWNER_FIREBASE_UID: "" },
      d1Databases: ["DB"],
      r2Buckets: ["PROOFS"],
      ratelimits: { TRANSLATE_LIMITER: { namespace_id: "4102", simple: { limit: 10, period: 60 } } },
      outboundService: () => new globalThis.Response("Outbound forbidden", { status: 599 }),
    }),
  );
  await mf.ready;
  await applyMigrations(mf, join(import.meta.dirname, "..", "migrations"));
  return { db: await mf.getD1Database("DB"), bucket: await mf.getR2Bucket("PROOFS") };
}

const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const keyOf = (n, at = NOW) => `receipts/${String(at).padStart(13, "0")}-${id(n)}`;

/**
 * Escenario fijo:
 * 1 aprobada vencida, 2 rechazada vencida  → vencidas purgables (2)
 * 3 aprobada reciente, 4 rechazada reciente → dentro de retención
 * 5 pendiente vencida, 6 pendiente reciente → nunca purgables
 * huérfano antiguo con formato de la app (1), huérfano con clave futura (reciente), clave ajena.
 */
async function seed(db, bucket) {
  const rows = [
    [1, "approved", NOW - 1],
    [2, "rejected", NOW - 1],
    [3, "approved", FUTURE + DAY],
    [4, "rejected", FUTURE + DAY],
    [5, "pending", NOW - 1],
    [6, "pending", FUTURE + DAY],
  ];
  for (const [n, status, expiresAt] of rows) {
    const uid = `qa-retention-${String(n)}`;
    await db.prepare("INSERT INTO users(uid,email,created_at,last_seen_at) VALUES (?1,NULL,?2,?2)").bind(uid, NOW).run();
    await bucket.put(keyOf(n), PDF);
    await db
      .prepare(
        `INSERT INTO payment_requests(id,uid,plan,amount_minor,currency,status,idempotency_key,created_at,decided_at,days,max_requests,
           max_chars,proof_key,proof_mime,proof_bytes,proof_uploaded_at,receipt_expires_at)
         VALUES (?1,?7,'weekly',100,'EUR',?2,?1,?3,?4,7,5,1000,?5,'application/pdf',16,?3,?6)`,
      )
      .bind(id(n), status, NOW, status === "pending" ? null : NOW, keyOf(n), expiresAt, uid)
      .run();
  }
  const orphan = keyOf(90);
  const recentOrphan = keyOf(91, FUTURE);
  await bucket.put(orphan, PDF);
  await bucket.put(recentOrphan, PDF);
  await bucket.put("receipts/ajeno.pdf", PDF);
  return { orphan, recentOrphan, foreign: "receipts/ajeno.pdf", keys: rows.map(([n]) => keyOf(n)) };
}

async function snapshot(db, bucket) {
  const objects = (await bucket.list({ prefix: "receipts/" })).objects.map((object) => object.key).sort();
  const references = (await db.prepare("SELECT id, proof_key, receipt_purged_at FROM payment_requests ORDER BY id").all()).results;
  const cursors = (await db.prepare("SELECT COUNT(*) AS n FROM maintenance_cursors").first()).n;
  return { objects, references, cursors };
}

function previewFn() {
  const candidate = routes.previewExpiredReceipts;
  return typeof candidate === "function" ? candidate : undefined;
}

describe("guarda de purga", () => {
  it("sin la cadena exacta \"true\" no borra objetos, no olvida referencias ni escribe cursores", async () => {
    const { db, bucket } = await fixture();
    await seed(db, bucket);
    const before = await snapshot(db, bucket);
    expect(before.cursors).toBe(0);
    for (const extra of [{}, { RECEIPT_PURGE_ENABLED: "false" }, { RECEIPT_PURGE_ENABLED: true }, { RECEIPT_PURGE_ENABLED: "TRUE" }, { RECEIPT_PURGE_ENABLED: "1" }, { RECEIPT_PURGE_ENABLED: "true " }]) {
      await expect(routes.cleanupExpiredReceipts({ DB: db, PROOFS: bucket, ...extra }, FUTURE)).resolves.toBe(0);
      expect(await snapshot(db, bucket)).toEqual(before);
    }
  });

  it("el Worker por defecto (sin variable) no purga nada al ejecutar scheduled", async () => {
    expect(existsSync(bundle)).toBe(true);
    const { db, bucket } = await fixture(bundle);
    await seed(db, bucket);
    const before = await snapshot(db, bucket);
    const worker = await mf.getWorker();
    await worker.scheduled({ scheduledTime: new Date(FUTURE) });
    expect(await snapshot(db, bucket)).toEqual(before);
  });

  it("con \"true\" explícito: purga resueltas vencidas y huérfanos antiguos; nunca pendientes, recientes ni ajenos", async () => {
    const { db, bucket } = await fixture();
    const { orphan, recentOrphan, foreign, keys } = await seed(db, bucket);
    await expect(routes.cleanupExpiredReceipts({ DB: db, PROOFS: bucket, RECEIPT_PURGE_ENABLED: "true" }, FUTURE)).resolves.toBe(3);
    const after = await snapshot(db, bucket);
    expect(after.objects).toEqual([foreign, keys[2], keys[3], keys[4], keys[5], recentOrphan].sort());
    expect(after.objects).not.toContain(orphan);
    const byId = Object.fromEntries(after.references.map((row) => [row.id, row]));
    expect(byId[id(1)]).toMatchObject({ proof_key: null, receipt_purged_at: FUTURE });
    expect(byId[id(2)]).toMatchObject({ proof_key: null, receipt_purged_at: FUTURE });
    for (const n of [3, 4, 5, 6]) expect(byId[id(n)]).toMatchObject({ proof_key: keyOf(n), receipt_purged_at: null });
  });
});

describe("previsualización de solo lectura", () => {
  it("existe como función exportada", () => {
    expect(typeof previewFn()).toBe("function");
  });

  it("cuenta exactamente vencidas resueltas y huérfanos antiguos, sin pendientes; no escribe nada, con guarda ausente o false", async () => {
    const preview = previewFn();
    if (!preview) return expect(preview).toBeDefined();
    const { db, bucket } = await fixture();
    await seed(db, bucket);
    const before = await snapshot(db, bucket);
    for (const extra of [{}, { RECEIPT_PURGE_ENABLED: "false" }]) {
      const result = await preview({ DB: db, PROOFS: bucket, ...extra }, FUTURE);
      expect(result).toEqual({ expiredReceipts: 2, orphanReceipts: 1, hasMore: false });
      // Solo contadores: ni claves, ni identificadores, ni contenido.
      const text = JSON.stringify(result);
      for (const forbidden of ["receipts/", "qa-retention", id(1), "PDF"]) expect(text).not.toContain(forbidden);
      expect(await snapshot(db, bucket)).toEqual(before);
    }
  });

  it("con presupuesto agotado indica hasMore sin escribir cursores", async () => {
    const preview = previewFn();
    if (!preview) return expect(preview).toBeDefined();
    const { db, bucket } = await fixture();
    await seed(db, bucket);
    const before = await snapshot(db, bucket);
    const result = await preview({ DB: db, PROOFS: bucket }, FUTURE, 1, 1);
    expect(result).toMatchObject({ hasMore: true });
    expect(Object.keys(result).sort()).toEqual(["expiredReceipts", "hasMore", "orphanReceipts"]);
    expect(result.expiredReceipts).toBeLessThanOrEqual(2);
    expect(await snapshot(db, bucket)).toEqual(before);
  });
});
