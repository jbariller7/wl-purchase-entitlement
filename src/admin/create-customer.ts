import type {Auth, UserRecord} from 'firebase-admin/auth';
import {accountEmails} from '../identity/account-email.js';
import {HttpError} from '../http/auth.js';

export async function ensureAdminCustomer(auth:Auth, address:string):Promise<{user:UserRecord;created:boolean}>{
 const email=address.trim().toLowerCase();
 let user:UserRecord|undefined;
 try{user=await auth.getUserByEmail(email);}catch(error){if((error as {code?:string}).code!=='auth/user-not-found')throw error;}
 if(!user){
  const matches:UserRecord[]=[];let cursor:string|undefined;
  for(let page=0;page<10;page++){
   const result=await auth.listUsers(1000,cursor);
   matches.push(...result.users.filter(u=>accountEmails(u).includes(email)));
   cursor=result.pageToken;if(!cursor)break;
  }
  if(cursor)throw new HttpError(409,'Account lookup is incomplete. Search the directory before creating this account.');
  if(matches.length>1)throw new HttpError(409,'Multiple accounts use this email. Select the correct account in the directory.');
  user=matches[0];
 }
 if(user){
  if(user.disabled)throw new HttpError(409,'This account is disabled. Review it in the customer directory first.');
  return {user,created:false};
 }
 try{
  // Administrator creation does not prove mailbox ownership or set a password.
  return {user:await auth.createUser({email,emailVerified:false,disabled:false}),created:true};
 }catch(error){
  if((error as {code?:string}).code!=='auth/email-already-exists')throw error;
  const existing=await auth.getUserByEmail(email);
  if(existing.disabled)throw new HttpError(409,'This account is disabled. Review it in the customer directory first.');
  return {user:existing,created:false};
 }
}
