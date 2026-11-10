import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supplierPriceHistoryService } from './supplier-price-history.service';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));

const org='11111111-2222-4333-8444-555555555555';
const supplier='22222222-3333-4444-8555-666666666666';
const product='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const entry='77777777-8888-4999-aaaa-bbbbbbbbbbbb';
const row={
  id:entry,organization_id:org,supplier_id:supplier,supplier_name:'Vendor A',
  product_id:product,product_name:'Copper Cable',product_sku:'CB-1',
  product_uom:'Nos',unit_cost:'1120.50',effective_on:'2026-11-10',
  source_type:'GOODS_RECEIPT',source_receipt_id:'cccccccc-dddd-4eee-8fff-111111111111',
  source_reference:'GRN-001',notes:'Receipt',actor_id:'99999999-8888-4777-8666-555555555555',
  recorded_at:'2026-11-10T10:00:00Z',
};
const createBuilder=(data= [row],error:unknown=null)=>({
  select:vi.fn().mockReturnThis(),
  eq:vi.fn().mockReturnThis(),
  lte:vi.fn().mockReturnThis(),
  order:vi.fn().mockReturnThis(),
  limit:vi.fn().mockResolvedValue({data,error}),
});

describe('PR57 supplier price history service',()=>{
  beforeEach(()=>{vi.clearAllMocks();});

  it('reads only the tenant-scoped and bounded supplier/product history as-of selected date', async()=>{
    const q=createBuilder();
    vi.mocked(supabase!.from).mockReturnValue(q as any);
    const result=await supplierPriceHistoryService.list(org,{
      supplierId:supplier,productId:product,asOf:'2026-11-10',limit:1,
    });
    expect(supabase!.from).toHaveBeenCalledWith('supplier_price_history');
    expect(q.eq).toHaveBeenCalledWith('organization_id',org);
    expect(q.eq).toHaveBeenCalledWith('supplier_id',supplier);
    expect(q.eq).toHaveBeenCalledWith('product_id',product);
    expect(q.lte).toHaveBeenCalledWith('effective_on','2026-11-10');
    expect(q.limit).toHaveBeenCalledWith(1);
    expect(q.order).toHaveBeenCalledWith('effective_on',{ascending:false});
    expect(result[0]).toMatchObject({
      id:entry,unitCost:1120.5,sourceType:'GOODS_RECEIPT',
      productSku:'CB-1',sourceReference:'GRN-001',organizationId:org,
    });
  });

  it('caps list requests at 100 rows and fails closed on DB denial',async()=>{
    const q=createBuilder();
    vi.mocked(supabase!.from).mockReturnValue(q as any);
    await supplierPriceHistoryService.list(org,{limit:10000});
    expect(q.limit).toHaveBeenCalledWith(100);
    const fail=createBuilder(null,{message:'Permission denied'});
    vi.mocked(supabase!.from).mockReturnValue(fail as any);
    await expect(supplierPriceHistoryService.list(org)).rejects.toThrow(/Permission denied/);
  });

  it('calls only the guarded RPC to record a manual quote, never direct table DML',async()=>{
    vi.mocked(supabase!.rpc).mockResolvedValueOnce({
      data:{entry_id:entry,idempotent_replay:false,previous_rate:1120.5,recorded_rate:1160},
      error:null,
    } as any);
    const result=await supplierPriceHistoryService.recordQuote({
      organizationId:org,entryId:entry,supplierId:supplier,productId:product,
      unitCost:1160,effectiveOn:'2026-11-10',notes:'  Supplier price circular #57  ',
    });
    expect(supabase!.rpc).toHaveBeenCalledWith('record_supplier_price_quote',{
      p_org_id:org,p_entry_id:entry,p_supplier_id:supplier,p_product_id:product,
      p_unit_cost:1160,p_effective_on:'2026-11-10',p_notes:'Supplier price circular #57',
    });
    expect(result).toMatchObject({entry_id:entry,idempotent_replay:false,previous_rate:1120.5});
    expect(supabase!.from).not.toHaveBeenCalled();
  });

  it('never claims successful quote recording on RPC error or ambiguous ack',async()=>{
    vi.mocked(supabase!.rpc).mockResolvedValueOnce({data:null,error:{message:'Unauthorized'}} as any);
    const cmd={organizationId:org,entryId:entry,supplierId:supplier,productId:product,
      unitCost:1160,effectiveOn:'2026-11-10',notes:'Supplier price circular #57'};
    await expect(supplierPriceHistoryService.recordQuote(cmd)).rejects.toThrow(/Unauthorized/);
    vi.mocked(supabase!.rpc).mockResolvedValueOnce({
      data:{entry_id:'wrong',idempotent_replay:false},error:null,
    } as any);
    await expect(supplierPriceHistoryService.recordQuote(cmd)).rejects.toThrow(/not confirmed/);
    vi.mocked(supabase!.rpc).mockResolvedValueOnce({
      data:{entry_id:entry,idempotent_replay:true},error:null,
    } as any);
    const replay=await supplierPriceHistoryService.recordQuote(cmd);
    expect(replay.idempotent_replay).toBe(true);
  });
});
