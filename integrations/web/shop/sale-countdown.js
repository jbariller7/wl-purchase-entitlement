export function remainingSaleTime(expiresAt,now=Date.now()) {
 const end=Date.parse(expiresAt);
 if(!Number.isFinite(end))return null;
 const minutes=Math.max(0,Math.ceil((end-now)/60000));
 return {days:Math.floor(minutes/1440),hours:Math.floor(minutes%1440/60),minutes:minutes%60,expired:end<=now};
}
