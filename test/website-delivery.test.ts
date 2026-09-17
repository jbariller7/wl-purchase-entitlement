import {createPrivateKey,generateKeyPairSync} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({jwt:vi.fn(),read:vi.fn(),sheets:vi.fn()}));
vi.mock('googleapis',()=>({google:{auth:{JWT:class{constructor(options:unknown){mocks.jwt(options);}}},sheets:mocks.sheets}}));
import {websiteDelivery} from '../src/legacy/website-delivery.js';
const pem=generateKeyPairSync('rsa',{modulusLength:1024}).privateKey.export({type:'pkcs8',format:'pem'}).toString();
function database(cached?:unknown){
 const set=vi.fn().mockResolvedValue(undefined);
 const doc=vi.fn(()=>({get:async()=>({exists:cached!==undefined,data:()=>cached}),set}));
 const collection=vi.fn(()=>({doc}));
 return {db:{collection} as any,set,doc};
}
beforeEach(()=>{
 vi.clearAllMocks();
 vi.stubEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL','sheets@example.iam.gserviceaccount.com');
 vi.stubEnv('GOOGLE_PRIVATE_KEY',pem);
 vi.stubEnv('GOOGLE_SHEET_ID','inventory-id');
 mocks.jwt.mockImplementation(({key})=>{createPrivateKey(key);});
 mocks.sheets.mockReturnValue({spreadsheets:{values:{get:mocks.read}}});
 mocks.read.mockResolvedValue({data:{values:[
  ['https://itch.io/download/owned','Buyer@example.com','date','cs_owned'],
  ['https://itch.io/download/other','other@example.com','date','cs_other'],
  ['https://itch.io/download/wrong-owner','other@example.com','date','cs_owned']
 ]}});
});
afterEach(()=>vi.unstubAllEnvs());
describe('website delivery credential decoding and ownership',()=>{
 it('reproduces the old OpenSSL decoder failure with a JSON-quoted credential',()=>{
  const oldDecoded=JSON.stringify(pem).replace(/\\n/g,'\n');
  expect(()=>createPrivateKey(oldDecoded)).toThrow();
 });
 it.each([
  ['PEM',pem],['escaped PEM',pem.replace(/\n/g,'\\n')],
  ['JSON-quoted PEM',JSON.stringify(pem)],['double-escaped PEM',pem.replace(/\n/g,'\\\\n')],
  ['flattened PEM',pem.replace(/\n/g,' ')]
 ])('reads only the existing assigned link with %s',async(_label,input)=>{
  vi.stubEnv('GOOGLE_PRIVATE_KEY',input);
  const {db,set}=database();
  const keys=await websiteDelivery(db,'cs_owned','buyer@example.com','Polyglot Itch');
  expect(keys).toEqual([{key:'https://itch.io/download/owned',sheetTab:'Polyglot Itch',rowNumber:1}]);
  expect(mocks.jwt).toHaveBeenCalledWith({email:'sheets@example.iam.gserviceaccount.com',key:pem,scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(set).toHaveBeenCalledWith(expect.objectContaining({orderId:'cs_owned',keys,allocationAuthority:'purchased-keys-automation'}));
 });
 it('does not call Google or allocate another key when the delivery is cached',async()=>{
  const keys=[{key:'existing',sheetTab:'Polyglot Itch',rowNumber:2}];
  const {db,set}=database({keys});
  expect(await websiteDelivery(db,'cs_owned','buyer@example.com','Polyglot Itch')).toEqual(keys);
  expect(mocks.jwt).not.toHaveBeenCalled();expect(set).not.toHaveBeenCalled();
 });
 it('does not cache a missing delivery',async()=>{
  const {db,set}=database();
  expect(await websiteDelivery(db,'cs_missing','buyer@example.com','Polyglot Itch')).toEqual([]);
  expect(set).not.toHaveBeenCalled();
 });
 it('rejects damaged keys without logging or echoing their contents',async()=>{
  vi.stubEnv('GOOGLE_PRIVATE_KEY','private-secret-malformed');
  const {db}=database();
  await expect(websiteDelivery(db,'cs_owned','buyer@example.com','Polyglot Itch')).rejects.toThrow('Invalid Google Sheets private-key configuration.');
  expect(mocks.jwt).not.toHaveBeenCalled();expect(mocks.read).not.toHaveBeenCalled();
 });
});
