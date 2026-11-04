import {randomUUID,createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {google} from 'googleapis';
import type {Firestore} from 'firebase-admin/firestore';
import {SHEET_TAB_BY_PRODUCT} from './catalog.js';
import {normalizeGoogleServiceAccountPrivateKey} from '../infrastructure/private-key.js';

export function verifyAllocationSignature(raw:string,timestamp:string,signature:string,secret:string,now=Date.now()){
 if(!/^\d+$/.test(timestamp)||Math.abs(now-Number(timestamp)*1000)>300000||!/^\w{64}$/.test(signature))return false;
 const expected=createHmac('sha256',secret).update(`wl-sheet-allocation-v1:${timestamp}:${raw}`).digest('hex');
 return timingSafeEqual(Buffer.from(signature),Buffer.from(expected));
}
export function selectSheetAllocation(rows:unknown[][],orderId:string,email:string){
 const existing=rows.findIndex(r=>r[3]===orderId);
 if(existing>=0){const r=rows[existing]!;if(String(r[1]).trim().toLowerCase()!==email||!r[0])throw new Error('Existing key assignment needs review.');return {index:existing,key:String(r[0]),existing:true};}
 const index=rows.findIndex(r=>r[0]&&!r[1]&&!r[3]);
 if(index<0)throw new Error('No available keys remain for this delivery method.');
 return {index,key:String(rows[index]![0]),existing:false};
}
export async function allocateSheetKey(db:Firestore,input:{orderId:string;email:string;sheetTab:string;paymentLinkId?:string}){
 if(!Object.values(SHEET_TAB_BY_PRODUCT).includes(input.sheetTab))throw new Error('Unknown key inventory.');
 const email=input.email.trim().toLowerCase();
 const spreadsheetId=process.env.GOOGLE_SHEET_ID,sa=process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,key=process.env.GOOGLE_PRIVATE_KEY;
 if(!spreadsheetId||!sa||!key)throw new Error('Google Sheets inventory is not configured.');
 const owner=randomUUID(),ref=db.collection('inventoryAllocationLeases').doc(createHash('sha256').update(spreadsheetId+':'+input.sheetTab).digest('hex'));
 await db.runTransaction(async tx=>{const d=(await tx.get(ref)).data();if(d?.until>Date.now())throw new Error('Inventory is busy. Delivery will retry.');tx.set(ref,{owner,until:Date.now()+180000});});
 try{
  const auth=new google.auth.JWT({email:sa,key:normalizeGoogleServiceAccountPrivateKey(key),scopes:['https://www.googleapis.com/auth/spreadsheets']});
  const sheets=google.sheets({version:'v4',auth}),tab=`'${input.sheetTab.replaceAll("'","''")}'`;
  const rows=(await sheets.spreadsheets.values.get({spreadsheetId,range:`${tab}!A2:E`},{timeout:20000})).data.values??[];
  const selected=selectSheetAllocation(rows,input.orderId,email),rowNumber=selected.index+2;
  if(!selected.existing)await sheets.spreadsheets.values.update({spreadsheetId,range:`${tab}!B${rowNumber}:E${rowNumber}`,valueInputOption:'RAW',requestBody:{values:[[email,new Date().toISOString(),input.orderId,input.paymentLinkId??'manual-admin']]}},{timeout:20000});
  // Sheet is authoritative. A retry after a lost response finds the same order ID.
  const checked=(await sheets.spreadsheets.values.get({spreadsheetId,range:`${tab}!A${rowNumber}:E${rowNumber}`},{timeout:20000})).data.values?.[0];
  if(!checked||checked[0]!==selected.key||checked[3]!==input.orderId||String(checked[1]).toLowerCase()!==email)throw new Error('Key assignment could not be verified.');
  return {key:selected.key,sheetTab:input.sheetTab,rowNumber};
 }finally{await db.runTransaction(async tx=>{const d=await tx.get(ref);if(d.data()?.owner===owner)tx.delete(ref);});}
}
