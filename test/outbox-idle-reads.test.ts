import {it,expect,vi} from 'vitest';
import {EntitlementStore} from '../src/infrastructure/entitlement-store.js';
it('skips future and actively leased jobs before transactions but rechecks due jobs atomically',async()=>{
 const now=new Date('2026-10-23T10:00:00Z');
 const docs=[
  {state:'pending',notBefore:'2026-10-23T11:00:00Z'},
  {state:'processing',notBefore:'2026-10-23T09:00:00Z',leaseExpiresAt:'2026-10-23T10:01:00Z'},
  {state:'pending',notBefore:'2026-10-23T09:00:00Z',id:'due',kind:'meta_conversion',attemptCount:0}
 ].map(data=>({ref:{},data:()=>data}));
 const update=vi.fn();
 const db={collection:()=>({where:()=>({limit:()=>({get:async()=>({docs})})})}),
 runTransaction:vi.fn(async fn=>fn({get:async()=>({exists:true,data:docs[2]!.data}),update}))};
 const jobs=await new EntitlementStore(db as any).leaseOutboxJobs('worker',now);
 expect(db.runTransaction).toHaveBeenCalledTimes(1);expect(update).toHaveBeenCalledTimes(1);
 expect(jobs.map(j=>j.id)).toEqual(['due']);
});
