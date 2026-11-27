import { afterEach,beforeEach,describe,expect,it } from 'vitest';
import { storage } from './storage';
import { portalStorageKey } from './portal-entry';
beforeEach(()=>{localStorage.clear();window.history.replaceState({},'','/');});
afterEach(()=>window.history.replaceState({},'','/'));
describe('Persisted product workspace isolation',()=>{
 it('does not copy a legacy company or current user into another product',()=>{
  localStorage.setItem('atlas_organizations_v1',JSON.stringify([{id:'old-org',name:'Vijay Electronics'}]));
  localStorage.setItem('atlas_current_org_id_v1','old-org');
  localStorage.setItem('atlas_current_user_v1',JSON.stringify({id:'old-user',fullName:'Legacy Owner'}));
  window.history.replaceState({},'','/?tool=school&portal=school_admin');
  expect(storage.getOrganizations().map(org=>org.name)).toEqual(['Local workspace']);
  expect(storage.getCurrentUser().fullName).toBe('Local owner');
  expect(localStorage.getItem('atlas_current_org_id_v1')).toBe('old-org');
 });
 it('restores the selected local organization only within its product and portal',()=>{
  window.history.replaceState({},'','/?tool=electrical&portal=owner');storage.initialize();storage.setCurrentOrgId('electrical-choice');
  window.history.replaceState({},'','/?tool=school&portal=school_admin');storage.initialize();storage.setCurrentOrgId('school-choice');
  expect(storage.getCurrentOrgId()).toBe('school-choice');
  window.history.replaceState({},'','/?tool=electrical&portal=owner');expect(storage.getCurrentOrgId()).toBe('electrical-choice');
  expect(portalStorageKey('draft')).not.toBe('draft');
 });
});
