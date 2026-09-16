import {describe,it,expect} from 'vitest';
import handler from '../netlify/edge-functions/shop-location.js';
describe('website currency suggestion',()=>{
 for(const [country,currency] of [['FR','EUR'],['DE','EUR'],['GB','GBP'],['CA','CAD'],['CH','CHF'],['JP','JPY'],['US','USD']])it(`${country} defaults to ${currency}`,async()=>{
  const result=handler(new Request('https://example.com/shop/location.json'),{geo:{country:{code:country}}});
  expect(await result.json()).toEqual({currency});expect(result.headers.get('cache-control')).toContain('no-store');
 });
 it('handles unavailable location without returning personal information',async()=>expect(await handler(new Request('https://example.com'),{}).json()).toEqual({currency:'USD'}));
});
