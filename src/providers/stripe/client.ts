import Stripe from "stripe";
import { env } from "../../config/env.js";

let client: Stripe | undefined;

export function stripeClient(): Stripe {
  client ??= new Stripe(env().STRIPE_SECRET_KEY, { apiVersion: "2025-08-27.basil" });
  return client;
}
