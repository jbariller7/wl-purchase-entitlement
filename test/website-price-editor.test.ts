import {describe,it,expect,vi} from 'vitest';
import {WebsiteCatalogService,proposedWebsitePrices,desktopKinds} from '../src/catalog/website-service.js';
import {assertWebsitePrice} from '../src/providers/stripe/website-session.js';
import defaults from '../catalog/website-prices.json' with {type:'json'};
import {stripeMinorAmount} from '../src/domain/regional-pricing.js';

function fixture(){
 let data:any;
 const ref={get:async()=>({exists:!!data,data:()=>data})};
 const db:any={collection:()=>({doc:()=>ref}),runTransaction:async(fn:any)=>fn({get:()=>ref.get(),set:(_ref:any,next:any)=>{data=next}})};
 const stripe:any={prices:{retrieve:vi.fn(async()=>({active:true,livemode:true,type:'one_time',product:'prod_desktop'})),create:vi.fn(async()=>({id:'price_new'})),update:vi.fn()}};
 return {service:new WebsiteCatalogService(db,stripe),stripe,getData:()=>data,setData:(v:any)=>{data=v}};
}
describe('live website price editor',()=>{
 it('rounds percentages for decimal and zero-decimal currencies without changing other products',()=>{
  const table={USD:['19.99','31.99','59.99'],JPY:['1999','3999','7999']};
  expect(proposedWebsitePrices(table,'single',{percentChange:-10})).toEqual({USD:'17.99',JPY:'1799'});
  expect(proposedWebsitePrices(table,'premium',{percentChange:12.5})).toEqual({USD:'67.49',JPY:'8999'});
  expect(table.USD).toEqual(['19.99','31.99','59.99']);
  expect(proposedWebsitePrices({KWD:['3.40','5.20','9.75']},'premium',{percentChange:5})).toEqual({KWD:'10.240'});
 });
 it('rejects invalid percentage combinations, unsupported currencies, zero prices and mobile products',()=>{
  for(const percentChange of [-100,0,Infinity,1001,1.234])expect(()=>proposedWebsitePrices(defaults,'single',{percentChange})).toThrow();
  expect(()=>proposedWebsitePrices(defaults,'single',{percentChange:10,currency:'USD'})).toThrow();
  expect(()=>proposedWebsitePrices(defaults,'single',{currency:'XXX',unitAmount:100})).toThrow();
  expect(()=>proposedWebsitePrices(defaults,'monthly' as any,{percentChange:10})).toThrow();
  expect(()=>proposedWebsitePrices({USD:['0.01','1','1']},'single',{percentChange:-99})).toThrow();
 });
 it.each(desktopKinds)('changes all currencies of %s atomically using the same Stripe product',async kind=>{
  const f=fixture(),before=await f.service.get();
  const result=await f.service.changePrice({kind,percentChange:-10,expectedRevision:0,actorUid:'admin',now:new Date()});
  expect(result.revision).toBe(1);
  const created=f.stripe.prices.create.mock.calls[0][0];
  expect(created).toMatchObject({product:'prod_desktop',currency:'usd',tax_behavior:'inclusive'});
  for(const [currency,amount] of Object.entries(result.regionalPrices[kind])){
   const stripeAmount=currency==='USD'?created.unit_amount:created.currency_options[currency.toLowerCase()].unit_amount;
   expect(stripeAmount).toBe(stripeMinorAmount(currency,amount));
  }
  const after=await f.service.get();
  for(const other of desktopKinds.filter(k=>k!==kind))expect(after.priceIds[other]).toBe(before.priceIds[other]);
  expect(Object.keys(f.getData().offers)).toEqual([kind]);
  expect(f.stripe.prices.update).not.toHaveBeenCalled();
 });
 it('preserves unedited currencies and rejects stale previews before contacting Stripe',async()=>{
  const f=fixture();await f.service.changePrice({kind:'polyglot',currency:'EUR',unitAmount:4200,expectedRevision:0,actorUid:'admin',now:new Date()});
  const catalog=await f.service.get();
  expect(catalog.prices.EUR![1]).toBe('42.00');expect(catalog.prices.USD).toEqual(defaults.USD);
  f.stripe.prices.create.mockClear();
  await expect(f.service.changePrice({kind:'single',percentChange:10,expectedRevision:0,actorUid:'admin',now:new Date()})).rejects.toThrow('changed since preview');
  expect(f.stripe.prices.create).not.toHaveBeenCalled();
 });
 it('validates checkout against current desktop prices while preserving mobile validation',()=>{
  const table=structuredClone(defaults);table.USD[1]='42.00';
  const request:any={offer:'polyglot',currency:'USD'};
  const price:any={active:true,livemode:true,type:'one_time',currency_options:{usd:{unit_amount:4200,tax_behavior:'inclusive'}}};
  expect(()=>assertWebsitePrice(price,request,true,table)).not.toThrow();
  expect(()=>assertWebsitePrice(price,{...request,offer:'mobile_permanent'},true,table)).toThrow();
 });
});
