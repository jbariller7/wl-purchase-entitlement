import {isIP} from 'node:net';
export type VipAttribution={metaOptOut?:'1';fbp?:string;fbc?:string;ipAddress?:string;userAgent?:string};
export function vipAttribution(q:Record<string,string|undefined>,headers:Record<string,string|undefined>):VipAttribution {
 const h=Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),v]));
 if(q.metaOptOut==='1'||h['sec-gpc']==='1')return {metaOptOut:'1'};
 const result:VipAttribution={};
 const cookie=(name:string)=>{try{return decodeURIComponent((h.cookie??'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)??'')}catch{return ''}};
 for(const key of ['fbp','fbc'] as const){const value=q[key]??cookie('_'+key);if(/^fb\.\d+\.\d+\.[\w.-]+$/.test(value)&&value.length<=(key==='fbc'?4096:255))result[key]=value;}
 const ip=h['x-nf-client-connection-ip'];if(ip&&isIP(ip))result.ipAddress=ip;
 const ua=h['user-agent'];if(ua&&ua.length<=1024)result.userAgent=ua;
 return result;
}
