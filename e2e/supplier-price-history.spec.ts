import { test, expect } from '@playwright/test';

test.describe('PR57 supplier price history — safe demo rendering',()=>{
  test.beforeEach(async({page})=>{
    await page.addInitScript(()=>localStorage.setItem('atlas_auth_mode_v2','demo'));
    await page.goto('/#/supplier-prices');
  });

  test('shows separate price history and quote entry without fake backend writes',async({page})=>{
    await expect(page.getByRole('heading',{name:'Supplier Price History'})).toBeVisible();
    await expect(page.getByRole('status').filter({hasText:'cloud-only'})).toBeVisible();
    await expect(page.getByRole('region',{name:'Supplier price table'})).toBeVisible();
    await expect(page.getByRole('columnheader',{name:'Effective',exact:true})).toBeVisible();
    await expect(page.getByRole('columnheader',{name:'Unit rate',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'Record supplier quote'})).toBeDisabled();
    await expect(page.getByText(/does not change stock, master purchase cost, sale price or valuation/)).toBeVisible();
  });

  test('keeps private history actions disabled, and supports a scrolling mobile table',async({page})=>{
    await page.setViewportSize({width:375,height:812});
    await expect(page.getByLabel('Supplier',{exact:true})).toBeDisabled();
    const table=page.getByRole('region',{name:'Supplier price table'});
    const widths=await table.evaluate((element)=>({
      outer:element.clientWidth,inner:element.scrollWidth,
    }));
    expect(widths.inner).toBeGreaterThan(widths.outer);
    await expect.poll(()=>page.evaluate(()=>
      document.documentElement.scrollWidth-document.documentElement.clientWidth
    )).toBeLessThanOrEqual(1);
  });
});
