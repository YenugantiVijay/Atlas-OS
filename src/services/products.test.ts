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
  it('records opening stock with canonical OPENING_STOCK movement type in cloud mode', async () => {
    let capturedStockPayload: any = null;
    const stockMovementInsertSpy = vi.fn().mockImplementation((payload) => {
      capturedStockPayload = payload;
      return Promise.resolve({ error: null });
    });

    const productInsertSpy = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: sampleDbProductRow,
          error: null,
        }),
      }),
    });

    mockSupabaseInstance = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'products') {
          return { insert: productInsertSpy };
        }
        if (table === 'stock_movements') {
          return { insert: stockMovementInsertSpy };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await productsService.createProduct(
      orgId,
      sampleProductInput,
      false, // isMockAuth = false (Cloud Mode)
      50     // openingStock = 50
    );

    // 1. Verify product insertion was called with correct payload
    expect(productInsertSpy).toHaveBeenCalledTimes(1);

    // 2. Verify stock movement was called
    expect(stockMovementInsertSpy).toHaveBeenCalledTimes(1);

    // 3. DEF-002 Core Assertion: movement_type MUST be 'OPENING_STOCK', never 'OPENING_BALANCE'
    expect(capturedStockPayload).toEqual({
      organization_id: orgId,
      product_id: 'prod-uuid-001',
      quantity_change: 50,
      movement_type: 'OPENING_STOCK',
      reference_type: 'INITIAL_STOCK',
      notes: 'Initial opening stock',
    });

    // 4. Verify returned Product model has currentStock matching openingStock
    expect(result.currentStock).toBe(50);
    expect(result.id).toBe('prod-uuid-001');
    expect(result.sku).toBe('CBL-FR-1.5');
  });

  // Test 2 — Zero opening stock
  it('creates product without recording any stock movement when opening stock is zero', async () => {
    const stockMovementInsertSpy = vi.fn();
    const productInsertSpy = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: sampleDbProductRow,
          error: null,
        }),
      }),
    });

    mockSupabaseInstance = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'products') {
          return { insert: productInsertSpy };
        }
        if (table === 'stock_movements') {
          return { insert: stockMovementInsertSpy };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await productsService.createProduct(
      orgId,
      sampleProductInput,
      false, // isMockAuth = false (Cloud Mode)
      0      // openingStock = 0
    );

    expect(productInsertSpy).toHaveBeenCalledTimes(1);
    expect(stockMovementInsertSpy).not.toHaveBeenCalled();
    expect(result.currentStock).toBe(0);
    expect(result.id).toBe('prod-uuid-001');
  });

  // Test 3 — Stock movement insertion failure
  it('propagates descriptive error when stock movement insertion fails after product creation', async () => {
    const stockMovementInsertSpy = vi.fn().mockResolvedValue({
      error: {
        message: 'new row for relation "stock_movements" violates check constraint "stock_movements_movement_type_check"',
      },
    });

    const productInsertSpy = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: sampleDbProductRow,
          error: null,
        }),
      }),
    });

    mockSupabaseInstance = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'products') {
          return { insert: productInsertSpy };
        }
        if (table === 'stock_movements') {
          return { insert: stockMovementInsertSpy };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    await expect(
      productsService.createProduct(orgId, sampleProductInput, false, 50)
    ).rejects.toThrow(
      'Product created, but failed to record initial stock movement: new row for relation "stock_movements" violates check constraint "stock_movements_movement_type_check"'
    );

    // Confirms that product was inserted first before stock movement failed
    expect(productInsertSpy).toHaveBeenCalledTimes(1);
    expect(stockMovementInsertSpy).toHaveBeenCalledTimes(1);
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
