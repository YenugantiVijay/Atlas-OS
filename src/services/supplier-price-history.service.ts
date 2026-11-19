import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';

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
    asOf?: string;
    limit?: number;
  }, isMockAuth: boolean = false): Promise<SupplierPriceEntry[]> {
    const limit = Math.min(100, Math.max(1, filters?.limit ?? 60));
    if (isMockAuth || !supabase) {
      const all = storage.getItem<SupplierPriceEntry[]>('atlas_supplier_price_history_v1', []);
      let filtered = all.filter((entry) => entry.organizationId === organizationId);
      if (filters?.supplierId) filtered = filtered.filter((e) => e.supplierId === filters.supplierId);
      if (filters?.productId) filtered = filtered.filter((e) => e.productId === filters.productId);
      if (filters?.asOf) filtered = filtered.filter((e) => e.effectiveOn <= filters.asOf!);
      filtered.sort((a, b) => {
        const dateDiff = new Date(b.effectiveOn).getTime() - new Date(a.effectiveOn).getTime();
        if (dateDiff !== 0) return dateDiff;
        return new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime();
      });
      return filtered.slice(0, limit);
    }
    let query = requireCloud().from('supplier_price_history')
      .select('*')
      .eq('organization_id', organizationId);
    if (filters?.supplierId) query = query.eq('supplier_id', filters.supplierId);
    if (filters?.productId) query = query.eq('product_id', filters.productId);
    if (filters?.asOf) query = query.lte('effective_on', filters.asOf);
    const { data, error } = await query
      .order('effective_on', { ascending: false })
      .order('recorded_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);
    if (error) throw new Error('Failed to load supplier price history: ' + error.message);
    return (data || []).map(mapHistory);
  },
  /** Manual notices only. Actual receipt prices originate in a database trigger. */
  async recordQuote(command: RecordSupplierQuote, isMockAuth: boolean = false): Promise<{
    entry_id: string;
    idempotent_replay: boolean;
    previous_rate: number | null;
    recorded_rate: number;
  }> {
    if (isMockAuth || !supabase) {
      const all = storage.getItem<SupplierPriceEntry[]>('atlas_supplier_price_history_v1', []);
      const existing = all.find((e) => e.id === command.entryId && e.organizationId === command.organizationId);
      if (existing) {
        return {
          entry_id: command.entryId,
          idempotent_replay: true,
          previous_rate: null,
          recorded_rate: existing.unitCost,
        };
      }
      const suppliers = storage.getSuppliers(command.organizationId);
      const supplier = suppliers.find((s) => s.id === command.supplierId);
      const products = storage.getProducts(command.organizationId);
      const product = products.find((p) => p.id === command.productId);

      const previousEntry = all
        .filter((e) => e.organizationId === command.organizationId && e.supplierId === command.supplierId && e.productId === command.productId)
        .sort((a, b) => new Date(b.effectiveOn).getTime() - new Date(a.effectiveOn).getTime())[0];
      const previous_rate = previousEntry ? previousEntry.unitCost : null;

      const newEntry: SupplierPriceEntry = {
        id: command.entryId,
        organizationId: command.organizationId,
        supplierId: command.supplierId,
        supplierName: supplier?.companyName?.trim() || supplier?.name || 'Demo Supplier',
        productId: command.productId,
        productName: product?.name || 'Demo Product',
        productSku: product?.sku || 'DEMO-SKU',
        productUom: product?.uom || 'Nos',
        unitCost: command.unitCost,
        effectiveOn: command.effectiveOn,
        sourceType: 'SUPPLIER_QUOTE',
        sourceReference: command.notes.trim() || 'Manual Demo Quote',
        notes: command.notes.trim(),
        actorId: 'demo-user',
        recordedAt: new Date().toISOString(),
      };
      all.unshift(newEntry);
      storage.setItem('atlas_supplier_price_history_v1', all);
      return {
        entry_id: command.entryId,
        idempotent_replay: false,
        previous_rate,
        recorded_rate: command.unitCost,
      };
    }
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
