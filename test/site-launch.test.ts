import {describe,it,expect,beforeAll} from 'vitest';
import {readFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
// @ts-expect-error Build script intentionally uses native JavaScript.
import {buildSiteLaunch,launchBlockers} from '../scripts/build-site-launch.mjs';
// @ts-expect-error Authored multilingual page content.
import {pages,slugs} from '../integrations/web/testsite/pages-content.js';
import source from '../integrations/web/testsite/privacy-policy.json' with {type:'json'};

describe('public website launch preparation',()=>{
 const out=resolve('dist/site-launch');
 beforeAll(async()=>{await buildSiteLaunch({outDir:out,preview:true})},60000);
 it('does not activate the root while publication notes remain',async()=>{
  expect(launchBlockers().length).toBeGreaterThan(0);
  await expect(buildSiteLaunch({outDir:resolve('dist/blocked-launch'),preview:false})).rejects.toThrow('Launch not activated');
  await expect(access('public/index.html')).rejects.toThrow();
 });
 it('preserves the full English source and every translated paragraph',()=>{
  expect(pages['privacy-policy'].en).toEqual(source.en);
  for(const lang of ['fr','es']){
   expect(pages['privacy-policy'][lang].sections.map((s:string[])=>s.length)).toEqual(source.en.sections.map(s=>s.length));
   expect(pages['privacy-policy'][lang].draftNotice).toBeTruthy();
  }
 });
 it('serves localized supporting pages without requiring JavaScript for the policy text',async()=>{
  for(const lang of ['en','fr','es']){
   const html=await readFile(out+(lang==='en'?'':'/__localized/'+lang)+'/privacy-policy/index.html','utf8');
   expect(html).toContain(`<html lang="${lang}">`);
   expect(html).toContain(pages['privacy-policy'][lang].title);
   expect(html).toContain('data-public-site="true"');
   expect(html).toContain('rel="canonical"');
   expect(html).not.toContain('/testsite/');
  }
 });
 it('keeps account, shop, API and admin outside the marketing redirects',async()=>{
  const redirects=await readFile(out+'/_redirects','utf8');
  expect(redirects).toContain('/ lang=fr /__localized/fr/index.html 200!');
  expect(redirects).toContain('/ lang=es /__localized/es/index.html 200!');
  expect(redirects).not.toMatch(/^\/(account|admin|api|admin-api|shop|webhooks)/m);
  expect(redirects).not.toContain('/*');
  for(const route of ['account','admin','shop'])await expect(access(out+'/'+route+'/index.html')).resolves.toBeUndefined();
 });
 it('indexes only marketing routes in the future sitemap and blocks indexing of the local launch preview',async()=>{
  const sitemap=await readFile(out+'/sitemap.xml','utf8');
  expect((sitemap.match(/<url>/g)||[]).length).toBe((slugs.length+1)*3);
  expect(sitemap).not.toMatch(/testsite|versions|account|admin|__localized/);
  expect(await readFile(out+'/robots.txt','utf8')).toContain('Disallow: /');
  expect(await readFile(out+'/_headers','utf8')).toContain('X-Robots-Tag: noindex, nofollow');
 });
 it('pre-renders a useful homepage and retains all three language alternates',async()=>{
  const html=await readFile(out+'/index.html','utf8');
  expect(html).not.toContain('<h1 id="hero-title"></h1>');
  for(const lang of ['en','fr','es'])expect(html).toContain(`hreflang="${lang}"`);
  expect(html).toContain('https://wonderlang.app/assets/snow.webp');
 });
 it('produces indexable canonical pages in the approved launch mode',async()=>{
  const status=source.status,sections=source.en.sections;
  try{
   // In-memory fixture only; the real policy file and its approval never change.
   source.status='approved';source.en.sections=sections.map(s=>s.filter(p=>!p.startsWith('[Before publication:')));
   const target=resolve('dist/site-launch-approved-test');
   await buildSiteLaunch({outDir:target,preview:false});
   expect(await readFile(target+'/index.html','utf8')).toContain('content="index,follow"');
   expect(await readFile(target+'/robots.txt','utf8')).toContain('Sitemap: https://wonderlang.app/sitemap.xml');
   expect(await readFile(target+'/_headers','utf8')).not.toContain('X-Robots-Tag: noindex');
  }finally{source.status=status;source.en.sections=sections}
 },60000);
});
