import { describe, expect, it, vi } from "vitest";
import { handleMinePayments, cleanupExpiredReceipts, type PaymentContext } from "./paymentRoutes";
import type { PaymentStore, StoredPaymentRequest } from "./paymentStore";
import type { Store } from "./store";

const ID="630c1629-69b1-45e8-a133-3dbdc41f4260";
const pdf=new TextEncoder().encode("%PDF-1.4\nSOLO QA");
const now=Date.now();
const original: StoredPaymentRequest={id:ID,country:null,uid:"qa-user",email:null,plan:"weekly",days:7,amountMinor:100,currency:"EUR",limits:{maxRequests:5,maxChars:1000},status:"pending",createdAt:now,decidedAt:null,receiptKey:null,receiptType:null,receiptBytes:null,receiptUploadedAt:null,receiptExpiresAt:null};
function deferred<T>() { let resolve!: (value:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return{promise,resolve}; }
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));

function fixture({latePut=false,lateAttach=false,collision=false}={}){
 const control=new AbortController(),putWait=deferred<object>(),attachWait=deferred<boolean>();
 const objects=new Set<string>();let attachedKey:string|undefined;
 const put=vi.fn(async(key:string,_bytes:unknown,options:unknown)=>{
  if(collision && typeof options==="object" && options!==null && "onlyIf" in options)return null;
  if(latePut)await putWait.promise;
  objects.add(key);return {key};
 });
 const remove=vi.fn((key:string)=>{objects.delete(key);return Promise.resolve()});
 const attach=vi.fn(async(_id:string,_uid:string,receipt:{key:string})=>{
  if(lateAttach)await attachWait.promise;
  attachedKey=receipt.key;return true;
 });
 const payments={get:()=>Promise.resolve(attachedKey?{...original,receiptKey:attachedKey,receiptType:"application/pdf",receiptBytes:pdf.length,receiptUploadedAt:now,receiptExpiresAt:now+90*86400000}:original),attachReceipt:attach} as unknown as PaymentStore;
 const background:Promise<unknown>[]=[];
 const request=new Request("https://qa.example/v1/me/payment-requests/"+ID+"/receipt",{method:"PUT",headers:{"Content-Type":"application/pdf"},body:pdf,signal:control.signal});
 const context={request,env:{PROOFS:{put,delete:remove}},context:{cors:new Headers(),started:now,event:"me",log:()=>undefined},token:{ok:true,uid:"qa-user"},store:{} as Store,payments,signal:control.signal,now,waitUntil:(p:Promise<unknown>)=>{background.push(p)},executionContext:{waitUntil:(p:Promise<unknown>)=>{background.push(p)}}} as unknown as PaymentContext;
 return{control,putWait,attachWait,put,remove,attach,objects,context,background,getAttached:()=>attachedKey};
}
describe("cancelación de comprobantes y retención sin pérdida",()=>{
 it("un put tardío tras cancelar no deja un objeto huérfano",async()=>{
  const f=fixture({latePut:true});
  const response=handleMinePayments(f.context,new URL(f.context.request.url).pathname);
  await tick();expect(f.put).toHaveBeenCalledTimes(1);f.control.abort();
  expect((await response).status).toBe(504);
  f.putWait.resolve({});await tick();
  expect(f.objects.size).toBe(0);
  expect(f.attach).not.toHaveBeenCalled();
 });
 it("un attach tardío confirmado conserva el objeto al cancelar",async()=>{
  const f=fixture({lateAttach:true});
  const response=handleMinePayments(f.context,new URL(f.context.request.url).pathname);
  await tick();expect(f.attach).toHaveBeenCalledTimes(1);f.control.abort();
  expect((await response).status).toBe(504);
  f.attachWait.resolve(true);await tick();
  expect(f.getAttached()).toBeDefined();
  const key=f.getAttached();if(key===undefined)throw Error("falta referencia confirmada");expect(f.objects.has(key)).toBe(true);
 });
 it("una colisión no sobrescribe ni vincula o borra el objeto ajeno",async()=>{
  const f=fixture({collision:true});
  const result=await handleMinePayments(f.context,new URL(f.context.request.url).pathname);
  expect(result.status).toBeGreaterThanOrEqual(400);
  expect(f.attach).not.toHaveBeenCalled();expect(f.remove).not.toHaveBeenCalled();
 });
 it("la retención borra también un objeto sin referencia D1 que supera noventa días",async()=>{
  const old=now-91*86400000,key="receipts/"+String(old)+"-630c1629-69b1-45e8-a133-3dbdc41f4260";
  const remove=vi.fn(()=>Promise.resolve());
  const statement={bind(){return this},all:()=>Promise.resolve({results:[]}),first:()=>Promise.resolve(null),run:()=>Promise.resolve({meta:{changes:0}})};
  const env={RECEIPT_PURGE_ENABLED:"true",DB:{prepare:()=>statement,batch:()=>Promise.resolve([])},PROOFS:{put:vi.fn(),delete:remove,list:()=>Promise.resolve({objects:[{key,uploaded:new Date(old),size:12}],truncated:false}),head:()=>Promise.resolve(null)}};
  await cleanupExpiredReceipts(env,now);
  expect(remove.mock.calls.some(call=>(call as unknown[])[0]===key)).toBe(true);
 });
});
