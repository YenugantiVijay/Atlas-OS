import { supabase } from '@/lib/supabase';
import type { ReceiptPayloadLine } from '@/features/receiving/receiving-worksheet';

export interface GoodsReceiptRecord {
  id: string;
  organizationId: string;
  supplierId: string;
  supplierInvoiceNumber: string;
  receivedOn: string;
  notes: string;
  lines: Array<ReceiptPayloadLine & {
    productName: string;
    sku: string;
    uom: string;
    totalUnits: number;
  }>;
  status: 'DRAFT' | 'POSTED';
  postedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface SaveReceiptCommand {
  organizationId: string;
  receiptId: string;
  supplierId: string;
  supplierInvoiceNumber: string;
  receivedOn: string;
  notes: string;
  lines: ReceiptPayloadLine[];
}
const cloudOnly = () => {
  if (!supabase) throw new Error('Cloud backend is not configured.');
  return supabase;
};
const mapReceipt = (row: any): GoodsReceiptRecord => ({
  id: row.id,
  organizationId: row.organization_id,
  supplierId: row.supplier_id,
  supplierInvoiceNumber: row.supplier_invoice_number,
  receivedOn: row.received_on,
  notes: row.notes || '',
  lines: row.lines ?? [],
  status: row.status,
  postedAt: row.posted_at || undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Cloud-only V1: never claim Demo Mode stock was posted without a matching
 * deterministic goods-receipt ledger implementation. No direct table DML. */
export const goodsReceivingService = {
  async list(organizationId: string): Promise<GoodsReceiptRecord[]> {
    const { data, error } = await cloudOnly().from('goods_receipts')
      .select('*').eq('organization_id', organizationId)
      .order('updated_at', { ascending: false }).limit(50);
    if (error) throw new Error('Unable to load goods receipts: ' + error.message);
    return (data || []).map(mapReceipt);
  },
  async saveDraft(command: SaveReceiptCommand): Promise<{ receipt_id: string; status: 'DRAFT' }> {
    const { data, error } = await cloudOnly().rpc('save_goods_receipt_draft', {
      p_org_id: command.organizationId,
      p_receipt_id: command.receiptId,
      p_supplier_id: command.supplierId,
      p_supplier_invoice_number: command.supplierInvoiceNumber.trim(),
      p_received_on: command.receivedOn,
      p_notes: command.notes.trim(),
      p_lines: command.lines,
    });
    if (error) throw new Error('Unable to save receiving draft: ' + error.message);
    if (!data || data.receipt_id !== command.receiptId || data.status !== 'DRAFT') {
      throw new Error('Receiving draft response was not confirmed by the database.');
    }
    return data;
  },
  async post(organizationId: string, receiptId: string): Promise<{
    receipt_id: string;
    status: 'POSTED';
    idempotent_replay: boolean;
  }> {
    const { data, error } = await cloudOnly().rpc('post_goods_receipt', {
      p_org_id: organizationId,
      p_receipt_id: receiptId,
    });
    if (error) throw new Error('Unable to post goods receipt: ' + error.message);
    if (!data || data.receipt_id !== receiptId || data.status !== 'POSTED') {
      throw new Error('Goods receipt posting was not confirmed by the database.');
    }
    return data;
  },
};
