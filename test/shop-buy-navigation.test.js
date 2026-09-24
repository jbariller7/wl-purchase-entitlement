import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {describe,expect,it} from 'vitest';
import locales from '../catalog/website-checkout-locales.json';
import prices from '../catalog/website-prices.json';
import ui from '../catalog/website-shop-ui.json';
import mobile from '../catalog/website-mobile-locales.json';
import discountText from '../catalog/website-discount-locales.json';
import countdownUnits from '../catalog/website-sale-countdown-units.json';
import {metaAttribution,addAttribution} from '../integrations/web/shop/attribution.js';
import {remainingSaleTime} from '../integrations/web/shop/sale-countdown.js';
import {REGIONAL_PRICES,stripeMinorAmount,currencyFractionDigits} from '../src/domain/regional-pricing.js';

async function shop(extra=''){
 const nodes=new Map(),requests=[];
 class Element {
  children=[];attributes={};value='';hidden=false;style={};dataset={};classList={add(){},toggle(){}};
  set id(value){nodes.set(value,this)}
  prepend(...children){this.children.unshift(...children)}
  querySelectorAll(){return []}
  get childElementCount(){return this.children.length}
  append(...children){this.children.push(...children)}
  replaceChildren(){this.children=[]}
  add(option){this.children.push(option);if(!this.value)this.value=option.value}
  setAttribute(key,value){this.attributes[key]=value}
  removeAttribute(key){delete this.attributes[key]}
  closest(){return this}
  before(node){nodes.set(node.id,node)}
 }
 for(const key of ['language','currency','heading','language-label','currency-label','offers','status'])nodes.set(key,new Element());
 const context=vm.createContext({locales,prices,ui,mobile,discountText,countdownUnits,metaAttribution,addAttribution,remainingSaleTime,REGIONAL_PRICES,stripeMinorAmount,currencyFractionDigits,URLSearchParams,Intl,AbortController,setTimeout,clearTimeout,setInterval(){},
  location:{search:'?lang=fr&currency=EUR'+extra},navigator:{language:'fr-FR'},
  document:{documentElement:{classList:{toggle(){}}},createElement:()=>new Element(),getElementById:id=>nodes.get(id),querySelector:()=>new Element()},
  Option:class{constructor(text,value){this.text=text;this.value=value}},
  window:{addEventListener(){}},parent:{},ResizeObserver:class{observe(){}},
  fetch:url=>{requests.push(url);return Promise.reject(new Error('Unavailable'))}
 });
 const source=readFileSync(new URL('../integrations/web/shop/shop.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 vm.runInContext(source,context);
 await new Promise(setImmediate);return {nodes,requests};
}
describe('shop Buy navigation',()=>{
 it('lets buyers open checkout even if the optional public sales endpoint fails',async()=>{
  const {nodes,requests}=await shop();
  const buttons=nodes.get('offers').children.map(card=>card.children.find(x=>x.className==='buy'));
  expect(buttons).toHaveLength(3);
  for(const button of buttons){
   expect(button.href).toMatch(/^\/shop\/checkout\/\?/);
   expect(button.attributes['aria-disabled']).toBeUndefined();
   expect(new URL(button.href,'https://example.com').searchParams.get('currency')).toBe('EUR');
  }
  expect(nodes.get('status').textContent).toBe('');
  expect(requests).toEqual(['/.netlify/functions/website-discount?placement=website']);
 });
 it('preserves mobile platform and product selection in the checkout request',async()=>{
  const {nodes}=await shop();nodes.get('platform-tabs').children[1].onclick();
  const cards=nodes.get('offers').children;
  for(const [index,offer] of ['mobile_monthly','mobile_permanent','premium'].entries()){
   const button=cards[index].children.find(x=>x.className==='buy');
   const query=new URL(button.href,'https://example.com').searchParams;
   expect(query.get('offer')).toBe(offer);
   expect(query.get('mobilePlatform')).toBe(offer==='premium'?null:'android');
  }
 });
 it('carries an enrollment token through all offer links without inventing one',async()=>{
  for(const token of ['a'.repeat(64),'not-valid']){
   const {nodes}=await shop('&experimentToken='+token);
   for(const card of nodes.get('offers').children){const button=card.children.find(x=>x.className==='buy');expect(new URL(button.href,'https://example.com').searchParams.get('experimentToken')).toBe(token.length===64?token:null)}
  }
 });
});
