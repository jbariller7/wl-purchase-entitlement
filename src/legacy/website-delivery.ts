import {google} from 'googleapis';
import type {Firestore} from 'firebase-admin/firestore';

/** Read an assignment made by purchased-keys-automation. Never allocate here:
 * Google Sheets remains the existing automation's single delivery inventory. */
export async function websiteDelivery(db:Firestore,sessionId:string,buyerEmail:string,sheetTab:string){
 const ref=db.collection('legacyFulfillments').doc(sessionId);
 const cached=await ref.get();
 if(cached.exists)return cached.data()!.keys as Array<{key:string;sheetTab:string;rowNumber:number}>;
 const email=process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,key=process.env.GOOGLE_PRIVATE_KEY,spreadsheetId=process.env.GOOGLE_SHEET_ID;
 if(!email||!key||!spreadsheetId)throw new Error('Website delivery inventory is not configured.');
 const auth=new google.auth.JWT({email,key:key.replace(/\\n/g,'\n'),scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
 const sheets=google.sheets({version:'v4',auth});
 const data=await sheets.spreadsheets.values.get({spreadsheetId,range:`'${sheetTab.replaceAll("'","''")}'!A:E`});
 const keys=(data.data.values??[]).flatMap((row,index)=>String(row[3]??'')===sessionId&&String(row[1]??'').trim().toLowerCase()===buyerEmail&&row[0]
   ?[{key:String(row[0]),sheetTab,rowNumber:index+1}]:[]);
 if(keys.length)await ref.set({orderId:sessionId,keys,createdAt:new Date().toISOString(),allocationAuthority:'purchased-keys-automation'});
 return keys;
}
