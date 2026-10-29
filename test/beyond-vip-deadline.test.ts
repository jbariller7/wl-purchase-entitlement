import {afterEach, expect, it, vi} from 'vitest';
import {lambdaHandler} from '../netlify/functions/beyond-vip.js';
afterEach(()=>vi.useRealTimers());
it.each(['2026-11-09T07:00:00Z','2026-11-10T12:00:00Z'])('closes new bookings at and after the Paris cutoff (%s)',async date=>{
 vi.useFakeTimers();vi.setSystemTime(new Date(date));
 const result=await lambdaHandler({httpMethod:'GET',queryStringParameters:{tier:'adventurer'},headers:{}} as any,{} as any,()=>{});
 expect(result).toMatchObject({statusCode:303,headers:{location:'/beyondmockup/#vip-countdown'}});
});
it('still validates new bookings immediately before the cutoff',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-09T06:59:59Z'));
 const result=await lambdaHandler({httpMethod:'GET',queryStringParameters:{tier:'invalid'},headers:{}} as any,{} as any,()=>{});
 expect(result).toMatchObject({statusCode:303,headers:{location:'/beyondmockup/checkout-error.html?code=400'}});
});
