import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';
import { StockMovement, MovementType } from '@/types';
import { mapDbProduct } from './products.service';

export function mapDbStockMovement(row: any): StockMovement {
  return {
    id: row.id,
    organizationId: row.organization_id,
    productId: row.product_id,
    quantityChange: Number(row.quantity_change),
    movementType: row.movement_type as MovementType,
    referenceType: row.reference_type || undefined,
    referenceId: row.reference_id || undefined,
    actorId: row.actor_id || undefined,
    notes: row.notes || undefined,
    createdAt: row.created_at,
    product: row.products ? mapDbProduct(row.products) : undefined,
  };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const inventoryService = {
  async getStockMovements(
    orgId: string,
    productId?: string,
    isMockAuth: boolean = false
  ): Promise<StockMovement[]> {
    if (isMockAuth) {
      return storage.getStockMovements(orgId);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    let query = supabase
      .from('stock_movements')
      .select('*, products(*)')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    if (productId && productId !== 'ALL') {
      query = query.eq('product_id', productId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch stock movements: ${error.message}`);
    }

    return (data || []).map(mapDbStockMovement);
  },

  async adjustStock(
    orgId: string,
    productId: string,
    quantityChange: number,
    notes: string,
    idempotencyKey: string,
    isMockAuth: boolean = false
  ): Promise<StockMovement> {
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || !UUID_REGEX.test(idempotencyKey.trim())) {
      throw new Error(
        `A valid UUID idempotency key is required for inventory adjustments (got: "${idempotencyKey}")`
      );
    }

    const trimmedKey = idempotencyKey.trim();

    if (isMockAuth) {
      return storage.adjustStock(orgId, productId, quantityChange, notes, trimmedKey);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    if (!notes || !notes.trim()) {
      throw new Error('An audit note is required for all manual inventory adjustments');
    }

    if (quantityChange === 0) {
      throw new Error('Adjustment quantity cannot be 0.');
    }

    // Authoritative atomic RPC invocation: executes serialized product row lock,
    // resulting non-negative stock validation, audit logging, and mandatory idempotency tracking.
    const { data, error } = await supabase.rpc('record_stock_adjustment', {
      p_org_id: orgId,
      p_product_id: productId,
      p_quantity_change: quantityChange,
      p_notes: notes.trim(),
      p_idempotency_key: trimmedKey,
    });

    if (error) {
      throw new Error(`Failed to adjust stock: ${error.message}`);
    }

    const movementId = data?.movement_id;
    if (movementId) {
      const { data: movementRow, error: fetchErr } = await supabase
        .from('stock_movements')
        .select('*, products(*)')
        .eq('id', movementId)
        .single();

      if (!fetchErr && movementRow) {
        return mapDbStockMovement(movementRow);
      }
    }

    return {
      id: movementId || 'mov-' + Date.now(),
      organizationId: orgId,
      productId,
      quantityChange,
      movementType: 'ADJUSTMENT',
      referenceType: 'MANUAL_ADJUSTMENT',
      notes: notes.trim(),
      createdAt: new Date().toISOString(),
    };
  },

  async getProductStock(
    orgId: string,
    productId: string,
    isMockAuth: boolean = false
  ): Promise<number> {
    if (isMockAuth) {
      const movements = storage.getStockMovements(orgId);
      return movements
        .filter((m) => m.productId === productId)
        .reduce((sum, m) => sum + m.quantityChange, 0);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const { data, error } = await supabase.rpc('get_product_stock', {
      p_product_id: productId,
      p_org_id: orgId,
    });

    if (error) {
      throw new Error(`Failed to calculate stock: ${error.message}`);
    }

    return Number(data) || 0;
  },
};
