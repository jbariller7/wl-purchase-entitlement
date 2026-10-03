import {build} from 'esbuild';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {pages} from '../integrations/web/testsite/pages-content.js';
import {renderPage,escape} from '../integrations/web/testsite/page-render.js';
const path=p=>fileURLToPath(new URL('../'+p,import.meta.url));
export async function buildPages(){
 await Promise.all(['pages','directory'].map(name=>build({entryPoints:[path('integrations/web/testsite/'+name+'.js')],bundle:true,minify:true,format:'iife',target:['es2020'],outfile:path('public/testsite/'+name+'.js')})));
 for(const slug of Object.keys(pages)){
  await mkdir(path('public/testsite/'+slug),{recursive:true});
  const t=pages[slug].en;
  await writeFile(path('public/testsite/'+slug+'/index.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escape(t.title)} — WonderLang</title><meta name="description" content="${escape(t.intro)}"><link rel="icon" href="/wonderlang-logo.png"><link rel="stylesheet" href="/testsite/site.css"><link rel="stylesheet" href="/testsite/pages.css"><script src="/testsite/pages.js" defer></script><script src="/testsite/directory.js" defer></script></head><body id="top" data-page="${slug}">${renderPage(slug,'en')}</body></html>`);
 }
 // Both old About URLs remain usable. No redirect leaves the test website.
 await mkdir(path('public/testsite/about-us'),{recursive:true});
 await writeFile(path('public/testsite/about-us/index.html'),await readFile(path('public/testsite/crafting-the-game/index.html'),'utf8'));
 // Shared navigation is not experimental content. Add it consistently to the
 // root and all frozen designs; do not rewrite their JS, copy, or assignment.
 const homes=['public/testsite/index.html',...(await readdir(path('public/testsite/versions'))).map(name=>'public/testsite/versions/'+name+'/index.html')];
 for(const home of homes){let html;try{html=await readFile(path(home),'utf8')}catch{continue}
  if(!html.includes('src="/testsite/directory.js"')){html=html.replace('</head>','<link rel="stylesheet" href="/testsite/pages.css"><script src="/testsite/directory.js" defer></script></head>');await writeFile(path(home),html)}
 }
}
