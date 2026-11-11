import { describe, expect, it, vi } from 'vitest';
import { productsService } from './products.service';

const returned = {
  id:'11111111-2222-4333-8444-555555555555',
  organization_id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  sku:'STG-GRN-001',name:'Staging Item',category:'Testing',uom:'Nos',
  purchase_cost:100,selling_price:150,tax_rate:0,is_active:true,
};
const rpc = vi.fn(() => ({
  abortSignal: vi.fn(async()=>({data:returned,error:null})),
}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc}}));

describe('product creation matches deployed Supabase RPC',()=>{
  it('does not send unsupported p_is_active and passes an abort signal',async()=>{
    const controller=new AbortController();
    const product=await productsService.createProduct(returned.organization_id,{
      name:'Staging Item',sku:'STG-GRN-001',category:'Testing',uom:'Nos',
      purchaseCost:100,sellingPrice:150,taxRate:0,isActive:true,reorderThreshold:10,
    },false,0,controller.signal);
    expect(product.id).toBe(returned.id);
    expect(product.currentStock).toBe(0);
    expect(rpc).toHaveBeenCalledWith('create_product_atomic',expect.objectContaining({
      p_org_id:returned.organization_id,p_sku:'STG-GRN-001',p_opening_stock:0,
    }));
    const payload=rpc.mock.calls[0][1];
    expect(payload).not.toHaveProperty('p_is_active');
    expect(payload).not.toHaveProperty('openingStock');
  });
});
