import {expect,it} from 'vitest';
import {saveRecovery,readRecovery,conversionCredential} from '../integrations/web/shop/purchase-recovery.js';
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}};
it('recovers after Stripe returns in a new tab and expires saved recovery',()=>{
 const localStorage=storage(),first={localStorage,sessionStorage:storage()};
 saveRecovery('cs_live_test',{claimSecret:'a'.repeat(43),marketingAllowed:false},first,1000);
 const returned={localStorage,sessionStorage:storage()};
 expect(readRecovery('cs_live_test',returned,2000).claimSecret).toBe('a'.repeat(43));
 expect(readRecovery('cs_live_test',returned,2000).marketingAllowed).toBe(false);
 expect(readRecovery('cs_live_test',returned,4*86400000)).toEqual({});
});
it('uses the conversion-only return credential with completely blocked storage',()=>{
 const win={get localStorage(){throw Error('blocked')},get sessionStorage(){throw Error('blocked')}};
 expect(()=>saveRecovery('cs_live_test',{},win)).not.toThrow();
 const recovered=readRecovery('cs_live_test',win);
 expect(conversionCredential(recovered,'#conversion_token='+('b'.repeat(64)))).toEqual({conversionToken:'b'.repeat(64)});
 expect(conversionCredential(recovered,'#conversion_token=bad')).toBeNull();
});
