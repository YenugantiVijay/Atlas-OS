import { supabase } from '@/lib/supabase';
import type { ReceiptDeliveryLine } from './goods-receiving.service';

export interface GoodsReceiptFollowUp {
  receipt_id: string;
  supplier_invoice_number: string;
  supplier_name: string;
  received_on: string;
  posted_at: string;
  lines: ReceiptDeliveryLine[];
  resolution_note: string | null;
  resolved_at: string | null;
}

export type FollowUpCursor = Pick<GoodsReceiptFollowUp, 'receipt_id' | 'posted_at'>;

const PAGE_SIZE = 25;

export const goodsReceiptFollowUpService = {
  async list(organizationId: string, resolved: boolean, after: FollowUpCursor | undefined, signal: AbortSignal) {
    if (!supabase) throw new Error('Cloud backend is unavailable.');
    const { data, error } = await supabase.rpc('list_goods_receipt_follow_ups', {
      p_org_id: organizationId,
      p_resolved: resolved,
      p_after_posted_at: after?.posted_at ?? null,
      p_after_receipt_id: after?.receipt_id ?? null,
    }).abortSignal(signal);
    if (error) throw new Error(error.code === 'PGRST202'
      ? 'Supplier follow-up is unavailable on this database.'
      : 'Unable to load supplier follow-ups. ' + error.message);
    if (!Array.isArray(data)) throw new Error('Supplier follow-ups could not be confirmed.');
    const rows: GoodsReceiptFollowUp[] = data.slice(0, PAGE_SIZE);
    const last = rows[rows.length - 1];
    const next = data.length > PAGE_SIZE ? { receipt_id: last.receipt_id, posted_at: last.posted_at } : null;
    return { rows, next };
  },

  async resolve(organizationId: string, receiptId: string, note: string) {
    if (!supabase) throw new Error('Cloud backend is unavailable.');
    const { data, error } = await supabase.rpc('resolve_goods_receipt_follow_up', {
      p_org_id: organizationId,
      p_receipt_id: receiptId,
      p_resolution_note: note,
    });
    if (error) throw new Error(error.code === '23505'
      ? 'This follow-up is already resolved. Refresh to see the recorded note.'
      : 'Unable to resolve the follow-up. ' + error.message);
    if (data?.receipt_id !== receiptId || typeof data?.idempotent_replay !== 'boolean') {
      throw new Error('The database did not confirm this resolution.');
    }
  },
};
