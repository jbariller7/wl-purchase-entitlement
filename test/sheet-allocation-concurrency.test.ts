import {describe,it,expect,vi,beforeEach} from 'vitest';
const h=vi.hoisted(()=>({get:vi.fn(),update:vi.fn()}));
vi.mock('googleapis',()=>({google:{auth:{JWT:class{}},sheets:()=>({spreadsheets:{values:h}})}}));
vi.mock('../src/infrastructure/private-key.js',()=>({normalizeGoogleServiceAccountPrivateKey:()=> 'test-key'}));
import {allocateSheetKey} from '../src/legacy/sheet-allocation.js';
function db(){const docs=new Map();let tail=Promise.resolve();return {collection:()=>({doc:(id:string)=>({id})}),runTransaction:(fn:any)=>{const work=tail.then(()=>fn({get:async(r:any)=>({data:()=>docs.get(r.id)}),set:(r:any,d:any)=>docs.set(r.id,d),delete:(r:any)=>docs.delete(r.id)}));tail=work.catch(()=>{});return work;}} as any;}
beforeEach(()=>{vi.clearAllMocks();process.env.GOOGLE_SHEET_ID='test';process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL='test@example.com';process.env.GOOGLE_PRIVATE_KEY='test';});
it('serializes concurrent website/admin inventory requests and safely reuses a prior assignment',async()=>{
 const rows:any[][]=[['KEY1','','',''],['KEY2','','','']];let release:()=>void=()=>{};
 const blocked=new Promise<void>(r=>release=r);let block=true;
 h.get.mockImplementation(async({range})=>{if(range.endsWith('A2:E')){if(block){block=false;await blocked;}return {data:{values:rows.map(r=>r.slice())}};}const n=Number(range.match(/!A(\d+)/)[1]);return {data:{values:[rows[n-2]]}};});
 h.update.mockImplementation(async({range,requestBody})=>{const n=Number(range.match(/!B(\d+)/)[1]);rows[n-2]=[rows[n-2]![0],...requestBody.values[0]];return {};});
 const database=db(),input={orderId:'manual-test',email:'a@example.com',sheetTab:'Polyglot Steam'};
 const first=allocateSheetKey(database,input);await vi.waitFor(()=>expect(h.get).toHaveBeenCalled());
 await expect(allocateSheetKey(database,{...input,orderId:'website-test'})).rejects.toThrow(/busy/);release();
 expect((await first).key).toBe('KEY1');expect((await allocateSheetKey(database,input)).key).toBe('KEY1');expect(h.update).toHaveBeenCalledTimes(1);
 expect((await allocateSheetKey(database,{...input,orderId:'website-test'})).key).toBe('KEY2');
});
it('holds the lease after an uncertain write rather than exposing that row to a second allocator',async()=>{
 h.get.mockResolvedValue({data:{values:[['KEY','','','']]}});h.update.mockRejectedValue(new Error('timeout'));
 const database=db(),input={orderId:'manual-test',email:'a@example.com',sheetTab:'Polyglot Steam'};
 await expect(allocateSheetKey(database,input)).rejects.toThrow('timeout');await expect(allocateSheetKey(database,{...input,orderId:'other'})).rejects.toThrow(/busy/);
});
