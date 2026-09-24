import {expect,it} from 'vitest';
// @ts-expect-error Browser helper is plain JavaScript.
import {remainingSaleTime} from '../integrations/web/shop/sale-countdown.js';
it('counts days, hours and minutes and expires at the deadline',()=>{
 const now=Date.parse('2026-09-24T12:00:00Z');
 expect(remainingSaleTime('2026-09-26T15:04:00Z',now)).toEqual({days:2,hours:3,minutes:4,expired:false});
 expect(remainingSaleTime('2026-09-24T12:00:01Z',now)).toEqual({days:0,hours:0,minutes:1,expired:false});
 expect(remainingSaleTime('2026-09-24T12:00:00Z',now)).toEqual({days:0,hours:0,minutes:0,expired:true});
 expect(remainingSaleTime('invalid',now)).toBeNull();
});
