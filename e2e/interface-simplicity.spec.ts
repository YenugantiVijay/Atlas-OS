import {test,expect} from './workspace-fixture';
import {openNavigationGroup} from './navigation';

test('a short menu supports search, grouped navigation and direct-route recovery',async({page},testInfo)=>{
 await page.addInitScript(()=>localStorage.setItem('atlas_auth_mode_v2','demo'));await page.goto('/');
 const nav=page.getByRole('navigation',{name:'Workspace navigation'});
 await expect(nav.getByRole('button',{name:'Sales',exact:true})).toHaveAttribute('aria-expanded','false');
 await expect(nav.getByRole('link',{name:'Sales Orders'})).toBeHidden();
 await page.getByRole('searchbox',{name:'Find a module'}).fill('invoice');await nav.getByRole('link',{name:'Tax Invoices'}).click();
 await page.getByRole('searchbox',{name:'Find a module'}).fill('');await expect(nav.getByRole('link',{name:'Tax Invoices'})).toHaveAttribute('aria-current','page');
 await page.reload();await expect(nav.getByRole('link',{name:'Tax Invoices'})).toBeVisible();
 await page.goto('/');await expect(page.getByRole('heading',{name:'Sri Lakshmi Electrical Distributors'})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('desktop.png'),fullPage:false});
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Open navigation menu'}).click();
 await openNavigationGroup(page,'Inventory');await nav.getByRole('link',{name:'Products & SKUs'}).click();await expect(nav).toBeHidden();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('mobile.png'),fullPage:false});
});

test('stall work starts with daily controls and opens its activity graph on demand',async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/?tool=ice-cream-stalls#/ice-cream-counter');
 await expect(page.getByRole('region',{name:/Stock received and sold/i})).toBeHidden();await expect(page.getByLabel('Stall name',{exact:true})).toBeVisible();
 await page.getByText('Activity overview',{exact:true}).click();await expect(page.getByRole('region',{name:/Stock received and sold/i})).toBeVisible();
 await page.getByText('Activity overview',{exact:true}).click();await page.screenshot({path:testInfo.outputPath('stall-mobile.png'),fullPage:false});
});
