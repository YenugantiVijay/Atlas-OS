import { expect,test } from '@playwright/test';

test('a school role entry does not reopen a legacy business demo or saved company',async({page})=>{
 await page.addInitScript(()=>{
  localStorage.setItem('atlas_auth_mode_v2','demo');
  localStorage.setItem('atlas_organizations_v1',JSON.stringify([{id:'old-company',name:'Vijay Electronics',currency:'INR'}]));
  localStorage.setItem('atlas_active_org_id_v2','old-company');
 });
 await page.goto('/?tool=school&portal=parent#/school');
 await expect(page.getByRole('heading',{name:'Sign in to School Management · Parent',exact:true})).toBeVisible();
 await expect(page.getByText('Vijay Electronics',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>localStorage.getItem('atlas-school-parent-v1:mode'))).toBeNull();
 expect(await page.evaluate(()=>localStorage.getItem('atlas_active_org_id_v2'))).toBe('old-company');
 await expect(page.getByRole('link',{name:'Parent sign in',exact:true})).toHaveAttribute('href',/tool=school&portal=parent#\/school$/);
});

test('employee and family demo portals have their own landing screens and no ERP creation actions on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>{
  localStorage.setItem('atlas-electrical-employee-v1:mode','demo');
  localStorage.setItem('atlas-school-parent-v1:mode','demo');
 });
 await page.goto('/?tool=electrical&portal=employee#/');
 await expect(page.getByRole('heading',{name:'Employee Portal',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Quick Create',exact:true})).toHaveCount(0);
 await expect(page.getByText('Sign in to a cloud workspace to use employee attendance.')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.goto('/?tool=school&portal=parent#/');
 await expect(page.getByRole('heading',{name:'Parent portal',exact:true})).toBeVisible();
 await expect(page.getByText(/No student records are simulated/)).toBeVisible();
 await expect(page.getByRole('button',{name:'Add student',exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('an invalid portal URL cannot fall back to a saved workspace session',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('atlas_auth_mode_v2','demo'));
 await page.goto('/?tool=school&portal=superuser#/');
 await expect(page.getByRole('heading',{name:'Unknown product or portal',exact:true})).toBeVisible();
 await expect(page.getByRole('navigation',{name:'Workspace navigation'})).toHaveCount(0);
});
