import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
for(const file of process.argv.slice(2)){
 const source=readFileSync(file,'utf8');
 let purchased=new Set(),account=null,tester=false;
 function Interpreter(){}function Title(){}
 Title.prototype.start=()=>{};Title.prototype.terminate=()=>{};
 const ctx=vm.createContext({document:{currentScript:{src:'file:///js/plugins/WonderlangAccess.js'}},PluginManager:{parameters:()=>({})},window:{AndroidManager:{refreshPurchases(){},isPurchased:sku=>purchased.has(sku)},WLAccountEntitlements:{currentOfflineSafe:()=>account}},navigator:{userAgent:'Android'},localStorage:{getItem:()=>tester?'true':null},Scene_Title:Title,Game_Interpreter:Interpreter,Utils:{isMobileDevice:()=>true},$gameSwitches:{value:()=>false}});
 vm.runInContext(source,ctx);
 const access=()=>new Interpreter().getGameAccessLevel();
 assert.equal(access(),0);
 for(const sku of ['wonderlangmonthly','buy-polyglot-permanent','wonderlangfull','wonderlangfull_game']){purchased=new Set([sku]);assert.equal(access(),5,sku);}
 purchased.clear();account={fullGame:true};assert.equal(access(),5,'website subscription or permanent entitlement');
 account={fullGame:false,offlineExpired:true};assert.equal(access(),0,'expired/wrong-platform account');
 for(const sku of ['wonderlangch1','wonderlangch2','wonderlangch3','wonderlangch4']){purchased=new Set([sku]);assert.equal(access(),5,'retired chapter permanent upgrade: '+sku);}
 purchased.clear();tester=true;assert.equal(access(),5,'reviewer override preserved');
 console.log('PASS: native/web access, expiry, legacy and reviewer cases: '+file);
}
