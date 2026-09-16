const currencies={US:'USD',GB:'GBP',CH:'CHF',LI:'CHF',RU:'RUB',PL:'PLN',BR:'BRL',JP:'JPY',NO:'NOK',ID:'IDR',MY:'MYR',PH:'PHP',SG:'SGD',TH:'THB',VN:'VND',KR:'KRW',UA:'UAH',MX:'MXN',CA:'CAD',AU:'AUD',NZ:'NZD',CN:'CNY',IN:'INR',CL:'CLP',PE:'PEN',CO:'COP',ZA:'ZAR',HK:'HKD',TW:'TWD',SA:'SAR',AE:'AED',IL:'ILS',KZ:'KZT',KW:'KWD',QA:'QAR',CR:'CRC',UY:'UYU'};
const euro=new Set(['AT','BE','BG','HR','CY','EE','FI','FR','DE','GR','IE','IT','LV','LT','LU','MT','NL','PT','SK','SI','ES','AD','MC','SM','VA','ME','XK']);
export default function handler(request,context){
 const country=context.geo?.country?.code?.toUpperCase();
 // Return only a currency suggestion, never the visitor's IP or exact location.
 return Response.json({currency:euro.has(country)?'EUR':currencies[country]||'USD'},{headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
export const config={path:'/shop/location.json',method:'GET'};
