import type Stripe from "stripe";
import { z } from "zod";
import locales from "../../../catalog/website-checkout-locales.json" with { type: "json" };
import prices from "../../../catalog/website-prices.json" with { type: "json" };
import mobileText from "../../../catalog/website-mobile-locales.json" with { type: "json" };
import { stripeMinorAmount } from "../../domain/regional-pricing.js";
import { REGIONAL_PRICES } from "../../domain/regional-pricing.js";

export const websiteSessionSchema = z.object({
  offer: z.enum(["single", "polyglot", "premium", "mobile_monthly", "mobile_permanent"]),
  locale: z.string().refine(x => Object.hasOwn(locales, x)),
  currency: z.string().refine(x => Object.hasOwn(prices, x)),
  requestId: z.string().uuid(),
  campaignId: z.string().uuid().optional(),
  attribution: z.object({
    gaClientId: z.string().regex(/^\d+\.\d+$/).max(100).optional(),
    fbp: z.string().max(255).optional(),
    fbc: z.string().max(255).optional(),
    ttclid: z.string().max(255).optional(),
    ttp: z.string().max(255).optional()
  }).strict().optional(),
  delivery: z.enum(["steam", "direct"]).optional(),
  learningLanguage: z.enum(["french","spanish","german","italian","portuguese","korean","japanese","mandarin","english"]).optional(),
  mobilePlatform: z.enum(["android", "ios", "later"]).optional()
}).strict().superRefine((r,ctx)=>{
  const issue=(message:string)=>ctx.addIssue({code:"custom",message});
  if(["single","polyglot","premium"].includes(r.offer) && !r.delivery)issue("Select Steam or direct download.");
  if(r.offer==="single" && !r.learningLanguage)issue("Select the learning language.");
  if(r.offer.startsWith("mobile_") && (!r.mobilePlatform || r.mobilePlatform==="later"))issue("Select Android or iOS.");
  if(r.offer!=="single" && r.learningLanguage)issue("Unexpected learning-language choice.");
  if(r.offer.startsWith("mobile_") && r.delivery)issue("Mobile-only access does not include PC/Mac delivery.");
  if(["single","polyglot"].includes(r.offer) && r.mobilePlatform)issue("Desktop-only access does not include mobile access.");
});
export type WebsiteSessionRequest = z.infer<typeof websiteSessionSchema>;
export function websiteAttribution(request: WebsiteSessionRequest): Record<string,string> {
  return Object.fromEntries(Object.entries(request.attribution??{}).filter((entry): entry is [string,string] => typeof entry[1]==='string' && entry[1].length>0));
}
const languageValues=["french","spanish","german","italian","portuguese","korean","japanese","mandarin","english"];
export function websiteSessionParams(request: WebsiteSessionRequest, priceId: string, origin: string): Stripe.Checkout.SessionCreateParams {
  const l=locales[request.locale as keyof typeof locales];
  if (!l || !/^price_/.test(priceId)) throw new Error("Invalid website checkout configuration.");
  const monthly=request.offer==="mobile_monthly";
  const metadata={wl_checkout_flow:"website-session-v1",wl_ads_owner:"entitlement-v2",wl_website_offer:request.offer,wl_locale:request.locale,
    wl_desktop_delivery:request.delivery??"",wl_learning_language:request.learningLanguage??"",wl_mobile_platform:request.mobilePlatform??"later",
    ...websiteAttribution(request)};
  const m=mobileText[request.locale as keyof typeof mobileText];
  const summary=request.offer==="mobile_monthly" ? `${m[2]} ${m[7]}` : request.offer==="mobile_permanent" ? m[3] : l[`${request.offer as "single"|"polyglot"|"premium"}Description`];
  // Render the same allowlisted selections carried in metadata; no extra questions.
  const selections:string[]=[];
  if(request.delivery)selections.push(`${l.delivery}: ${l[request.delivery]}`);
  if(request.offer==="single" && request.learningLanguage)selections.push(`${l.language}: ${l.languages[languageValues.indexOf(request.learningLanguage)]}`);
  if(request.offer.startsWith("mobile_")){
    const platform=request.mobilePlatform??"later";
    selections.push(`${m[4]}: ${platform==="ios"?"iOS":"Android"}`);
  }
  const checkoutText=[...selections,summary].filter(Boolean).join("\n\n");
  return {
    mode:monthly?"subscription":"payment",line_items:[{price:priceId,quantity:1}],currency:request.currency.toLowerCase(),
    locale:l.stripeLocale as Stripe.Checkout.SessionCreateParams.Locale,
    custom_text:{submit:{message:checkoutText}},
    ...(monthly?{subscription_data:{trial_period_days:3,metadata:{...metadata,wl_product:"mobile_full_monthly"}},payment_method_collection:"always" as const}:{}),
    ...(!monthly?{payment_intent_data:{metadata}}:{}),
    automatic_tax:{enabled:true},allow_promotion_codes:true,
    success_url:`${origin}/shop/complete/?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:`${origin}/shop/?lang=${encodeURIComponent(request.locale)}&currency=${request.currency}`,
    metadata
  };
}
export function assertWebsitePrice(price: Stripe.Price, request: WebsiteSessionRequest, live: boolean): void {
  const index=["single","polyglot","premium"].indexOf(request.offer);
  const expected=request.offer==="mobile_monthly"?REGIONAL_PRICES.monthly[request.currency]!:request.offer==="mobile_permanent"?REGIONAL_PRICES.polyglot[request.currency]!:prices[request.currency as keyof typeof prices][index]!;
  const option=price.currency_options?.[request.currency.toLowerCase()];
  const monthly=request.offer==="mobile_monthly";
  if(!price.active || price.livemode!==live || price.type!==(monthly?"recurring":"one_time") || (monthly && (price.recurring?.interval!=="month" || price.recurring.interval_count!==1)) || !option || option.tax_behavior!=="inclusive" || option.unit_amount!==stripeMinorAmount(request.currency,expected))throw new Error("Configured Stripe price does not match the approved website offer.");
}
