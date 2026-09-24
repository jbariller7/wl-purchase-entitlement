export function remainingSaleTime(expiresAt,now=Date.now()) {
 const end=Date.parse(expiresAt);
 if(!Number.isFinite(end))return null;
 const seconds=Math.max(0,Math.ceil((end-now)/1000));
 return {days:Math.floor(seconds/86400),hours:Math.floor(seconds%86400/3600),minutes:Math.floor(seconds%3600/60),seconds:seconds%60,expired:end<=now};
}
