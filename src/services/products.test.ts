import { describe, it, expect, beforeEach, vi } from 'vitest';
import { productsService } from './products.service';
import { storage } from '@/lib/storage';
import { Product } from '@/types';

// Controlled mock of @/lib/supabase
let mockSupabaseInstance: any = null;

vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return mockSupabaseInstance;
  },
  validateSupabaseConfig: vi.fn(),
}));

describe('Products Service — DEF-002 Opening Stock Movement Type Regression Tests', () => {
  const orgId = '00000000-0000-0000-0000-000000000001';

  const sampleProductInput: Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'organizationId' | 'currentStock'> = {
    sku: 'CBL-FR-1.5',
    name: 'Polycab 1.5 sq mm Flame Retardant Wire',
    brand: 'Polycab',
    category: 'Wires & Cables',
    description: 'Single core copper wire, Red 90m coil',
    uom: 'Coils',
    purchaseCost: 950,
    sellingPrice: 1200,
    taxRate: 18,
    hsnCode: '8544',
    reorderThreshold: 10,
    isActive: true,
  };

  const sampleDbProductRow = {
    id: 'prod-uuid-001',
    organization_id: orgId,
    sku: 'CBL-FR-1.5',
    name: 'Polycab 1.5 sq mm Flame Retardant Wire',
    brand: 'Polycab',
    category: 'Wires & Cables',
    description: 'Single core copper wire, Red 90m coil',
    image_url: null,
    uom: 'Coils',
    purchase_cost: 950,
    selling_price: 1200,
    tax_rate: 18,
    hsn_code: '8544',
    reorder_threshold: 10,
    is_active: true,
    created_at: '2026-10-31T12:00:00Z',
    updated_at: '2026-10-31T12:00:00Z',
  };

  beforeEach(() => {
    localStorage.clear();
    storage.initialize(true);
    mockSupabaseInstance = null;
    vi.clearAllMocks();
  });

  // Test 1 — Positive opening stock
  it('creates product and records opening stock atomically via create_product_atomic RPC in cloud mode', async () => {
    let capturedRpcParams: any = null;
    const rpcSpy = vi.fn().mockImplementation((fn: string, params: any) => {
      if (fn === 'create_product_atomic') {
        capturedRpcParams = params;
        return Promise.resolve({
          data: {
            ...sampleDbProductRow,
            current_stock: params.p_opening_stock,
          },
          error: null,
        });
      }
      throw new Error(`Unexpected RPC: ${fn}`);
    });

    mockSupabaseInstance = {
      rpc: rpcSpy,
    };

    const result = await productsService.createProduct(
      orgId,
      sampleProductInput,
      false, // isMockAuth = false (Cloud Mode)
      50     // openingStock = 50
    );

    // 1. Verify create_product_atomic RPC was called with correct atomic payload
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(capturedRpcParams).toEqual({
      p_org_id: orgId,
      p_sku: 'CBL-FR-1.5',
      p_name: 'Polycab 1.5 sq mm Flame Retardant Wire',
      p_brand: 'Polycab',
      p_category: 'Wires & Cables',
      p_description: 'Single core copper wire, Red 90m coil',
      p_uom: 'Coils',
      p_purchase_cost: 950,
      p_selling_price: 1200,
      p_tax_rate: 18,
      p_hsn_code: '8544',
      p_reorder_threshold: 10,
      p_is_active: true,
      p_opening_stock: 50,
      p_notes: 'Initial opening stock',
    });

    // 2. Verify returned Product model has currentStock matching openingStock
    expect(result.currentStock).toBe(50);
    expect(result.id).toBe('prod-uuid-001');
    expect(result.sku).toBe('CBL-FR-1.5');
  });

  // Test 2 — Zero opening stock
  it('creates product via create_product_atomic with zero opening stock', async () => {
    let capturedRpcParams: any = null;
    const rpcSpy = vi.fn().mockImplementation((fn: string, params: any) => {
      if (fn === 'create_product_atomic') {
        capturedRpcParams = params;
        return Promise.resolve({
          data: {
            ...sampleDbProductRow,
            current_stock: 0,
          },
          error: null,
        });
      }
      throw new Error(`Unexpected RPC: ${fn}`);
    });

    mockSupabaseInstance = {
      rpc: rpcSpy,
    };

    const result = await productsService.createProduct(
      orgId,
      sampleProductInput,
      false, // isMockAuth = false (Cloud Mode)
      0      // openingStock = 0
    );

    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(capturedRpcParams.p_opening_stock).toBe(0);
    expect(result.currentStock).toBe(0);
    expect(result.id).toBe('prod-uuid-001');
  });

  // Test 3 — Atomic failure propagation
  it('propagates descriptive error when create_product_atomic RPC fails, preventing partial product creation', async () => {
    const rpcSpy = vi.fn().mockResolvedValue({
      data: null,
      error: {
        message: 'Product with SKU "CBL-FR-1.5" already exists in organization ' + orgId,
      },
    });

    mockSupabaseInstance = {
      rpc: rpcSpy,
    };

    await expect(
      productsService.createProduct(orgId, sampleProductInput, false, 50)
    ).rejects.toThrow(
      'Failed to create product: Product with SKU "CBL-FR-1.5" already exists in organization ' + orgId
    );

    expect(rpcSpy).toHaveBeenCalledTimes(1);
  });

  // Test 4 — Mock mode compatibility
  it('records opening stock using canonical OPENING_STOCK in mock/demo storage mode', async () => {
    const result = await productsService.createProduct(
      orgId,
      sampleProductInput,
      true, // isMockAuth = true (Mock/Demo Mode)
      75    // openingStock = 75
    );

    expect(result.currentStock).toBe(75);
    expect(result.sku).toBe('CBL-FR-1.5');

    // Verify storage recorded the movement with canonical 'OPENING_STOCK'
    const movements = storage.getStockMovements(orgId);
    const openingMovement = movements.find((m) => m.productId === result.id);

    expect(openingMovement).toBeDefined();
    expect(openingMovement?.movementType).toBe('OPENING_STOCK');
    expect(openingMovement?.quantityChange).toBe(75);
    expect(openingMovement?.notes).toBe('Initial opening stock');
  });
});
