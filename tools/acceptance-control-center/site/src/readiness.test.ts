import {describe,it,expect} from 'vitest';
import {effectiveStatus,canRelease,type Check} from './readiness';
const sha='a'.repeat(40);
const auth:Check={id:'AUTH-01',status:'verified',requires_auth:true,tested_commit:sha};
describe('release safety gates',()=>{
 it('invalidates old-JWT evidence after a merge',()=>expect(effectiveStatus(auth,'b'.repeat(40))).toBe('unknown'));
 it('never treats blocked as verified',()=>expect(effectiveStatus({...auth,status:'blocked'},sha)).toBe('blocked'));
 it('expires staging health after 24h',()=>expect(effectiveStatus({id:'STG-01',status:'verified',requires_auth:false,tested_commit:'',verified_at:'2026-01-01T00:00:00Z'},sha,Date.parse('2026-01-03T00:00:00Z'))).toBe('unknown'));
 it('requires authenticated gates, main CI and 48 migrations',()=>{
  expect(canRelease([auth],sha,true,48)).toBe(true);
  expect(canRelease([auth],sha,false,48)).toBe(false);
  expect(canRelease([auth],sha,true,47)).toBe(false);
  expect(canRelease([auth],'b'.repeat(40),true,48)).toBe(false);
 });
});