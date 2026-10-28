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

export const inventoryService = {
  async getStockMovements(
    orgId: string,
    productId?: string,
    isMockAuth: boolean = false
  ): Promise<StockMovement[]> {
    if (isMockAuth || !supabase) {
      return storage.getStockMovements(orgId);
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
    isMockAuth: boolean = false
  ): Promise<StockMovement> {
    if (isMockAuth || !supabase) {
      return storage.adjustStock(orgId, productId, quantityChange, notes);
    }

    const payload = {
      organization_id: orgId,
      product_id: productId,
      quantity_change: quantityChange,
      movement_type: 'ADJUSTMENT',
      reference_type: 'MANUAL_ADJUSTMENT',
      notes: notes.trim(),
    };

    const { data, error } = await supabase
      .from('stock_movements')
      .insert(payload)
      .select('*, products(*)')
      .single();

    if (error) {
      throw new Error(`Failed to adjust stock: ${error.message}`);
    }

    return mapDbStockMovement(data);
  },

  async getProductStock(
    orgId: string,
    productId: string,
    isMockAuth: boolean = false
  ): Promise<number> {
    if (isMockAuth || !supabase) {
      const movements = storage.getStockMovements(orgId);
      return movements
        .filter((m) => m.productId === productId)
        .reduce((sum, m) => sum + m.quantityChange, 0);
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
