import {describe,it,expect} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
// @ts-expect-error Browser content source is intentionally plain JS.
import {pages,ui,labels,slugs} from '../integrations/web/testsite/pages-content.js';
// @ts-expect-error Shared static/browser renderer is intentionally plain JS.
import {renderPage,contactText} from '../integrations/web/testsite/page-render.js';
describe('migrated website pages',()=>{
 for(const lang of ['en','fr','es'])for(const slug of slugs)it(`${slug} has complete ${lang} content and valid local assets`,()=>{
  const t=pages[slug][lang],html=renderPage(slug,lang);expect(t.title.length).toBeGreaterThan(3);expect(t.intro.length).toBeGreaterThan(20);expect(labels[lang]).toHaveLength(7);expect(Object.keys(ui[lang]).sort()).toEqual(Object.keys(ui.en).sort());expect(Object.keys(contactText[lang]).sort()).toEqual(Object.keys(contactText.en).sort());
  expect(t.sections.length).toBe(pages[slug].en.sections.length);expect(html).not.toMatch(/undefined|lp\.wonderlang\.net|buy\.stripe\.com/);
  for(const match of html.matchAll(/(?:src|href)="(\/testsite\/(?:page-assets|assets)\/[^"?]+)"/g))expect(existsSync('public'+match[1])).toBe(true);
  if(slug==='contacts'){expect(html).toContain('id="contact-form"');expect(html).toContain(contactText[lang].send);expect(html).toContain('maxlength="8000"')}
 });
 it('escapes rendered text, never turns customer content into HTML',()=>{
  const original=pages.contacts.en.intro;try{pages.contacts.en.intro='<img src=x onerror=alert(1)>';expect(renderPage('contacts','en')).toContain('&lt;img src=x onerror=alert(1)&gt;')}finally{pages.contacts.en.intro=original}
 });
 it('keeps contact storage server-only under the existing deny-all rules',()=>expect(readFileSync('firestore.rules','utf8')).toContain('allow read, write: if false'));
});
