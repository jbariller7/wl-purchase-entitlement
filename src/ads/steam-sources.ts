import {google} from 'googleapis';
import {normalizeGoogleServiceAccountPrivateKey} from '../infrastructure/private-key.js';
import {HttpError} from '../http/auth.js';
import {hash,type SteamReport} from './steam-reconciliation.js';
export const REPORTING_SHEET='15zn0MHwsfkG20eBvEQmFb4BdTto2xEM9z2RAKtfgDow';
export function pacificMidnight(date:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new Error('Invalid date');
 // 08:00 UTC is midnight/01:00 Pacific, before its 02:00 DST transitions.
 const midnightProbe=new Date(date+'T08:00:00Z'),parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',timeZoneName:'longOffset'}).formatToParts(midnightProbe);
 const offset=parts.find(x=>x.type==='timeZoneName')!.value.replace('GMT','');return new Date(date+'T00:00:00'+offset).toISOString();
}
export function sheetReports(rows:unknown[][],date:string,now=Date.now()){
 const next=new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10),start=pacificMidnight(date),end=pacificMidnight(next);
 if(Date.parse(end)>now)throw new HttpError(400,'That Pacific sales day has not ended.');
 const expected=['date','app_id','country','currency','units','gross_revenue','refunds','net_units','net_revenue','source','raw','ingested_at'];
 if(expected.some((v,i)=>rows[0]?.[i]!==v))throw new HttpError(409,'Steam_Sales column layout changed.');
 const latest=new Map<string,unknown[]>(),warnings:string[]=[];
 for(const row of rows.slice(1)){if(String(row[0])!==date)continue;const key=row.slice(0,4).join('|'),old=latest.get(key);if(!old||String(row[11])>String(old[11]))latest.set(key,row);else if(String(row[11])===String(old[11])&&JSON.stringify(row)!==JSON.stringify(old))throw new HttpError(409,'Conflicting sales rows at the same sync timestamp.');}
 const buckets=new Map<string,{report:SteamReport;fresh:boolean}>();
 for(const row of latest.values()){
  const appId=String(row[1]),country=String(row[2]),units=Number(row[7]),revenue=Number(row[8]);
  if(!/^\d{3,12}$/.test(appId)||!/^[A-Z]{2}$/.test(country)||!Number.isInteger(units)||!Number.isFinite(revenue))throw new HttpError(409,'Invalid sales row.');
  const key=appId+'|'+country;let b=buckets.get(key);if(!b){b={report:{appId,country,start,end,units:0,revenue:0,currency:'USD',sourceReference:`Steam_Sales ${date}; net revenue USD excluding tax, before Steam fee`,utm:[]},fresh:true};buckets.set(key,b)}
  b.report.units+=units;b.report.revenue+=revenue;
  b.fresh&&=Date.parse(String(row[11]))>=Date.parse(end);
 }
 const reports:SteamReport[]=[];
 for(const {report,fresh}of buckets.values()){if(!fresh){warnings.push(`${report.appId}/${report.country}: sync occurred before this Pacific day closed; refresh reporting first.`);continue}if(report.units>0&&report.revenue>0)reports.push(report);}
 return {reports,warnings,source:'Steam_Sales',date,start,end,revenueBasis:'Net USD excluding tax, before Steam fee',rows:latest.size};
}
export async function loadSteamSheet(date:string){
 const email=process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,key=process.env.GOOGLE_PRIVATE_KEY;if(!email||!key)throw new HttpError(503,'Reporting reader credentials are unavailable.');
 const auth=new google.auth.JWT({email,key:normalizeGoogleServiceAccountPrivateKey(key),scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
 const sheets=google.sheets({version:'v4',auth});
 try{
 const metadata=await sheets.spreadsheets.get({spreadsheetId:REPORTING_SHEET,fields:'sheets.properties'});
 const tab=metadata.data.sheets?.find(x=>x.properties?.title==='Steam_Sales'),count=tab?.properties?.gridProperties?.rowCount;
 if(!count||count>100000)throw new HttpError(409,'Steam_Sales bounds unavailable or require pagination.');
 const response=await sheets.spreadsheets.values.get({spreadsheetId:REPORTING_SHEET,range:`'Steam_Sales'!A1:L${count}`,valueRenderOption:'FORMATTED_VALUE'});
 return sheetReports(response.data.values||[],date);
 }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(503,'Cannot read the reporting sheet with this server account. Check its existing read access; no sales imported.');}
}
export type UtmEvidence={id:string;appId:string;country:string;start:string;end:string;source:string;medium:string;campaign:string;content:string;term:string;purchases:number;visits:number;trackedVisits:number};
export function parseCsv(text:string){const rows:string[][]=[];let row:string[]=[],field='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(Boolean))rows.push(row);row=[];field=''}else field+=c;}if(quoted)throw new HttpError(400,'Unclosed CSV quote.');row.push(field);if(row.some(Boolean))rows.push(row);return rows;}
export function parseUtmExport(text:string,filename:string):UtmEvidence[]{
 const m=filename.match(/^utm_(\d+)_all_(\d{8})_(\d{8})_country\.csv$/i);if(!m)throw new HttpError(400,'Use the original Steam country export filename: utm_APPID_all_YYYYMMDD_YYYYMMDD_country.csv');
 const iso=(v:string)=>`${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}T00:00:00.000Z`,start=iso(m[2]!),last=iso(m[3]!),end=new Date(Date.parse(last)+86400000).toISOString();
 if(!Number.isFinite(Date.parse(start))||Date.parse(end)<=Date.parse(start))throw new HttpError(400,'Invalid export date range.');
 const rows=parseCsv(text.replace(/^\uFEFF/,'')),headers=rows.shift()||[];
 const expected=['Source','Campaign','Medium','Content','Term','Country','Visits  (GMT)','Trusted Visits','Tracked Visits','Returning Visits','Wishlists','Purchases','Activations'];
 if(expected.some((v,i)=>headers[i]!==v))throw new HttpError(400,'Steam UTM export columns changed; expected the country breakdown.');
 const names=new Intl.DisplayNames(['en'],{type:'region'}),countries=new Map<string,string>();
 for(let a=65;a<=90;a++)for(let b=65;b<=90;b++){const code=String.fromCharCode(a,b),name=names.of(code);if(name&&name!==code)countries.set(name,code);}
 for(const [name,code]of [['Viet Nam','VN'],['Russian Federation','RU'],['Korea, Republic of','KR'],['Taiwan','TW'],['Turkey','TR'],['Czech Republic','CZ']])countries.set(name!,code!);
 const result:UtmEvidence[]=[];
 for(const r of rows){const purchases=Number(r[11]),country=countries.get(r[5]||'');if(!Number.isInteger(purchases)||purchases<0)throw new HttpError(400,'Invalid UTM purchase count.');if(!country){if(purchases)throw new HttpError(400,'Unmapped Steam country: '+String(r[5]));continue;}
  const e={appId:m[1]!,country,start,end,source:r[0]||'',campaign:r[1]||'',medium:r[2]||'',content:r[3]||'',term:r[4]||'',purchases,visits:Number(r[6]),trackedVisits:Number(r[8])};
  if(!Number.isInteger(e.visits)||!Number.isInteger(e.trackedVisits)||e.visits<0||e.trackedVisits<0)throw new HttpError(400,'Invalid UTM visits.');
  result.push({id:hash(JSON.stringify([e.appId,country,start,end,e.source,e.medium,e.campaign,e.content,e.term])),...e});
 }
 if(result.length>400||new Set(result.map(x=>x.id)).size!==result.length)throw new HttpError(400,'Split exports above 400 cohorts, and remove duplicate rows.');return result;
}
