import { test, expect } from '@playwright/test';

test.describe('PR #56 receiving workstation — safe demo presentation',()=>{
  test.beforeEach(async({page})=>{
    await page.addInitScript(()=>localStorage.setItem('atlas_auth_mode_v2','demo'));
    await page.goto('/#/receiving');
  });

  test('renders the notepad-style receiving grid with supplier reference and no fake stock posting',async({page})=>{
    await expect(page.getByRole('heading',{name:'Bulk Goods Receiving'})).toBeVisible();
    await expect(page.getByRole('region',{name:'Receiving line-item grid'})).toBeVisible();
    const headings=['Sl.','Product / SKU','Cases','Units/case','Variable cartons','Loose units','Received units','Unit','Delivery check','Purchase rate','Line value'];
    for(const name of headings){
      await expect(page.getByRole('columnheader',{name,exact:true})).toBeVisible();
    }
    await expect(page.getByRole('status').filter({hasText:'Cloud-only first release'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Save receiving draft'})).toBeDisabled();
    await expect(page.getByRole('button',{name:'New product'})).toBeDisabled();
    await expect(page.getByText(/Suggestions show live stock and current catalog selling price/)).toBeVisible();
    await expect(page.getByRole('button',{name:'Confirm posting'})).toHaveCount(0);
    await expect(page.getByText(/Saving a draft never increases stock/)).toBeVisible();
  });

  test('notebook import explains variable carton counts while unauthorized posting stays blocked',async({page})=>{
    const opener=page.getByRole('button',{name:'Paste notebook rows'});
    await expect(opener).toBeDisabled();
    await expect(page.getByText(/No assumed pack size/)).toBeVisible();
    await expect(page.getByText(/No receipts have been recorded yet/)).toBeVisible();
  });

  test('receiving worksheet retains its own horizontal table scroll on mobile',async({page})=>{
    await page.setViewportSize({width:375,height:812});
    await expect(page.getByRole('region',{name:'Receiving line-item grid'})).toBeVisible();
    const region=page.getByRole('region',{name:'Receiving line-item grid'});
    const widths=await region.evaluate((element)=>({
      outer:element.clientWidth,inner:element.scrollWidth,
    }));
    expect(widths.inner).toBeGreaterThan(widths.outer);
    await expect.poll(()=>page.evaluate(()=>
      document.documentElement.scrollWidth-document.documentElement.clientWidth
    ),{timeout:3500}).toBeLessThanOrEqual(1);
  });
});
