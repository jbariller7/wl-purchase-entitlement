import {describe,it,expect,vi,beforeEach} from 'vitest';
import {createHmac} from 'node:crypto';
import {verifyAllocationSignature,selectSheetAllocation} from '../src/legacy/sheet-allocation.js';
import {accessReceipt} from '../integrations/web/admin-console/manual-access.js';
describe('Shared sheet allocation',()=>{
 it('reuses exactly the same order assignment and rejects a different recipient',()=>{const rows=[['KEY','a@example.com','','manual-1']];expect(selectSheetAllocation(rows,'manual-1','a@example.com').existing).toBe(true);expect(()=>selectSheetAllocation(rows,'manual-1','other@example.com')).toThrow(/review/);});
 it('skips assigned rows, even when their email is blank, and rejects exhausted inventory',()=>{const rows=[['TAKEN','','','existing'],['NEW','','','']];expect(selectSheetAllocation(rows,'new','a@example.com').key).toBe('NEW');expect(()=>selectSheetAllocation(rows.slice(0,1),'new','a@example.com')).toThrow(/No available/);});
 it('accepts a signed allocation only within its time window and rejects altered payloads',()=>{const raw='{}',timestamp='1700000000',secret='test-secret';const signature=createHmac('sha256',secret).update(`wl-sheet-allocation-v1:${timestamp}:${raw}`).digest('hex');expect(verifyAllocationSignature(raw,timestamp,signature,secret,1700000000000)).toBe(true);expect(verifyAllocationSignature('changed',timestamp,signature,secret,1700000000000)).toBe(false);expect(verifyAllocationSignature(raw,timestamp,signature,secret,1700000400000)).toBe(false);});
});
describe('Persistent grant confirmation',()=>{
 it('does not claim queued or uncertain mail was sent',()=>{const r={created:true};expect(accessReceipt(r,{email:'a@example.com',emailState:'queued'})).toContain('queued');expect(accessReceipt(r,{emailState:'uncertain'})).toContain('uncertain');expect(accessReceipt(r,{email:'a@example.com',emailState:'sent',deliveryState:'assigned',delivery:'steam',key:'KEY'})).toContain('Confirmation email sent to a@example.com');expect(accessReceipt(r,{emailState:'sent',deliveryState:'assigned',key:'<script>'})).not.toContain('<script>');});
});
