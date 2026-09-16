import Stripe from 'stripe';
import prices from '../../../catalog/website-runtime-prices.live.json' with {type:'json'};
import type {WebsiteSessionRequest} from './website-session.js';

// Website sales deliberately use the already provisioned live credential.
// Do not switch the existing native/test integrations or their processing jobs
// into production merely to make the guest website checkout available.
export function websiteStripeConfiguration(){
 const secret=process.env.STRIPE_LIVE_SECRET_KEY;
 if(!secret || !/^(sk|rk)_live_/.test(secret))throw new Error('STRIPE_LIVE_SECRET_KEY is missing or is not a live Stripe key.');
 const origin=new URL(process.env.PUBLIC_APP_ORIGIN??'https://wl-purchase-entitlement.netlify.app').origin;
 if(!origin.startsWith('https://'))throw new Error('Website checkout requires an HTTPS return origin.');
 return {secret,origin};
}
let client:Stripe|undefined;
export function websiteStripeClient(){
 client??=new Stripe(websiteStripeConfiguration().secret,{apiVersion:'2025-08-27.basil'});
 return client;
}
export function websitePriceId(offer:WebsiteSessionRequest['offer']){return prices.prices[offer];}
