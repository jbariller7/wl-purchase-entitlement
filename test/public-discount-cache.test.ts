import {describe,it,expect} from 'vitest';
import {publicDiscountHeaders} from '../src/http/public-discount-cache.js';
describe('public discount cache',()=>{
 it('shares public responses for at most one minute with isolated query variants',()=>{
  const h=publicDiscountHeaders([]);
  expect(h['netlify-cdn-cache-control']).toBe('public, max-age=60, must-revalidate');
  expect(h['netlify-vary']).toBe('query=placement|id');
  expect(h['cache-control']).toBe('public, max-age=0, must-revalidate');
 });
 it('never caches beyond the first campaign deadline',()=>{
  const now=Date.parse('2026-10-23T10:00:00Z');
  expect(publicDiscountHeaders([null,'2026-10-23T10:00:45Z','2026-10-24T10:00:00Z'],now)['x-discount-cache-seconds']).toBe('45');
  expect(publicDiscountHeaders(['2026-10-23T09:59:59Z'],now)['netlify-cdn-cache-control']).toBe('no-store');
 });
});
