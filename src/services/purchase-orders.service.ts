import { supabase } from '@/lib/supabase';

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
  async list(organizationId: string, page: number, signal: AbortSignal) {
    const start = (page - 1) * PAGE_SIZE;
    const { data, error } = await cloud().from('purchase_orders').select(
      'id,organization_id,supplier_id,supplier_name,expected_on,notes,lines,status,order_number,ordered_at,updated_at,revision',
    ).eq('organization_id', organizationId).order('updated_at', { ascending: false })
      .order('id', { ascending: false }).range(start, start + PAGE_SIZE).abortSignal(signal);
    if (error) throw new Error(error.code === 'PGRST205'
      ? 'Purchase Orders is unavailable on this database.'
      : 'Unable to load purchase orders. ' + error.message);
    return { rows: (data ?? []).slice(0, PAGE_SIZE) as PurchaseOrder[], hasNext: (data?.length ?? 0) > PAGE_SIZE };
  },

  async searchSuppliers(organizationId: string, term: string, signal: AbortSignal): Promise<PurchaseOrderSupplier[]> {
    const name = term.trim().replace(/[,()":\\%_*]/g, ' ').trim();
    if (name.length < 2) return [];
    const { data, error } = await cloud().from('suppliers').select('id,name,company_name')
      .eq('organization_id', organizationId).eq('is_active', true)
      .or(`name.ilike.%${name}%,company_name.ilike.%${name}%`)
      .order('name').order('id').limit(8).abortSignal(signal);
    if (error) throw new Error('Unable to search suppliers. ' + error.message);
    return (data ?? []).map((row) => ({ id: row.id, name: row.company_name?.trim() || row.name }));
  },

  async saveDraft(organizationId: string, input: SaveDraft): Promise<PurchaseOrder> {
    const { data, error } = await cloud().rpc('save_purchase_order_draft', {
      p_org_id: organizationId, p_order_id: input.id, p_expected_revision: input.revision,
      p_supplier_id: input.supplierId, p_expected_on: input.expectedOn,
      p_notes: input.notes.trim(), p_lines: input.lines,
    });
    if (error) throw new Error(error.message);
    return confirmedOrder(data, organizationId, input.id, 'DRAFT');
  },

  async markOrdered(organizationId: string, id: string, revision: number): Promise<PurchaseOrder> {
    const { data, error } = await cloud().rpc('mark_purchase_order_ordered', {
      p_org_id: organizationId, p_order_id: id, p_expected_revision: revision,
    });
    if (error) throw new Error(error.message);
    const order = confirmedOrder(data, organizationId, id, 'ORDERED');
    if (!order.order_number) throw new Error('The database did not confirm a purchase order number.');
    return order;
  },
};
