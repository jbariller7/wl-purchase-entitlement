import assert from 'node:assert/strict';
import {REGIONAL_PRICES,stripeMinorAmount} from '../src/domain/regional-pricing.js';
import {assertWebsitePrice} from '../src/providers/stripe/website-session.js';
import registry from '../catalog/website-runtime-prices.live.json' with {type:'json'};

function flatten(value:Record<string,unknown>,prefix='',out:Record<string,string>={}){
 for(const [key,item] of Object.entries(value)){
  const name=prefix?`${prefix}[${key}]`:key;
  if(item!==null&&typeof item==='object')flatten(item as Record<string,unknown>,name,out);
  else out[name]=String(item);
 }
 return out;
}
async function stripe(path:string,method='GET',params:Record<string,unknown>={},idempotencyKey?:string):Promise<any>{
 const r=await fetch('http://127.0.0.1:8779/stripe',{method:'POST',headers:{'Content-Type':'application/json','X-Wonderlang-Setup':'1'},body:JSON.stringify({path,method,params:flatten(params),idempotencyKey})});
 const data=await r.json();if(!r.ok)throw new Error(`Catalog request failed: ${r.status} ${data.error?.code??''}`);return data;
}
const old=await stripe('/payment_links/plink_1RqaPCBFbQoDa6p02qTNNcfs');
assert.equal(old.livemode,true);assert.equal(old.url,'https://buy.stripe.com/3cI14meCD3n29DC4Fxdby0Z');
const result:Record<string,string>={};
for(const [offer,priceId] of Object.entries(registry.prices).filter(([offer])=>['single','polyglot','premium'].includes(offer))){
 const price=await stripe(`/prices/${priceId}`,'GET',{expand:['currency_options']});
 for(const currency of Object.keys(REGIONAL_PRICES.polyglot))assertWebsitePrice(price,{offer:offer as 'single'|'polyglot'|'premium',locale:'en',currency,requestId:'550e8400-e29b-41d4-a716-446655440000',delivery:'steam'},true);
 result[offer]=priceId;
}
for(const offer of ['mobile_monthly','mobile_permanent'] as const){
 const monthly=offer==='mobile_monthly',lookup=`wonderlang-website-v3-${offer}-20260916`;
 const existing=await stripe('/prices','GET',{lookup_keys:[lookup],limit:2});
 assert(existing.data.length<=1);
 let price=existing.data[0];
 if(!price){
  if(!process.argv.includes('--create-live'))throw new Error(`${offer}: missing; rerun with --create-live to provision the approved offer.`);
  const product=await stripe('/products','POST',{
   name:monthly?'WonderLang Mobile Monthly':'WonderLang Mobile Permanent Access',
   description:monthly?'Full mobile game on your selected Android or iOS platform. Monthly subscription with a 3-day free trial. Cloud saves are not included.':'Full mobile game, all languages, permanently on your selected Android or iOS platform. Cloud saves are not included.',
   tax_code:'txcd_10201001',metadata:{wl_website_offer:offer,wl_catalog_version:'website-v3-20260916'}
  },`${lookup}-product`);
  const amounts=monthly?REGIONAL_PRICES.monthly:REGIONAL_PRICES.polyglot;
  price=await stripe('/prices','POST',{
   product:product.id,currency:'usd',unit_amount:stripeMinorAmount('USD',amounts.USD!),tax_behavior:'inclusive',lookup_key:lookup,
   currency_options:Object.fromEntries(Object.entries(amounts).filter(([c])=>c!=='USD').map(([c,v])=>[c.toLowerCase(),{unit_amount:stripeMinorAmount(c,v),tax_behavior:'inclusive'}])),
   ...(monthly?{recurring:{interval:'month',interval_count:1}}:{}),metadata:{wl_website_offer:offer}
  },`${lookup}-price`);
 }
 price=await stripe(`/prices/${price.id}`,'GET',{expand:['currency_options']});
 for(const currency of Object.keys(REGIONAL_PRICES.polyglot))assertWebsitePrice(price,{offer,locale:'en',currency,mobilePlatform:'android',requestId:'550e8400-e29b-41d4-a716-446655440000'},true);
 result[offer]=price.id;
}
console.log(JSON.stringify({stripeAccount:'acct_1OWG2XBFbQoDa6p0',livemode:true,verifiedAt:new Date().toISOString(),currencyCount:37,prices:result},null,2));
