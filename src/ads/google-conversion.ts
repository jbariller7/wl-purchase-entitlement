import {z} from "zod";
import {sha256} from "../infrastructure/ids.js";

const schema = z.object({
  eventId:z.string().min(1).max(100), eventTime:z.number().int().positive(),
  value:z.number().positive(), currency:z.string().regex(/^[A-Z]{3}$/),
  product:z.string().min(1).max(100), clientId:z.string().max(100).optional()
});

export function googlePurchaseBody(raw:Record<string,unknown>) {
  const event=schema.parse(raw);
  return {
    client_id:event.clientId || sha256(`google-purchase:${event.eventId}`),
    timestamp_micros:event.eventTime*1_000_000,
    // Existing Analytics clients inherit their recorded consent. Anonymous
    // fallback identifiers must never imply advertising consent.
    ...(!event.clientId ? {consent:{ad_user_data:"DENIED",ad_personalization:"DENIED"}} : {}),
    events:[{name:"purchase",params:{transaction_id:event.eventId,value:event.value,
      currency:event.currency,purchase_origin:"subscription_first_payment",
      items:[{item_id:event.product,quantity:1,price:event.value}]}}]
  };
}

export async function sendGoogleConversion(raw:Record<string,unknown>):Promise<void> {
  const measurementId=process.env.GA4_MEASUREMENT_ID;
  const secret=process.env.GA4_API_SECRET;
  if(!measurementId || !/^G-[A-Z0-9]+$/.test(measurementId) || !secret) throw new Error("Google server measurement is not configured.");
  const body=googlePurchaseBody(raw);
  // Do not silently move old payments to today or Google's 72-hour cutoff.
  if(Date.now()-body.timestamp_micros/1000>72*3600_000) throw new Error("Google conversion exceeds the 72-hour delivery window.");
  const query=new URLSearchParams({measurement_id:measurementId,api_secret:secret});
  // Google's collection endpoint accepts malformed events with HTTP 2xx.
  const validation=await fetch(`https://region1.google-analytics.com/debug/mp/collect?${query}`,{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({...body,validation_behavior:"ENFORCE_RECOMMENDATIONS"}),signal:AbortSignal.timeout(15000)
  });
  if(!validation.ok)throw new Error(`Google event validation unavailable (${validation.status}).`);
  const result=await validation.json() as {validationMessages?:unknown[]};
  if(!Array.isArray(result.validationMessages)||result.validationMessages.length)throw new Error("Google rejected the conversion schema.");
  const response=await fetch(`https://region1.google-analytics.com/mp/collect?${query}`,{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)
  });
  if(!response.ok)throw new Error(`Google conversion delivery failed (${response.status}).`);
}
