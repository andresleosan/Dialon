// Regresión de retención: D1/R2 reales de Miniflare, con un fallo de borrado controlado.
// No red externa, documentos reales, cron ni credenciales.
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { cleanupExpiredReceipts } from "../src/paymentRoutes";
import { applyMigrations } from "./support/local-d1.mjs";

let mf;
afterEach(async()=>{await mf?.dispose();mf=undefined});
async function fixture(){
 mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:"export default { fetch() { return new globalThis.Response('QA'); } };",compatibilityDate:"2026-10-06",d1Databases:["DB"],r2Buckets:["PROOFS"],outboundService:()=>new globalThis.Response("Outbound forbidden",{status:599})}));
 await mf.ready;await applyMigrations(mf,join(import.meta.dirname,"..","migrations"));
 return{db:await mf.getD1Database("DB"),bucket:await mf.getR2Bucket("PROOFS")};
}
describe("retención avanza aunque falle un lote entero",()=>{
 it("con presupuesto de un lote, otra ejecución alcanza el segundo comprobante",async()=>{
  const{db,bucket}=await fixture(),now=Date.now(),future=now+91*86400000;
  const ids=["10000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000002"];
  const keys=ids.map(id=>"receipts/"+String(now)+"-"+id);
  await db.prepare("INSERT INTO users(uid,email,created_at,last_seen_at)VALUES('qa-retention',NULL,?1,?1)").bind(now).run();
  for(let i=0;i<2;i++){
   await bucket.put(keys[i],"%PDF-1.4 SOLO QA");
   await db.prepare("INSERT INTO payment_requests(id,uid,plan,amount_minor,currency,status,idempotency_key,created_at,days,max_requests,max_chars,proof_key,proof_mime,proof_bytes,proof_uploaded_at,receipt_expires_at)VALUES(?1,'qa-retention','weekly',100,'EUR','approved',?1,?2,7,5,1000,?3,'application/pdf',16,?2,?4)").bind(ids[i],now,keys[i],now+90*86400000).run();
  }
  const wrapped={put:(...args)=>bucket.put(...args),list:(...args)=>bucket.list(...args),delete:async key=>{if(key===keys[0])throw Error("fallo persistente sintético");return bucket.delete(key)}};
  const env={DB:db,PROOFS:wrapped,RECEIPT_PURGE_ENABLED:"true"};
  await cleanupExpiredReceipts(env,future,1,1);
  await cleanupExpiredReceipts(env,future,1,1);
  expect(await bucket.head(keys[0])).not.toBeNull();
  expect(await bucket.head(keys[1])).toBeNull();
  expect((await db.prepare("SELECT proof_key FROM payment_requests WHERE id=?1").bind(ids[1]).first()).proof_key).toBeNull();
 });
 it("el cursor R2 continúa entre ejecuciones aunque la primera página no sea eliminable",async()=>{
  const{db,bucket}=await fixture(),now=Date.now(),future=now+91*86400000;
  await Promise.all(Array.from({length:101},(_,i)=>bucket.put("receipts/0000000000000-ajeno-"+String(i).padStart(3,"0"),"QA")));
  const key="receipts/"+String(now)+"-30000000-0000-4000-8000-000000000003";
  await bucket.put(key,"%PDF-1.4 SOLO QA");
  await cleanupExpiredReceipts({DB:db,PROOFS:bucket,RECEIPT_PURGE_ENABLED:"true"},future,1,1);
  await cleanupExpiredReceipts({DB:db,PROOFS:bucket,RECEIPT_PURGE_ENABLED:"true"},future,1,1);
  expect(await bucket.head(key)).toBeNull();
  expect(await bucket.head("receipts/0000000000000-ajeno-000")).not.toBeNull();
 });
});
