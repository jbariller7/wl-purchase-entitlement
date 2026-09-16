import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {describe,expect,it} from 'vitest';
import locales from '../catalog/website-checkout-locales.json';
import prices from '../catalog/website-prices.json';
import ui from '../catalog/website-shop-ui.json';
import mobile from '../catalog/website-mobile-locales.json';
import {REGIONAL_PRICES,stripeMinorAmount,currencyFractionDigits} from '../src/domain/regional-pricing.js';

function shop(){
 const nodes=new Map(),requests=[];
 class Element {
  children=[];attributes={};value='';hidden=false;
  append(...children){this.children.push(...children)}
  replaceChildren(){this.children=[]}
  add(option){this.children.push(option);if(!this.value)this.value=option.value}
  setAttribute(key,value){this.attributes[key]=value}
  removeAttribute(key){delete this.attributes[key]}
  closest(){return this}
  before(node){nodes.set(node.id,node)}
 }
 for(const key of ['language','currency','heading','language-label','currency-label','offers','status'])nodes.set(key,new Element());
 const context=vm.createContext({locales,prices,ui,mobile,REGIONAL_PRICES,stripeMinorAmount,currencyFractionDigits,URLSearchParams,Intl,
  location:{search:'?lang=fr&currency=EUR'},navigator:{language:'fr-FR'},
  document:{documentElement:{classList:{toggle(){}}},createElement:()=>new Element(),getElementById:id=>nodes.get(id),querySelector:()=>new Element()},
  Option:class{constructor(text,value){this.text=text;this.value=value}},
  window:{addEventListener(){}},parent:{},ResizeObserver:class{observe(){}},
  fetch:url=>{requests.push(url);return Promise.reject(new Error('Unavailable'))}
 });
 const source=readFileSync(new URL('../integrations/web/shop/shop.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 vm.runInContext(source,context);
 return {nodes,requests};
}
describe('shop Buy navigation',()=>{
 it('lets buyers open checkout without waiting for a readiness endpoint',()=>{
  const {nodes,requests}=shop();
  const buttons=nodes.get('offers').children.map(card=>card.children.find(x=>x.className==='buy'));
  expect(buttons).toHaveLength(3);
  for(const button of buttons){
   expect(button.href).toMatch(/^\/shop\/checkout\/\?/);
   expect(button.attributes['aria-disabled']).toBeUndefined();
   expect(new URL(button.href,'https://example.com').searchParams.get('currency')).toBe('EUR');
  }
  expect(nodes.get('status').textContent).toBe('');
  expect(requests).toEqual([]);
 });
 it('preserves mobile platform and product selection in the checkout request',()=>{
  const {nodes}=shop();nodes.get('platform-tabs').children[1].onclick();
  const cards=nodes.get('offers').children;
  for(const [index,offer] of ['mobile_monthly','mobile_permanent','premium'].entries()){
   const button=cards[index].children.find(x=>x.className==='buy');
   const query=new URL(button.href,'https://example.com').searchParams;
   expect(query.get('offer')).toBe(offer);
   expect(query.get('mobilePlatform')).toBe('android');
  }
 });
});
