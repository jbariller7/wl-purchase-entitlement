// Refresh visible shops within a minute so newly published or stopped sales appear.
export function createSalesRefresh({load, now=Date.now, visible=()=>!document.hidden, online=()=>navigator.onLine!==false}) {
 let nextAt=0, inFlight=null, failures=0;
 return function refresh(){
  if(inFlight)return inFlight;
  if(!visible()||!online()||now()<nextAt)return Promise.resolve();
  inFlight=(async()=>{
   try{
    const seconds=await load(); failures=0;
    nextAt=now()+Math.max(1000, Math.min(60000, seconds*1000));
   }catch{
    failures++; nextAt=now()+Math.min(1800000,60000*2**Math.min(failures-1,5));
   }finally{inFlight=null;}
  })();
  return inFlight;
 };
}
