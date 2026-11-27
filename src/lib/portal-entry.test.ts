import { afterEach,describe,expect,it } from 'vitest';
import { filterProductWorkspaces,invalidPortalEntry,portalEntry,portalHref,portalPathAllowed,productEntry,sessionScope } from './portal-entry';
afterEach(()=>window.history.replaceState({},'','/'));
describe('Product and portal entry boundaries',()=>{
 it('uses distinct sessions for products and roles',()=>{
  const scopes=['?tool=electrical&portal=owner','?tool=school&portal=school_admin','?tool=school&portal=parent','?tool=electrical&portal=employee'].map(search=>{window.history.replaceState({},'','/'+search);return sessionScope();});expect(new Set(scopes).size).toBe(4);
 });
 it('rejects unsupported entry values without falling back to an existing cloud session',()=>{
  window.history.replaceState({},'','/?tool=not-a-product');expect(invalidPortalEntry()).toBe(true);expect(sessionScope()).toBe('atlas-invalid-entry-v1');
  window.history.replaceState({},'','/?tool=school&portal=superuser');expect(invalidPortalEntry()).toBe(true);
 });
 it('creates clean full-page role entry URLs and keeps attendance in its own portal',()=>{
  window.history.replaceState({},'','/?tool=electrical&unrelated=private#/invoices');const url=new URL(portalHref('school','parent'));expect(url.search).toBe('?tool=school&portal=parent');expect(url.hash).toBe('#/school');
  expect(new URL(portalHref('electrical','employee')).hash).toBe('#/attendance/my');
 });
 it('does not offer business pages within attendance or family portals',()=>{
  for(const portal of ['employee','manager','parent','student','teacher','school_accounts'] as const)expect(portalPathAllowed(portal,'/invoices')).toBe(false);
  expect(portalPathAllowed('employee','/attendance/my')).toBe(true);expect(portalPathAllowed('employee','/attendance')).toBe(false);expect(portalPathAllowed('manager','/attendance')).toBe(true);
 });
 it('filters a previously saved company out when another product is requested',()=>{
  const orgs=[{id:'vijay-electronics',name:'Vijay Electronics'},{id:'school-a',name:'School A'}];
  expect(filterProductWorkspaces(orgs,[{organization_id:'school-a'}])).toEqual([orgs[1]]);
  expect(filterProductWorkspaces(orgs,[])).toEqual([]);
  expect(()=>filterProductWorkspaces(orgs,{allowed:true})).toThrow();
  expect(()=>filterProductWorkspaces(orgs,[null])).toThrow();
 });
 it('reads only known product and portal identifiers',()=>{
  expect(productEntry('?tool=school')).toBe('school');expect(portalEntry('?portal=teacher')).toBe('teacher');expect(productEntry('?tool=unknown')).toBeUndefined();
 });
});
