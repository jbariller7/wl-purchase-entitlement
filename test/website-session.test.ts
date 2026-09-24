import {describe,it,expect} from 'vitest';
import {websiteSessionSchema,websiteSessionParams} from '../src/providers/stripe/website-session.js';
import locales from '../catalog/website-checkout-locales.json' with {type:'json'};
const checkoutMessage=(result:ReturnType<typeof websiteSessionParams>)=>{
 const submit=result.custom_text?.submit;
 return submit && typeof submit==='object'?submit.message:'';
};
const common={locale:'en',currency:'USD',requestId:'550e8400-e29b-41d4-a716-446655440000'};
describe('guest website selections',()=>{
 it('displays the selected options in French without extra checkout fields',()=>{
  const params=(options:object)=>websiteSessionParams(websiteSessionSchema.parse({...common,locale:'fr',...options}),'price_approved','https://example.com');
  const premium=params({offer:'premium',delivery:'steam',mobilePlatform:'android'});
  expect(checkoutMessage(premium)).toContain('Version PC/Mac souhaitée: Clé Steam');
  expect(checkoutMessage(premium)).toContain('Android');
  expect(checkoutMessage(premium)).toContain('L’accès iOS est inclus dès le lancement');
  expect(checkoutMessage(premium)).not.toContain('Première plateforme mobile');
  expect(premium.custom_fields).toBeUndefined();
  const single=params({offer:'single',delivery:'direct',learningLanguage:'french'});
  expect(checkoutMessage(single)).toContain('Version PC/Mac souhaitée: Téléchargement direct');
  expect(checkoutMessage(single)).toContain('Langue que vous souhaitez apprendre: Français');
 });
 it('includes applicable options across every locale within Stripe text limits',()=>{
  for(const [locale,l] of Object.entries(locales)){
   for(const offer of ['single','polyglot','premium','mobile_monthly','mobile_permanent']){
    const mobile=offer.startsWith('mobile_');
    const input=websiteSessionSchema.parse({...common,locale,offer,...(!mobile?{delivery:'direct'}:{}),...(offer==='single'?{learningLanguage:'mandarin'}:{}),...((mobile||offer==='premium')?{mobilePlatform:mobile?'ios':'later'}:{})});
    const result=websiteSessionParams(input,'price_approved','https://example.com');
    const message=checkoutMessage(result);
    expect(message.length).toBeLessThanOrEqual(1200);
    expect(message).not.toMatch(/undefined|\[object Object\]/);
    if(!mobile)expect(message).toContain(`${l.delivery}: ${l.direct}`);
    if(offer==='single')expect(message).toContain(`${l.language}: ${l.languages[7]}`);
    if(offer==='premium'){expect(message).not.toContain(`${l.mobile}:`);expect(message).toContain('Android');expect(message).toContain('iOS');}
    if(mobile)expect(message).toContain('iOS');
    expect(result.custom_fields).toBeUndefined();
   }
  }
 });
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
