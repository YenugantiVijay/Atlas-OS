import { supabase } from '@/lib/supabase';

export type SupplierPriceSource = 'SUPPLIER_QUOTE' | 'GOODS_RECEIPT';

export interface SupplierPriceEntry {
  id: string;
  organizationId: string;
  supplierId: string;
  supplierName: string;
  productId: string;
  productName: string;
  productSku: string;
  productUom: string;
  unitCost: number;
  effectiveOn: string;
  sourceType: SupplierPriceSource;
  sourceReceiptId?: string;
  sourceReference: string;
  notes: string;
  actorId: string;
  recordedAt: string;
}

export interface RecordSupplierQuote {
  organizationId: string;
  entryId: string;
  supplierId: string;
  productId: string;
  unitCost: number;
  effectiveOn: string;
  notes: string;
}

const requireCloud = () => {
  if (!supabase) throw new Error('Supplier rate history requires a configured cloud backend.');
  return supabase;
};

function mapHistory(row: any): SupplierPriceEntry {
  return {
    id: row.id,
    organizationId: row.organization_id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    productId: row.product_id,
    productName: row.product_name,
    productSku: row.product_sku,
    productUom: row.product_uom,
    unitCost: Number(row.unit_cost),
    effectiveOn: row.effective_on,
    sourceType: row.source_type,
    sourceReceiptId: row.source_receipt_id || undefined,
    sourceReference: row.source_reference || '',
    notes: row.notes || '',
    actorId: row.actor_id,
    recordedAt: row.recorded_at,
  };
}

export const supplierPriceHistoryService = {
  /** Bounded and tenant-scoped. RLS additionally excludes unauthorized roles. */
  async list(organizationId: string, filters?: {
    supplierId?: string;
    productId?: string;
    limit?: number;
  }): Promise<SupplierPriceEntry[]> {
    const limit = Math.min(100, Math.max(1, filters?.limit ?? 60));
    let query = requireCloud().from('supplier_price_history')
      .select('*')
      .eq('organization_id', organizationId);
    if (filters?.supplierId) query = query.eq('supplier_id', filters.supplierId);
    if (filters?.productId) query = query.eq('product_id', filters.productId);
    const { data, error } = await query
      .order('effective_on', { ascending: false })
      .order('recorded_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);
    if (error) throw new Error('Failed to load supplier price history: ' + error.message);
    return (data || []).map(mapHistory);
  },
  /** Manual notices only. Actual receipt prices originate in a database trigger. */
  async recordQuote(command: RecordSupplierQuote): Promise<{
    entry_id: string;
    idempotent_replay: boolean;
    previous_rate: number | null;
    recorded_rate: number;
  }> {
    const { data, error } = await requireCloud().rpc('record_supplier_price_quote', {
      p_org_id: command.organizationId,
      p_entry_id: command.entryId,
      p_supplier_id: command.supplierId,
      p_product_id: command.productId,
      p_unit_cost: command.unitCost,
      p_effective_on: command.effectiveOn,
      p_notes: command.notes.trim(),
    });
    if (error) throw new Error('Unable to record supplier price: ' + error.message);
    if (!data || data.entry_id !== command.entryId ||
        typeof data.idempotent_replay !== 'boolean') {
      throw new Error('Supplier rate update was not confirmed by the database.');
    }
    return {
      entry_id: data.entry_id,
      idempotent_replay: data.idempotent_replay,
      previous_rate: data.previous_rate == null ? null : Number(data.previous_rate),
      recorded_rate: data.recorded_rate == null ? command.unitCost : Number(data.recorded_rate),
    };
  },
};
