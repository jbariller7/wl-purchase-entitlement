import {expect,it,vi} from 'vitest';
vi.mock('../src/infrastructure/firebase.js',()=>({firestore:vi.fn()}));
vi.mock('../src/config/env.js',()=>({deploymentControls:()=>({AD_CONVERSIONS_ENABLED:true})}));
import handler from '../netlify/functions/steam-bonus-conversion.js';
it.each(['null','chrome-extension://njgcanhfjdabfmnlmpmdedalocpafnhl'])('returns a valid native Response for desktop preflight %s',async origin=>{
 const response=await handler(new Request('https://wonderlang.app/.netlify/functions/steam-bonus-conversion',{method:'OPTIONS',headers:{Origin:origin}}),{} as any);
 expect(response.status).toBe(200);
 expect(response.headers.get('access-control-allow-origin')).toBe(origin);
 expect(response.headers.get('access-control-allow-methods')).toContain('POST');
});
it('rejects an unrelated web origin before any queue or data access',async()=>{
 const response=await handler(new Request('https://wonderlang.app/.netlify/functions/steam-bonus-conversion',{method:'OPTIONS',headers:{Origin:'https://attacker.example'}}),{} as any);
 expect(response.status).toBe(403);
 expect(response.headers.get('access-control-allow-origin')).toBeNull();
});
