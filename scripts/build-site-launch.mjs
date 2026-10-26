import {cp, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {resolve, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pages, slugs} from '../integrations/web/testsite/pages-content.js';
import {renderPage, escape} from '../integrations/web/testsite/page-render.js';
import content from '../integrations/web/testsite/content.json' with {type:'json'};
import policy from '../integrations/web/testsite/privacy-policy.json' with {type:'json'};

const root=fileURLToPath(new URL('../',import.meta.url));
const origin='https://wonderlang.app';
const languages=['en','fr','es'];
const routes=['',...slugs];
export const canonical=(slug,lang)=>origin+'/'+(slug?slug+'/':'')+(lang==='en'?'':'?lang='+lang);
export function seo(slug,lang,title,description){
 return `<link rel="canonical" href="${canonical(slug,lang)}">${languages.map(l=>`<link rel="alternate" hreflang="${l}" href="${canonical(slug,l)}">`).join('')}<link rel="alternate" hreflang="x-default" href="${canonical(slug,'en')}"><meta property="og:type" content="website"><meta property="og:site_name" content="WonderLang"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${canonical(slug,lang)}"><meta property="og:image" content="${origin}/assets/snow.webp"><meta name="twitter:card" content="summary_large_image">`;
}
// The old A/B snapshots remain untouched. Only public copies receive new paths.
export function publicCopy(text){
 let result=text.replaceAll('/testsite/','/').replaceAll('22154858','47615861').replaceAll('144956028970075999','202396171826627602');
 result=result.replace(/(?:\/versions\/page-[a-f0-9]+)?\/assets\/(gameplay-(?:sentences|vocabulary))\.gif/g,'/assets/$1.webp');
 // Apply the media improvement to public copies of existing A/B builds too.
 result=result.replace(/([\w$]+)\.src=[\w$]+\+"gameplay-"\+([\w$]+)\+"\.gif",\1\.alt=([^,]+),\1\.loading="lazy",\1\.width=([^,]+),\1\.height=([^,]+),/g,'$1=window.wlCreateGameplayLoop($2,$3,$4,$5),');
 result=result.replaceAll('.gameplay-motion img','.gameplay-motion :is(img,video)').replaceAll('.gameplay-reverse img','.gameplay-reverse :is(img,video)');
 if(result.includes('.gameplay-motion{')&&!result.includes('</head>')&&!result.includes('video.gameplay-loop'))result+='\nvideo.gameplay-loop{height:auto}\n';
 if(result.includes('<head>')&&!result.includes('/site-media.js'))result=result.replace('<head>','<head><script defer src="/site-media.js?v=20261026"></script>');
 // Existing A/B designs can still be selected by the admin. Give their public
 // copies the same signup attribution without changing the archived designs.
 if(result.includes('</head>')&&result.includes('ml-subscribe-form')&&!result.includes('/newsletter-attribution.js')){
  result=result.replace('</head>','<script defer src="/newsletter-attribution.js?v=20261026"></script></head>');
 }
 return result;
}
export function launchBlockers(){
 const blockers=[];
 if(policy.status!=='approved'||/\[Before publication:/.test(JSON.stringify(policy.en)))blockers.push('The privacy policy is still a draft with unresolved publication notes.');
 return blockers;
}
function homeDocument(template,lang){
 const t=content[lang];
 // Pre-render the existing authored text; JavaScript still handles A/B variants,
 // current prices and rich cards. No network calls or tracking during the build.
 let html=template.replace('<html lang="en">',`<html lang="${lang}">`)
  .replace(/(<[^>]+data-t="([\w.]+)"[^>]*>)([^<]*)(<\/[^>]+>)/g,(all,open,key,old,close)=>{
   const value=key.split('.').reduce((v,k)=>v?.[k],t);return typeof value==='string'?open+escape(value)+close:all;
  })
  .replace('<h1 id="hero-title"></h1>',`<h1 id="hero-title">${escape(t.heroA)}</h1>`)
  .replace(/<title>.*?<\/title>/,`<title>WonderLang — ${escape(t.heroA.replaceAll('\n',' '))}</title>`)
  .replace(/<meta name="description" content="[^"]*">/,`<meta name="description" content="${escape(t.intro)}">`);
 return html;
}
function documentHead(html,slug,lang,preview){
 const title=slug?pages[slug][lang].title+' — WonderLang':'WonderLang — '+content[lang].heroA.replaceAll('\n',' ');
 const description=slug?pages[slug][lang].intro:content[lang].intro;
 return publicCopy(html)
  .replace(/<meta name="robots" content="[^"]*">/,`<meta name="robots" content="${preview?'noindex,nofollow':'index,follow'}">`)
  .replace('<body','<body data-public-site="true"')
  .replace('</head>',seo(slug,lang,title,description)+'</head>');
}
export async function buildSiteLaunch({outDir=join(root,'dist/site-launch'),preview=true}={}){
 const blockers=launchBlockers();
 if(!preview&&blockers.length)throw new Error('Launch not activated: '+blockers.join(' '));
 const destination=resolve(outDir);
 if(destination!==join(root,'public')&&!destination.startsWith(join(root,'dist')+'/')&&!destination.startsWith(join(root,'dist')+'\\'))throw new Error('Launch output must stay in public or dist.');
 await mkdir(destination,{recursive:true});
 if(destination!==join(root,'public'))await cp(join(root,'public'),destination,{recursive:true});
 const source=join(root,'public/testsite');
 async function mirror(dir){
  for(const entry of await readdir(dir,{withFileTypes:true})){
   const path=join(dir,entry.name),rel=relative(source,path),target=join(destination,rel);
   if(entry.isDirectory()){await mkdir(target,{recursive:true});await mirror(path);continue;}
   if(/\.(html|js|css)$/.test(entry.name)){
    let text=await readFile(path,'utf8');
    if(entry.name==='index.html'&&rel.startsWith('versions'))text=documentHead(text,'','en',preview);
    else text=publicCopy(text);
    await writeFile(target,text);
   }else await cp(path,target);
  }
 }
 await mirror(source);
 const home=await readFile(join(source,'index.html'),'utf8');
 const redirects=[];
 for(const slug of routes)for(const lang of languages){
  let html;
  if(!slug)html=homeDocument(home,lang);
  else {
   html=await readFile(join(source,slug,'index.html'),'utf8');
   html=html.replace(/<html lang="en">/,`<html lang="${lang}">`).replace(/<body[^>]*>[\s\S]*<\/body>/,`<body id="top" data-page="${slug}">${renderPage(slug,lang)}</body>`)
    .replace(/<title>.*?<\/title>/,`<title>${escape(pages[slug][lang].title)} — WonderLang</title>`)
    .replace(/<meta name="description" content="[^"]*">/,`<meta name="description" content="${escape(pages[slug][lang].intro)}">`);
  }
  const route='/'+(slug?slug+'/':'');
  const target=lang==='en'?route+'index.html':'/__localized/'+lang+route+'index.html';
  await mkdir(join(destination,target,'..'),{recursive:true});
  await writeFile(join(destination,target),documentHead(html,slug,lang,preview));
  if(lang!=='en')redirects.push(`${route} lang=${lang} ${target} 200!`);
 }
 redirects.push('/about-us/ /crafting-the-game/ 301','/contact/ /contacts/ 301');
 // Explicit localized rules precede the existing root-to-account redirect.
 // Static index.html shadows that unforced redirect only in an activated build.
 await writeFile(join(destination,'_redirects'),redirects.join('\n')+'\n');
 const sitemap=routes.map(slug=>languages.map(lang=>`<url><loc>${canonical(slug,lang)}</loc>${languages.map(l=>`<xhtml:link rel="alternate" hreflang="${l}" href="${canonical(slug,l)}"/>`).join('')}</url>`).join('')).join('');
 await writeFile(join(destination,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${sitemap}</urlset>\n`);
 await writeFile(join(destination,'robots.txt'),preview?'User-agent: *\nDisallow: /\n':`User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /account/\nDisallow: /shop/checkout/\nDisallow: /shop/complete/\nDisallow: /api/\nDisallow: /admin-api/\nDisallow: /__localized/\nSitemap: ${origin}/sitemap.xml\n`);
 const config=await readFile(join(root,'netlify.toml'),'utf8');
 const csp=config.match(/for = "\/testsite\/\*"[\s\S]*?Content-Security-Policy = "([^"]+)"/)[1];
 let headers=routes.map(slug=>`/${slug?slug+'/':''}\n  Content-Security-Policy: ${csp}\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Content-Type-Options: nosniff\n`).join('\n');
 headers+=`\n/versions/*\n  Content-Security-Policy: ${csp}\n  X-Robots-Tag: ${preview?'noindex, nofollow':'index, follow'}\n\n/__localized/*\n  Content-Security-Policy: ${csp}\n`;
 if(preview)headers+='\n/*\n  X-Robots-Tag: noindex, nofollow\n';
 await writeFile(join(destination,'_headers'),headers);
 const report={preparedAt:new Date().toISOString(),publicOrigin:origin,preview,blockers,routes:routes.length*languages.length,rootActivated:!preview};
 await writeFile(join(root,'dist/site-launch-report.json'),JSON.stringify(report,null,2)+'\n');
 return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await buildSiteLaunch(),null,2));
