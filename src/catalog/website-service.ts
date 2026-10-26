import type {Firestore} from 'firebase-admin/firestore';
import type Stripe from 'stripe';
import defaults from '../../catalog/website-prices.json' with {type:'json'};
import {websitePriceId,websiteStripeClient} from '../providers/stripe/website-config.js';
import {stripeMinorAmount,stripeMajorAmount} from '../domain/regional-pricing.js';
import {HttpError} from '../http/auth.js';

export const desktopKinds=['single','polyglot','premium'] as const;
export type DesktopKind=typeof desktopKinds[number];
export function assertDesktopKind(kind:string): asserts kind is DesktopKind {
 if(!desktopKinds.includes(kind as DesktopKind))throw new HttpError(400,'Mobile prices remain managed in Google Play and App Store Connect. Choose a desktop website product.');
}
export type WebsitePriceTable=Record<string,string[]>;
export interface WebsitePriceChange {unitAmount?:number;currency?:string;percentChange?:number;}
export function proposedWebsitePrices(prices:WebsitePriceTable,kind:DesktopKind,change:WebsitePriceChange){
 assertDesktopKind(kind);
 const regional=Object.fromEntries(Object.entries(prices).map(([code,values])=>[code,values[desktopKinds.indexOf(kind)]!]));
 if(change.percentChange!==undefined){
  const p=change.percentChange;
  if(change.unitAmount!==undefined||change.currency!==undefined||!Number.isFinite(p)||p===0||p<=-100||p>1000||Math.abs(p*100-Math.round(p*100))>0.000001)throw new HttpError(400,'Enter a nonzero percentage above -100 and up to 1000, with at most two decimal places.');
  for(const [currency,amount] of Object.entries(regional)){
   const increment=currency==='KWD'?10:1;
   const value=Math.round(stripeMinorAmount(currency,amount)*(10000+Math.round(p*100))/10000/increment)*increment;
   if(value<1||value>100_000_000)throw new HttpError(400,`The resulting ${currency} price is out of range.`);
   regional[currency]=stripeMajorAmount(currency,value);
  }
 }else{
  const currency=change.currency?.toUpperCase()??'',value=change.unitAmount;
  if(!Object.hasOwn(prices,currency)||!Number.isSafeInteger(value)||value!<1||value!>100_000_000)throw new HttpError(400,'Invalid website price or currency.');
  if(currency==='KWD'&&value!%10!==0)throw new HttpError(400,'Enter KWD prices in increments of 0.01.');
  regional[currency]=stripeMajorAmount(currency,value!);
 }
 return regional;
}
export class WebsiteCatalogService {
 constructor(private db:Firestore,private client?:Stripe){}
 private ref(){return this.db.collection('configuration').doc('websiteCatalog');}
 async get(){
  const snap=await this.ref().get(),stored=snap.data();
  const prices=structuredClone(defaults) as WebsitePriceTable;
  const priceIds=Object.fromEntries(desktopKinds.map(k=>[k,websitePriceId(k)])) as Record<DesktopKind,string>;
  for(const kind of desktopKinds){
   const saved=stored?.offers?.[kind];if(!saved)continue;
   if(!/^price_/.test(saved.stripePriceId))throw new Error('Invalid website price configuration.');
   priceIds[kind]=saved.stripePriceId;
   for(const currency of Object.keys(prices)){
    const amount=saved.regionalPrices?.[currency];
    if(typeof amount!=='string'||!/^\d+(\.\d{1,3})?$/.test(amount)||stripeMinorAmount(currency,amount)<1)throw new Error('Invalid website regional price configuration.');
    prices[currency]![desktopKinds.indexOf(kind)]=amount;
   }
  }
  return {revision:Number(stored?.revision??0),prices,priceIds};
 }
 async status(){
  const c=await this.get();
  const offers=Object.fromEntries(desktopKinds.map((k,i)=>[k,{stripePriceId:c.priceIds[k],unitAmount:stripeMinorAmount('USD',c.prices.USD![i]!),currency:'USD',recurring:false}])) as Record<DesktopKind,{stripePriceId:string;unitAmount:number;currency:string;recurring:boolean}>;
  return {revision:c.revision,regionalPrices:Object.fromEntries(desktopKinds.map((k,i)=>[k,Object.fromEntries(Object.entries(c.prices).map(([code,amounts])=>[code,amounts[i]!]))])) as Record<DesktopKind,Record<string,string>>,...offers};
 }
 async changePrice(input:WebsitePriceChange&{kind:DesktopKind;expectedRevision:number;actorUid:string;now:Date}){
  assertDesktopKind(input.kind);
  const current=await this.get();
  const regional=proposedWebsitePrices(current.prices,input.kind,input);
  if(current.revision!==input.expectedRevision)throw new HttpError(409,'Prices changed since preview. Refresh and preview again.');
  const client=this.client??websiteStripeClient();
  const old=await client.prices.retrieve(current.priceIds[input.kind]);
  if(!old.active||!old.livemode||old.type!=='one_time')throw new Error('Expected an active live one-time website price.');
  const created=await client.prices.create({product:typeof old.product==='string'?old.product:old.product.id,currency:'usd',unit_amount:stripeMinorAmount('USD',regional.USD!),tax_behavior:'inclusive',
   currency_options:Object.fromEntries(Object.entries(regional).filter(([code])=>code!=='USD').map(([code,amount])=>[code.toLowerCase(),{unit_amount:stripeMinorAmount(code,amount),tax_behavior:'inclusive' as const}])),
   metadata:{wl_website_offer:input.kind,wl_catalog_revision:String(current.revision+1),wl_changed_by:input.actorUid}},
   {idempotencyKey:`website-price:${input.expectedRevision}:${input.kind}:${input.currency??'all'}:${input.percentChange??input.unitAmount}`});
  // Keep old prices for open checkouts and historical payments. Concurrent losers
  // may share Stripe's idempotency key, so never deactivate the created price here.
  await this.db.runTransaction(async tx=>{
   const fresh=await tx.get(this.ref());
   if(Number(fresh.data()?.revision??0)!==input.expectedRevision)throw new HttpError(409,'Another price change won. Refresh before trying again.');
   tx.set(this.ref(),{revision:current.revision+1,offers:{...(fresh.data()?.offers??{}),[input.kind]:{stripePriceId:created.id,regionalPrices:regional}},updatedAt:input.now.toISOString(),updatedBy:input.actorUid});
  });
  return this.status();
 }
}
