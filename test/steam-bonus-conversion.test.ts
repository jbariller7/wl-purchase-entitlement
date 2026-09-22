import {expect,it} from 'vitest';
import {recordSteamBonus} from '../src/ads/steam-bonus.js';
function database(){
 const documents=new Map<string,any>();
 const db={collection:(name:string)=>({doc:(id:string)=>({id,path:name+'/'+id})}),
  runTransaction:async(fn:any)=>fn({get:async(ref:any)=>({exists:documents.has(ref.path),data:()=>documents.get(ref.path)}),
   create:(ref:any,value:any)=>{if(documents.has(ref.path))throw new Error('duplicate create');documents.set(ref.path,value);}})};
 return {db:db as any,documents};
}
it('queues one zero-value Steam proxy and returns the same browser ID on response-lost retries',async()=>{
 const {db,documents}=database(),now=new Date('2026-09-22T12:00:00Z');
 const input={emailSha256:'a'.repeat(64),ipAddress:'192.0.2.1',userAgent:'NW.js'};
 const first=await recordSteamBonus(db,input,now);
 expect(first).toEqual({eventId:'steam-bonus-v1:'+input.emailSha256,trackBrowser:true});
 expect(await recordSteamBonus(db,input,new Date(+now+60000))).toEqual(first);
 expect(documents.size).toBe(2);
 const job=[...documents.values()].find(x=>x.kind==='meta_conversion');
 expect(job.payload).toMatchObject({eventName:'Purchase',eventId:first.eventId,value:0,conversionKind:'steam_pdf_proxy',emailSha256:input.emailSha256,userAgent:'NW.js'});
 expect(JSON.stringify(job)).not.toContain('@');
});
it('suppresses repeat claims beyond the browser/server dedup window, including another installation',async()=>{
 const {db,documents}=database(),now=new Date('2026-09-22T12:00:00Z');
 const input={emailSha256:'b'.repeat(64)};
 await recordSteamBonus(db,input,now);
 expect((await recordSteamBonus(db,input,new Date(+now+3*86400000))).trackBrowser).toBe(false);
 expect(documents.size).toBe(2);
});
