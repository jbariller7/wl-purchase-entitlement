import type Stripe from "stripe";
import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import locales from "../../../catalog/website-checkout-locales.json" with { type: "json" };
import prices from "../../../catalog/website-prices.json" with { type: "json" };
import { HttpError } from "../../http/auth.js";
import { recordAdminAudit, type AdminActor } from "../../admin/audit.js";
import { websiteStripeClient, websiteStripeConfiguration, websitePriceId } from "./website-config.js";
import type { WebsiteSessionRequest } from "./website-session.js";

export const discountOffers = { single: "Single language · PC/Mac", polyglot: "Polyglot · PC/Mac", premium: "Premium Lifetime Pass", mobile_monthly: "Mobile Monthly", mobile_permanent: "Mobile Permanent" };
export const discountLinkSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(40),
  offer: z.enum(["single", "polyglot", "premium", "mobile_monthly", "mobile_permanent"]),
  percentOff: z.number().int().min(1).max(100),
  locale: z.string().refine(s => Object.hasOwn(locales,s)), currency: z.string().refine(s => Object.hasOwn(prices,s)),
  delivery: z.enum(["steam", "direct"]).optional(),
  learningLanguage: z.enum(["french","spanish","german","italian","portuguese","korean","japanese","mandarin","english"]).optional(),
  mobilePlatform: z.enum(["android", "ios"]).optional(),
  duration: z.enum(["once", "forever", "repeating"]).default("once"), durationMonths: z.number().int().min(1).max(36).optional(),
  expiresAt: z.string().datetime().nullable().default(null)
}).strict().superRefine((v,c) => {
  const invalid=(message:string)=>c.addIssue({code:"custom",message});
  if(v.mobilePlatform==='ios') invalid('iOS purchases are not available yet.');
  if(v.offer!=="mobile_monthly" && v.duration!=="once") invalid("Recurring discounts require Mobile Monthly.");
  if(v.duration==="repeating" && !v.durationMonths) invalid("Enter the number of discounted months.");
  if(v.duration!=="repeating" && v.durationMonths) invalid("Months apply only to repeating discounts.");
  if(v.offer!=="single" && v.learningLanguage) invalid("Learning language applies only to the single-language edition.");
  if(v.offer.startsWith("mobile_") && v.delivery) invalid("Mobile offers do not include desktop delivery.");
  if(!v.offer.startsWith("mobile_") && v.mobilePlatform) invalid("Choose a mobile platform only for mobile offers.");
});
export type DiscountInput = z.infer<typeof discountLinkSchema>;
export type DiscountLink = DiscountInput & { active: boolean; ready: boolean; couponId: string; createdAt: string; updatedAt: string };
export function assertDiscountAvailable(link: DiscountLink, now: Date, request?: WebsiteSessionRequest): void {
  if(link.offer.startsWith('mobile_') && link.mobilePlatform==='ios') throw new HttpError(410,"This offer is no longer available.");
  if(!link.ready || !link.active || (link.expiresAt && Date.parse(link.expiresAt)<=now.getTime())) throw new HttpError(410,"This offer is no longer available.");
  if(request && (request.offer!==link.offer || (["delivery","learningLanguage","mobilePlatform"] as const).some(k=>link[k] && link[k]!==request[k]))) throw new HttpError(400,"This checkout does not match the discount link.");
}
export function applyDiscountToSession(parameters: Stripe.Checkout.SessionCreateParams, link: DiscountLink, origin: string, now: Date) {
  delete parameters.allow_promotion_codes;
  parameters.discounts=[{coupon:link.couponId}];
  parameters.metadata={...parameters.metadata,wl_discount_link:link.id,wl_discount_name:link.name};
  if(parameters.subscription_data) parameters.subscription_data.metadata={...parameters.subscription_data.metadata,wl_discount_link:link.id};
  if(parameters.payment_intent_data) parameters.payment_intent_data.metadata={...parameters.payment_intent_data.metadata,wl_discount_link:link.id};
  const submit=parameters.custom_text?.submit;
  parameters.custom_text={...parameters.custom_text,submit:{message:`${link.name} · −${link.percentOff}%\n\n${submit && typeof submit==="object"?submit.message:""}`}};
  parameters.cancel_url=`${origin}/shop/?campaign=${encodeURIComponent(link.id)}`;
  // Stripe requires at least 30 minutes. A scheduled worker closes sessions
  // crossing a campaign deadline sooner; completed purchases are always honored.
  const minimum=Math.floor(now.getTime()/1000)+1800;
  parameters.expires_at=link.expiresAt ? Math.max(minimum,Math.min(Math.floor(Date.parse(link.expiresAt)/1000),minimum+1800)) : minimum+1800;
}

export class DiscountLinks {
  constructor(private db: Firestore, private stripe: Stripe = websiteStripeClient(), private origin = websiteStripeConfiguration().origin) {}
  private ref(id: string) { if(!z.string().uuid().safeParse(id).success) throw new HttpError(400,"Invalid discount link."); return this.db.collection("websiteDiscountLinks").doc(id); }
  async get(id:string): Promise<DiscountLink> { const snap=await this.ref(id).get(); if(!snap.exists) throw new HttpError(404,"Discount link not found."); return snap.data() as DiscountLink; }
  url(link:DiscountLink) { return `${this.origin}/shop/?campaign=${link.id}&lang=${encodeURIComponent(link.locale)}&currency=${link.currency}`; }
  async list() {
    const snapshot=await this.db.collection("websiteDiscountLinks").orderBy("createdAt","desc").limit(250).get();
    return {links:snapshot.docs.map(doc=>{const link=doc.data() as DiscountLink; return {...link,url:this.url(link)};}), offers:discountOffers,locales:Object.keys(locales),currencies:Object.keys(prices)};
  }
  async create(input:DiscountInput,actor:AdminActor,now:Date) {
    if(input.expiresAt && (Date.parse(input.expiresAt)<=now.getTime() || Date.parse(input.expiresAt)>now.getTime()+5*365*86400000)) throw new HttpError(400,"Expiry must be in the future and within five years.");
    const ref=this.ref(input.id);
    await this.db.runTransaction(async tx=>{
      const old=await tx.get(ref);
      if(old.exists){ const saved=old.data() as DiscountLink; for(const key of Object.keys(input) as Array<keyof DiscountInput>) if(saved[key]!==input[key]) throw new HttpError(409,"This link was already created with different settings."); return; }
      tx.create(ref,{...input,active:false,ready:false,couponId:`wl_campaign_${input.id}`,createdAt:now.toISOString(),updatedAt:now.toISOString()});
    });
    return this.provision(input.id,actor,now);
  }
  async provision(id:string,actor:AdminActor,now:Date) {
    const link=await this.get(id); if(link.ready) return {...link,url:this.url(link)};
    if(link.expiresAt && Date.parse(link.expiresAt)<=now.getTime()) throw new HttpError(400,"This campaign has already expired. Create a new one.");
    const price=await this.stripe.prices.retrieve(websitePriceId(link.offer));
    if(!price.active || !price.livemode) throw new HttpError(409,"The website price is not active in live mode.");
    const product=typeof price.product==="string"?price.product:price.product.id;
    try {
      await this.stripe.coupons.create({id:link.couponId,name:link.name,percent_off:link.percentOff,duration:link.duration,
        ...(link.duration==="repeating"?{duration_in_months:link.durationMonths!}:{}),
        ...(link.expiresAt?{redeem_by:Math.floor(Date.parse(link.expiresAt)/1000)}:{}),
        applies_to:{products:[product]},metadata:{wl_discount_link:id}
      },{idempotencyKey:`wl-discount-link:${id}`});
    } catch(error) {
      // Recover a successful Stripe creation followed by an interrupted database write.
      const existing=await this.stripe.coupons.retrieve(link.couponId).catch(()=>null);
      if(!existing || !existing.valid || existing.metadata?.wl_discount_link!==id || existing.percent_off!==link.percentOff || existing.duration!==link.duration) throw error;
    }
    const provisioned=await this.db.runTransaction(async tx=>{
      const ref=this.ref(id),fresh=await tx.get(ref);
      if(fresh.data()?.ready) return false;
      tx.update(ref,{ready:true,active:true,updatedAt:now.toISOString()});
      return true;
    });
    if(provisioned) await recordAdminAudit({db:this.db,actor,action:"discount-link.create",targetType:"discount-link",targetId:id,summary:`Created ${link.name}: ${link.percentOff}% off ${link.offer}`,now});
    return {...await this.get(id),url:this.url(link)};
  }
  async setActive(id:string,active:boolean,actor:AdminActor,now:Date) {
    const link=await this.get(id);
    if(!link.ready) throw new HttpError(409,"Finish setting up this link first.");
    if(active && link.expiresAt && Date.parse(link.expiresAt)<=now.getTime()) throw new HttpError(400,"Expired links cannot be reactivated. Create a new link.");
    await this.ref(id).update({active,updatedAt:now.toISOString()});
    await recordAdminAudit({db:this.db,actor,action:active?"discount-link.activate":"discount-link.deactivate",targetType:"discount-link",targetId:id,summary:`${active?"Activated":"Deactivated"} ${link.name}`,now});
    if(!active) {
      const sessions=await this.db.collection("websiteDiscountSessions").where("campaignId","==",id).get();
      // Queue all outstanding sessions before attempting Stripe, so failures retry.
      for(const session of sessions.docs) await session.ref.update({closeAfter:now.toISOString()});
      await this.closeDueSessions(now);
    }
    return {id,active};
  }
  async registerSession(link:DiscountLink,session:Stripe.Checkout.Session,now:Date) {
    await this.db.collection("websiteDiscountSessions").doc(session.id).set({campaignId:link.id,closeAfter:new Date(Math.min(session.expires_at*1000,link.expiresAt?Date.parse(link.expiresAt):Infinity)).toISOString()});
    try { assertDiscountAvailable(await this.get(link.id),now); }
    catch(error) {
      const ref=this.db.collection("websiteDiscountSessions").doc(session.id);
      await ref.update({closeAfter:now.toISOString()});
      if(session.status==="open") await this.stripe.checkout.sessions.expire(session.id);
      await ref.delete(); throw error;
    }
  }
  async closeDueSessions(now:Date) {
    const due=await this.db.collection("websiteDiscountSessions").where("closeAfter","<=",now.toISOString()).limit(100).get();
    let closed=0;
    for(const doc of due.docs) {
      try { const session=await this.stripe.checkout.sessions.retrieve(doc.id); if(session.status==="open") await this.stripe.checkout.sessions.expire(doc.id); await doc.ref.delete(); closed++; }
      catch { /* Keep the row for the next scheduled retry. */ }
    }
    return {scanned:due.size,closed};
  }
}
