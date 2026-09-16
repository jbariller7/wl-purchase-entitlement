import {describe,it,expect} from 'vitest';
import {websiteSessionSchema,websiteSessionParams} from '../src/providers/stripe/website-session.js';
const common={locale:'en',currency:'USD',requestId:'550e8400-e29b-41d4-a716-446655440000'};
describe('guest website selections',()=>{
 it('requires a platform for both mobile offers',()=>{
  for(const offer of ['mobile_monthly','mobile_permanent']){
   expect(websiteSessionSchema.safeParse({...common,offer}).success).toBe(false);
   expect(websiteSessionSchema.safeParse({...common,offer,mobilePlatform:'later'}).success).toBe(false);
   expect(websiteSessionSchema.safeParse({...common,offer,mobilePlatform:'android'}).success).toBe(true);
  }
 });
 it('requires desktop delivery and the single learning language',()=>{
  expect(websiteSessionSchema.safeParse({...common,offer:'single',delivery:'steam'}).success).toBe(false);
  expect(websiteSessionSchema.safeParse({...common,offer:'single',delivery:'steam',learningLanguage:'french'}).success).toBe(true);
 });
 it('rejects client prices and cross-offer options',()=>{
  expect(websiteSessionSchema.safeParse({...common,offer:'premium',delivery:'steam',amount:1}).success).toBe(false);
  expect(websiteSessionSchema.safeParse({...common,offer:'polyglot',delivery:'steam',mobilePlatform:'ios'}).success).toBe(false);
 });
 it('uses one configured price, no checkout selection fields, and a card-required trial',()=>{
  const input=websiteSessionSchema.parse({...common,offer:'mobile_monthly',mobilePlatform:'ios'});
  const result=websiteSessionParams(input,'price_approved','https://example.com');
  expect(result.mode).toBe('subscription');
  expect(result.subscription_data?.trial_period_days).toBe(3);
  expect(result.payment_method_collection).toBe('always');
  expect(result.line_items).toEqual([{price:'price_approved',quantity:1}]);
  expect(result.custom_fields).toBeUndefined();
  expect(result.metadata?.wl_mobile_platform).toBe('ios');
 });
});
