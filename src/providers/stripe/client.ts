import Stripe from "stripe";
import { AsyncLocalStorage } from 'node:async_hooks';
import { stripeEnv } from "../../config/env.js";

let client: Stripe | undefined;
const requestClient = new AsyncLocalStorage<Stripe>();

/** Keep website live webhooks isolated from the pre-existing test integration. */
export function withStripeClient<T>(stripe:Stripe,action:()=>Promise<T>):Promise<T>{
  return requestClient.run(stripe,action);
}

export function stripeClient(): Stripe {
  const scoped=requestClient.getStore();
  if(scoped)return scoped;
  client ??= new Stripe(stripeEnv().STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" });
  return client;
}
