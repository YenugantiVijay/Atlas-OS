import { describe, expect, it, vi } from 'vitest';
import { productsService } from './products.service';

const returned = {
  id:'11111111-2222-4333-8444-555555555555',
  organization_id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  sku:'STG-GRN-001',name:'Staging Item',category:'Testing',uom:'Nos',
  purchase_cost:100,selling_price:150,tax_rate:0,is_active:true,
};
const rpc = vi.hoisted(() => vi.fn((_name: string, _args: Record<string, unknown>) => ({
  abortSignal: vi.fn(async()=>({data:{
    id:'11111111-2222-4333-8444-555555555555',
    organization_id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    // Same compact JSON as the live Supabase RPC: no category or is_active.
    sku:'STG-GRN-001',name:'Staging Item',uom:'Nos',
    purchase_cost:100,selling_price:150,tax_rate:0,
  },error:null})),
})));
vi.mock('@/lib/supabase',()=>({supabase:{rpc}}));

describe('product creation matches deployed Supabase RPC',()=>{
  it('does not send unsupported p_is_active and passes an abort signal',async()=>{
    const controller=new AbortController();
    const product=await productsService.createProduct(returned.organization_id,{
      name:'Staging Item',sku:'STG-GRN-001',category:'Testing',uom:'Nos',
      brand:'Atlas Test',description:'Staging only',hsnCode:'1234',
      purchaseCost:100,sellingPrice:150,taxRate:0,isActive:true,reorderThreshold:10,
    },false,0,controller.signal);
    expect(product.id).toBe(returned.id);
    expect(product.currentStock).toBe(0);
    expect(product.isActive).toBe(true);
    expect(product.category).toBe('Testing');
    expect(product.brand).toBe('Atlas Test');
    expect(product.hsnCode).toBe('1234');
    expect(product.reorderThreshold).toBe(10);
    expect(product.description).toBe('Staging only');
    expect(product.createdAt).toEqual(expect.any(String));
    expect(rpc).toHaveBeenCalledWith('create_product_atomic',expect.objectContaining({
      p_org_id:returned.organization_id,p_sku:'STG-GRN-001',p_opening_stock:0,
    }));
    const payload=rpc.mock.calls[0][1];
    expect(payload).not.toHaveProperty('p_is_active');
    expect(payload).not.toHaveProperty('openingStock');
  });
});
