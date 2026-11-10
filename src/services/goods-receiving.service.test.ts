import { beforeEach, describe, expect, it, vi } from 'vitest';
import { goodsReceivingService } from './goods-receiving.service';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn() },
}));

const orgId='11111111-2222-4333-8444-555555555555';
const receiptId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const supplierId='99999999-8888-4777-8666-555555555555';
const command={
  organizationId:orgId,
  receiptId,
  supplierId,
  supplierInvoiceNumber:'  INV-1001  ',
  receivedOn:'2026-11-10',
  notes:'  Factory seal intact  ',
  lines:[{productId:'99999999-1111-4222-8333-444444444444',packageCounts:[12,10],looseUnits:4,unitCost:250.5}],
};

describe('Goods Receiving service — no fake stock success',()=>{
  beforeEach(()=>vi.clearAllMocks());

  it('only calls the draft RPC with normalized fields, never direct table DML', async()=>{
    vi.mocked(supabase!.rpc).mockResolvedValue({
      data:{receipt_id:receiptId,status:'DRAFT'},error:null,
    } as any);
    await expect(goodsReceivingService.saveDraft(command)).resolves.toEqual({
      receipt_id:receiptId,status:'DRAFT',
    });
    expect(supabase!.rpc).toHaveBeenCalledExactlyOnceWith('save_goods_receipt_draft',{
      p_org_id:orgId,p_receipt_id:receiptId,p_supplier_id:supplierId,
      p_supplier_invoice_number:'INV-1001',p_received_on:'2026-11-10',
      p_notes:'Factory seal intact',p_lines:command.lines,
    });
    expect(supabase!.from).not.toHaveBeenCalled();
  });

  it('does not report successful saving on backend failure or mismatched response', async()=>{
    vi.mocked(supabase!.rpc).mockResolvedValueOnce({data:null,error:{message:'Access denied'}} as any);
    await expect(goodsReceivingService.saveDraft(command)).rejects.toThrow(/Access denied/);
    vi.mocked(supabase!.rpc).mockResolvedValueOnce({data:{receipt_id:'other',status:'DRAFT'},error:null} as any);
    await expect(goodsReceivingService.saveDraft(command)).rejects.toThrow(/not confirmed/);
  });

  it('posts only through the authorized receipt RPC and verifies returned identity',async()=>{
    vi.mocked(supabase!.rpc).mockResolvedValueOnce({
      data:{receipt_id:receiptId,status:'POSTED',idempotent_replay:false},error:null,
    } as any);
    const result=await goodsReceivingService.post(orgId,receiptId);
    expect(result.idempotent_replay).toBe(false);
    expect(supabase!.rpc).toHaveBeenCalledWith('post_goods_receipt',{
      p_org_id:orgId,p_receipt_id:receiptId,
    });
    expect(supabase!.from).not.toHaveBeenCalled();
  });

  it('rejects false positive or failed posting responses',async()=>{
    vi.mocked(supabase!.rpc).mockResolvedValueOnce({
      data:{receipt_id:receiptId,status:'DRAFT'},error:null,
    } as any);
    await expect(goodsReceivingService.post(orgId,receiptId)).rejects.toThrow(/not confirmed/);
    vi.mocked(supabase!.rpc).mockResolvedValueOnce({data:null,error:{message:'Role denied'}} as any);
    await expect(goodsReceivingService.post(orgId,receiptId)).rejects.toThrow(/Role denied/);
  });

  it('lists only scoped latest 50 receipts and maps the stored line snapshots',async()=>{
    const row={
      id:receiptId,organization_id:orgId,supplier_id:supplierId,
      supplier_invoice_number:'INV-1001',received_on:'2026-11-10',
      notes:'Note',status:'DRAFT',created_at:'2026-11-10T12:00:00Z',
      updated_at:'2026-11-10T12:00:00Z',
      lines:[{productId:command.lines[0].productId,packageCounts:[12,10],
        looseUnits:4,totalUnits:26,unitCost:250.5,sku:'AB',uom:'Nos',productName:'Example'}],
    };
    const q={
      select:vi.fn().mockReturnThis(),
      eq:vi.fn().mockReturnThis(),
      order:vi.fn().mockReturnThis(),
      limit:vi.fn().mockResolvedValue({data:[row],error:null}),
    };
    vi.mocked(supabase!.from).mockReturnValue(q as any);
    const receipts=await goodsReceivingService.list(orgId);
    expect(supabase!.from).toHaveBeenCalledWith('goods_receipts');
    expect(q.eq).toHaveBeenCalledWith('organization_id',orgId);
    expect(q.limit).toHaveBeenCalledWith(50);
    expect(receipts[0]).toMatchObject({
      id:receiptId,organizationId:orgId,status:'DRAFT',
      lines:[{totalUnits:26,sku:'AB'}],
    });
  });
});
