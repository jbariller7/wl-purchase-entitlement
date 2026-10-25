// Local, intercepted browser check: never sends Meta events or creates checkouts.
const {chromium}=require('C:/Users/utilisateur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const results=[];
 const csp=fs.readFileSync('netlify.toml','utf8').split('for = "/beyondmockup*"')[1].match(/Content-Security-Policy = "([^"]+)"/)[1];
 async function scenario({name,returned=false,optout=false,paid=true}){
  const context=await browser.newContext();const page=await context.newPage();let loads=0,checkouts=0,statusUrl='';const errors=[];
  await context.addInitScript(({optout})=>{window.__metaCalls=[];if(optout)localStorage.setItem('wl_measurement','no');},{optout});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname==='connect.facebook.net'){
    loads++;assert(!route.request().headers().referer?.includes('token='));
    return route.fulfill({contentType:'application/javascript',body:'window.fbq.callMethod=function(){window.__metaCalls.push([...arguments])};'});
   }
   if(u.hostname!=='wonderlang.app')return route.abort();
   if(u.pathname==='/.netlify/functions/beyond-vip'){
    if(u.searchParams.get('action')==='status'){
     statusUrl=u.href;
     return route.fulfill({contentType:'application/json',body:JSON.stringify({state:paid?'paid':'pending',eligible:paid,tierName:'Adventurer',conversion:paid&&!optout?{eventName:'Purchase',eventId:'beyond-vip:cs_live_browser123',pixelId:'552284573796131',value:1,currency:'USD',product:'WonderLang_Beyond_VIP_adventurer',emailSha256:'a'.repeat(64),eventTime:Math.floor(Date.now()/1000)}:null})});
    }
    checkouts++;return route.fulfill({status:200,contentType:'text/html',body:'<p>Intercepted checkout: no payment created.</p>'});
   }
   let filename=path.join(process.cwd(),'public',decodeURIComponent(u.pathname));if(u.pathname.endsWith('/'))filename=path.join(filename,'index.html');
   if(!fs.existsSync(filename)||/\.(mp4|webm)$/.test(filename))return route.abort();
   const mime={'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.vtt':'text/vtt'}[path.extname(filename)]||'application/octet-stream';
   return route.fulfill({contentType:mime,body:fs.readFileSync(filename),headers:{'Content-Security-Policy':csp,'Referrer-Policy':'no-referrer'}});
  });
  await page.goto('https://wonderlang.app/beyondmockup/'+(returned?'reserved.html?session_id=cs_live_browser123&token='+'a'.repeat(64):''));
  if(returned){
   await page.waitForFunction(()=>document.getElementById('reservation-title').textContent!=='Checking your reservation…');
   if(paid)await page.locator('#reservation-stay').click();
   if(paid&&!optout)await page.waitForFunction(()=>window.__metaCalls.some(c=>c[2]==='Purchase'));
   assert(!page.url().includes('token='));assert(!page.url().includes('session_id='));
   if(optout)assert(statusUrl.includes('metaOptOut=1'));
  }else{
   if(!optout)await page.waitForFunction(()=>window.__metaCalls.some(c=>c[2]==='PageView'));
   // Prevent navigation, while still dispatching a normal checkout click.
   await page.evaluate(()=>document.querySelector('a[href*="/.netlify/functions/beyond-vip?"]').addEventListener('click',e=>setTimeout(()=>{},0)));
   await page.evaluate(()=>{
    const a=document.querySelector('a[href*="/.netlify/functions/beyond-vip?"]');
    window.__checkoutHref=a.href;
    const original=a.href;a.href=original;a.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true}));
   });
   if(!optout)await page.waitForFunction(()=>window.__metaCalls.some(c=>c[2]==='InitiateCheckout'));
  }
  const calls=await page.evaluate(()=>window.__metaCalls);
  const events=calls.filter(c=>c[0]==='trackSingle');
  if(optout||returned&&!paid){assert.equal(loads,0);assert.equal(events.length,0);}
  else if(returned){assert.equal(events.length,1);assert.equal(events[0][4].eventID,'beyond-vip:cs_live_browser123');assert.equal(events[0][3].value,1);}
  else assert.deepEqual(events.map(c=>c[2]),['PageView','InitiateCheckout']);
  assert.deepEqual(errors,[]);results.push({name,events:events.map(c=>c[2]),pixelLoads:loads,passed:true});await context.close();
 }
 try{
  for(const opts of [{name:'campaign funnel'},{name:'campaign opt-out',optout:true},{name:'verified return',returned:true},{name:'return opt-out',returned:true,optout:true},{name:'unpaid return',returned:true,paid:false}])await scenario(opts);
  fs.mkdirSync('work-audit',{recursive:true});fs.writeFileSync('work-audit/vip-browser-tracking-check.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
