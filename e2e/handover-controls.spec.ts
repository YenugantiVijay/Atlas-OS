import {test,expect} from '@playwright/test';import {readFileSync} from 'node:fs';
async function mount(page:import('@playwright/test').Page,body:string){
 await page.setViewportSize({width:390,height:844});await page.goto('/');const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addScriptTag({type:'module',content:`import {${body}} from "/e2e/fixtures/handover-harness.tsx";${body}();`});
 await expect(page.getByTestId('handover-mounted')).toBeVisible();return errors;
}
test('owner grants and revokes a staff location on mobile',async({page})=>{
 const errors=await mount(page,'mountLocation');
 await page.getByRole('button',{name:'Manage location access'}).click();await page.getByLabel('Assigned stall or depot').fill('STALL A');await page.getByLabel('Staff team member').selectOption('staff-a');await page.getByRole('button',{name:'Grant location access'}).click();await expect(page.getByRole('button',{name:'Revoke STALL A for staff-a'})).toBeVisible();await page.getByRole('button',{name:'Revoke STALL A for staff-a'}).click();await expect(page.getByText(/No staff location assignments/)).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
test('reconciliation downloads complete book balances and leaves physical verification blank',async({page})=>{
 const errors=await mount(page,'mountReport');
 await page.getByRole('button',{name:'Open reconciliation'}).click();await expect(page.getByText(/Recorded cash variance/)).toContainText('0.01');const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download stock verification sheet'}).click();const file=await download;const csv=readFileSync((await file.path())!,'utf8');expect(csv).toContain('physical_quantity');expect(csv).toContain('"13","",""');expect(csv).toContain('STALL A');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
