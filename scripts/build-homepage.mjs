import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, cp, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { variants } from '../integrations/web/testsite/variants.js';
const path = p => fileURLToPath(new URL('../' + p, import.meta.url));
export async function buildHomepage() {
  const inputs = ['package-lock.json', 'scripts/build-homepage.mjs', 'integrations/web/testsite/site.js', 'integrations/web/testsite/variants.js', 'integrations/web/testsite/content.json', 'integrations/web/testsite/funding.json', 'integrations/web/shop/attribution.js', 'public/testsite/index.html', 'public/testsite/site.css'];
  const assets = (await readdir(path('public/testsite/assets'))).sort();
  inputs.push(...assets.map(name => 'public/testsite/assets/' + name));
  const hash = createHash('sha256');
  for (const name of inputs) {
    const bytes=await readFile(path(name));
    // Windows checkout CRLF and Netlify Linux LF must produce the same page ID.
    hash.update(name).update(name.startsWith('public/testsite/assets/')?bytes:bytes.toString('utf8').replaceAll('\r\n','\n'));
  }
  const id = 'page-' + hash.digest('hex').slice(0, 20);
  const base = '/testsite/versions/' + id + '/';
  const manifestPath = path('src/analytics/website-designs.json');
  let manifest; try {manifest=JSON.parse(await readFile(manifestPath,'utf8'));}catch{manifest={fallback:id,current:id,designs:[]};}
  await build({entryPoints:[path('integrations/web/testsite/site.js')],bundle:true,minify:true,format:'iife',target:['es2020'],define:{HOMEPAGE_DESIGN:JSON.stringify(id),HOMEPAGE_FALLBACK:JSON.stringify(manifest.fallback)},outfile:path('public/testsite/site.js')});
  const snapshot = path('public' + base);
  let exists = false; try { await access(snapshot); exists = true; } catch {}
  if (!exists) {
    await mkdir(snapshot, {recursive:true});
    await cp(path('public/testsite/assets'), snapshot + 'assets', {recursive:true});
    for (const file of ['index.html','site.css','site.js']) {
      let data = await readFile(path('public/testsite/' + file), 'utf8');
      if (file === 'index.html') data = data.replaceAll('/testsite/assets/', base+'assets/').replace('/testsite/site.css',base+'site.css').replace('/testsite/site.js',base+'site.js');
      await writeFile(snapshot + file, data);
    }
  }
  if (!manifest.designs.some(d=>d.id===id)) manifest.designs.push({id,variants:Object.fromEntries(Object.entries(variants).map(([key,value])=>[key,value.label]))});
  manifest.current=id;
  await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  return id;
}
