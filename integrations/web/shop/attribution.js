export const META_KEYS = ['fbp','fbc','fbclid'];
export function metaAttribution(search, cookies = '', now = Date.now()) {
 const params = new URLSearchParams(search), result = {};
 for (const [key,name] of [['fbp','_fbp'],['fbc','_fbc']]) {
  let value=params.get(key);
  if(!value){const raw=cookies.split('; ').find(x=>x.startsWith(name+'='));try{value=raw?decodeURIComponent(raw.slice(name.length+1)):null;}catch{}}
  if(value&&/^fb\.\d+\.\d+\.[\w.-]+$/.test(value)&&value.length<=255)result[key]=value;
 }
 const click=params.get('fbclid');
 if(click&&/^[A-Za-z0-9_-]{1,200}$/.test(click)&&(!result.fbc||!result.fbc.endsWith('.'+click)))result.fbc=`fb.1.${now}.${click}`;
 return result;
}
export function addAttribution(params, values) {
 for(const key of ['fbp','fbc'])if(values?.[key])params.set(key,values[key]);
}
