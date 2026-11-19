import { supabase } from '@/lib/supabase';
import { storage, STORAGE_KEYS } from '@/lib/storage';

export interface PurchaseOrderLineInput {
  productId: string;
  uom: string;
  quantity: number;
  unitCost: number;
}

export interface PurchaseOrderLine extends PurchaseOrderLineInput {
  productName: string;
  sku: string;
}

export interface PurchaseOrder {
  id: string;
  organization_id: string;
  supplier_id: string;
  supplier_name: string;
  expected_on: string | null;
  notes: string;
  lines: PurchaseOrderLine[];
  status: 'DRAFT' | 'ORDERED';
  order_number: string | null;
  ordered_at: string | null;
  updated_at: string;
  revision: number;
}

export interface PurchaseOrderSupplier { id: string; name: string }

interface SaveDraft {
  id: string;
  revision: number | null;
  supplierId: string;
  expectedOn: string | null;
  notes: string;
  lines: PurchaseOrderLineInput[];
}

const PAGE_SIZE = 20;
const cloud = () => {
  if (!supabase) throw new Error('Cloud backend is unavailable.');
  return supabase;
};

function confirmedOrder(order: PurchaseOrder | null, organizationId: string, id: string, status: PurchaseOrder['status']) {
  if (order?.id !== id || order.organization_id !== organizationId || order.status !== status || !Number.isInteger(order.revision)) {
    throw new Error('The database did not confirm the purchase order update.');
  }
  return order;
}

export const purchaseOrdersService = {
  async list(organizationId: string, page: number, signal?: AbortSignal, isMockAuth: boolean = false) {
    if (isMockAuth || !supabase) {
      const all = storage.getItem<PurchaseOrder[]>(STORAGE_KEYS.PURCHASE_ORDERS, []);
      const orgOrders = all
        .filter((o) => o.organization_id === organizationId)
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      const start = (page - 1) * PAGE_SIZE;
      const rows = orgOrders.slice(start, start + PAGE_SIZE);
      const hasNext = orgOrders.length > start + PAGE_SIZE;
      return { rows, hasNext };
    }
    const start = (page - 1) * PAGE_SIZE;
    const query = cloud().from('purchase_orders').select(
      'id,organization_id,supplier_id,supplier_name,expected_on,notes,lines,status,order_number,ordered_at,updated_at,revision',
    ).eq('organization_id', organizationId).order('updated_at', { ascending: false })
      .order('id', { ascending: false }).range(start, start + PAGE_SIZE);
    if (signal) query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw new Error(error.code === 'PGRST205'
      ? 'Purchase Orders is unavailable on this database.'
      : 'Unable to load purchase orders. ' + error.message);
    return { rows: (data ?? []).slice(0, PAGE_SIZE) as PurchaseOrder[], hasNext: (data?.length ?? 0) > PAGE_SIZE };
  },

  async searchSuppliers(organizationId: string, term: string, signal?: AbortSignal, isMockAuth: boolean = false): Promise<PurchaseOrderSupplier[]> {
    const name = term.trim().replace(/[,()":\\%_*]/g, ' ').trim();
    if (name.length < 2) return [];
    if (isMockAuth || !supabase) {
      const suppliers = storage.getSuppliers(organizationId);
      const lower = name.toLowerCase();
      const matched = suppliers
        .filter((s) => s.isActive && (s.name.toLowerCase().includes(lower) || (s.companyName && s.companyName.toLowerCase().includes(lower))))
        .slice(0, 8);
      return matched.map((s) => ({ id: s.id, name: s.companyName?.trim() || s.name }));
    }
    const query = cloud().from('suppliers').select('id,name,company_name')
      .eq('organization_id', organizationId).eq('is_active', true)
      .or(`name.ilike.%${name}%,company_name.ilike.%${name}%`)
      .order('name').order('id').limit(8);
    if (signal) query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw new Error('Unable to search suppliers. ' + error.message);
    return (data ?? []).map((row) => ({ id: row.id, name: row.company_name?.trim() || row.name }));
  },

  async saveDraft(organizationId: string, input: SaveDraft, isMockAuth: boolean = false): Promise<PurchaseOrder> {
    if (isMockAuth || !supabase) {
      const all = storage.getItem<PurchaseOrder[]>(STORAGE_KEYS.PURCHASE_ORDERS, []);
      const suppliers = storage.getSuppliers(organizationId);
      const supplier = suppliers.find((s) => s.id === input.supplierId);
      const products = storage.getProducts(organizationId);
      const lines: PurchaseOrderLine[] = input.lines.map((l) => {
        const prod = products.find((p) => p.id === l.productId);
        return {
          ...l,
          productName: prod?.name || 'Item',
          sku: prod?.sku || 'SKU',
        };
      });
      const existingIdx = all.findIndex((o) => o.id === input.id && o.organization_id === organizationId);
      const now = new Date().toISOString();
      const revision = existingIdx >= 0 ? (all[existingIdx].revision + 1) : 1;
      const draft: PurchaseOrder = {
        id: input.id,
        organization_id: organizationId,
        supplier_id: input.supplierId,
        supplier_name: supplier?.companyName?.trim() || supplier?.name || 'Supplier',
        expected_on: input.expectedOn,
        notes: input.notes.trim(),
        lines,
        status: 'DRAFT',
        order_number: existingIdx >= 0 ? all[existingIdx].order_number : null,
        ordered_at: existingIdx >= 0 ? all[existingIdx].ordered_at : null,
        updated_at: now,
        revision,
      };
      if (existingIdx >= 0) {
        all[existingIdx] = draft;
      } else {
        all.unshift(draft);
      }
      storage.setItem(STORAGE_KEYS.PURCHASE_ORDERS, all);
      return draft;
    }
    const { data, error } = await cloud().rpc('save_purchase_order_draft', {
      p_org_id: organizationId, p_order_id: input.id, p_expected_revision: input.revision,
      p_supplier_id: input.supplierId, p_expected_on: input.expectedOn,
      p_notes: input.notes.trim(), p_lines: input.lines,
    });
    if (error) throw new Error(error.message);
    return confirmedOrder(data, organizationId, input.id, 'DRAFT');
  },

  async markOrdered(organizationId: string, id: string, revision: number, isMockAuth: boolean = false): Promise<PurchaseOrder> {
    if (isMockAuth || !supabase) {
      const all = storage.getItem<PurchaseOrder[]>(STORAGE_KEYS.PURCHASE_ORDERS, []);
      const existing = all.find((o) => o.id === id && o.organization_id === organizationId);
      if (!existing) throw new Error('Purchase order not found.');
      const now = new Date().toISOString();
      const orderedCount = all.filter((o) => o.status === 'ORDERED').length;
      existing.status = 'ORDERED';
      existing.ordered_at = now;
      existing.updated_at = now;
      existing.revision = revision + 1;
      if (!existing.order_number) {
        existing.order_number = `PO-${new Date().getFullYear()}-${String(orderedCount + 1).padStart(4, '0')}`;
      }
      storage.setItem(STORAGE_KEYS.PURCHASE_ORDERS, all);
      return existing;
    }
    const { data, error } = await cloud().rpc('mark_purchase_order_ordered', {
      p_org_id: organizationId, p_order_id: id, p_expected_revision: revision,
    });
    if (error) throw new Error(error.message);
    const order = confirmedOrder(data, organizationId, id, 'ORDERED');
    if (!order.order_number) throw new Error('The database did not confirm a purchase order number.');
    return order;
  },
};
