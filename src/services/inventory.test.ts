/**
 * Inventory Service & Sprint 1 Stock Invariant Test Suite
 *
 * Validates the critical inventory integrity requirements:
 * 1. Stock adjustment leaving positive balance succeeds.
 * 2. Adjustment bringing stock to exactly zero succeeds.
 * 3. Adjustment making stock negative is strictly rejected.
 * 4. Sales-order confirmation with insufficient stock is rejected.
 * 5. Valid sales-order confirmation deducts stock exactly once.
 * 6. Unauthorized user cannot create stock movements.
 * 7. Cross-organization product mutation is strictly rejected.
 * 8. Failed operation leaves zero partial movement or document mutation.
 * 9. Repeating the same idempotent request does not duplicate movements.
 * 10. Concurrent operations against the same product cannot collectively produce negative stock.
 * 11. Concurrent sales deduction and inventory adjustment cannot bypass stock validation.
 * 12. Retry after a failed operation behaves consistently.
 * 13. Cloud mode calls authoritative RPC `record_stock_adjustment` and maps results.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { inventoryService } from './inventory.service';
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

describe('Inventory Integrity & Stock Mutation Invariant Suite (Sprint 1)', () => {
  const orgA = '00000000-0000-0000-0000-000000000001';
  const orgB = '00000000-0000-0000-0000-000000000002';

  let testProductA: Product;
  let testProductB: Product;
  let testCustomer: any;

  beforeEach(() => {
    localStorage.clear();
    storage.initialize(true);
    mockSupabaseInstance = null;
    vi.clearAllMocks();

    testCustomer = storage.createCustomer(orgA, {
      name: 'Sri Balaji Electricals',
      phone: '9876543210',
      email: 'balaji@example.com',
      gstin: '36AAACB1234F1Z1',
      creditLimit: 100000,
      creditDays: 30,
      billingAddress: 'Main Road, Hyderabad, Telangana 500001',
      isActive: true,
    });

    // Create test products with known initial opening stock
    testProductA = storage.createProduct(
      orgA,
      {
        sku: 'CBL-CU-01',
        name: 'Polycab 2.5 sq mm Copper Wire',
        brand: 'Polycab',
        category: 'Wires & Cables',
        description: 'Single core copper wire, Red 90m coil',
        uom: 'Coils',
        purchaseCost: 1500,
        sellingPrice: 1850,
        taxRate: 18,
        hsnCode: '8544',
        reorderThreshold: 10,
        isActive: true,
      },
      20 // Initial opening stock: 20 coils
    );

    testProductB = storage.createProduct(
      orgB,
      {
        sku: 'SW-MOD-01',
        name: 'Anchor Roma 6A Modular Switch',
        brand: 'Anchor',
        category: 'Switchgear',
        description: 'White 1M modular switch',
        uom: 'Nos',
        purchaseCost: 35,
        sellingPrice: 55,
        taxRate: 18,
        hsnCode: '8536',
        reorderThreshold: 50,
        isActive: true,
      },
      10 // Initial opening stock: 10 units
    );
  });

  // --------------------------------------------------------------------------
  // TEST 1: Stock adjustment that leaves a positive balance succeeds
  // --------------------------------------------------------------------------
  it('allows a stock adjustment that leaves a positive balance', async () => {
    const initialStock = await inventoryService.getProductStock(orgA, testProductA.id, true);
    expect(initialStock).toBe(20);

    // Deduct 8 coils -> Leaves 12 coils
    const movement = await inventoryService.adjustStock(
      orgA,
      testProductA.id,
      -8,
      'Physical stock audit count reconciliation',
      '00000000-0000-0000-0000-000000000001',
      true
    );

    expect(movement.id).toBeDefined();
    expect(movement.quantityChange).toBe(-8);
    expect(movement.movementType).toBe('ADJUSTMENT');

    const newStock = await inventoryService.getProductStock(orgA, testProductA.id, true);
    expect(newStock).toBe(12);
  });

  // --------------------------------------------------------------------------
  // TEST 2: Adjustment that brings stock to exactly zero succeeds
  // --------------------------------------------------------------------------
  it('allows an adjustment that brings stock to exactly zero', async () => {
    const initialStock = await inventoryService.getProductStock(orgA, testProductA.id, true);
    expect(initialStock).toBe(20);

    // Deduct all 20 coils -> Leaves exactly 0
    const movement = await inventoryService.adjustStock(
      orgA,
      testProductA.id,
      -20,
      'Batch scrap write-off for damaged inventory',
      '00000000-0000-0000-0000-000000000002',
      true
    );

    expect(movement.quantityChange).toBe(-20);

    const newStock = await inventoryService.getProductStock(orgA, testProductA.id, true);
    expect(newStock).toBe(0);
  });

  // --------------------------------------------------------------------------
  // TEST 3: Adjustment that would make stock negative is rejected
  // --------------------------------------------------------------------------
  it('strictly rejects a stock adjustment that would drive stock below zero', async () => {
    const initialStock = await inventoryService.getProductStock(orgA, testProductA.id, true);
    expect(initialStock).toBe(20);

    // Attempt to deduct 21 coils (when only 20 exist)
    await expect(
      inventoryService.adjustStock(
        orgA,
        testProductA.id,
        -21,
        'Attempting excess deduction',
        '00000000-0000-0000-0000-000000000003',
        true
      )
    ).rejects.toThrow(/Insufficient stock for product.*Negative stock is not permitted/i);

    // Verify stock remains unmodified at 20
    const stockAfterRejection = await inventoryService.getProductStock(orgA, testProductA.id, true);
    expect(stockAfterRejection).toBe(20);
  });

  // --------------------------------------------------------------------------
  // TEST 4: Sales-order confirmation with insufficient stock is rejected
  // --------------------------------------------------------------------------
  it('rejects sales-order confirmation when requested quantity exceeds available stock', () => {
    // Current stock of product A in org A is 20
    const order = storage.createSalesOrder(orgA, {
      customerId: testCustomer.id,
      orderDate: '2026-11-01',
      notes: 'Heavy contractor site order',
      items: [
        {
          productId: testProductA.id,
          productSku: testProductA.sku,
          productName: testProductA.name,
          quantity: 25, // Demands 25 coils, but only 20 exist
          unitPrice: 1850,
          taxRate: 18,
          lineTotal: 25 * 1850,
        },
      ],
    });

    expect(() => storage.confirmSalesOrder(orgA, order.id, 'owner')).toThrow(
      /Insufficient stock for product.*Available: 20, Required: 25/i
    );

    // Verify order remains DRAFT and no stock deducted
    const fetchedOrder = storage.getSalesOrders(orgA).find((o) => o.id === order.id);
    expect(fetchedOrder?.status).toBe('DRAFT');

    const stock = storage.getProductById(orgA, testProductA.id)?.currentStock;
    expect(stock).toBe(20);
  });

  // --------------------------------------------------------------------------
  // TEST 5: Valid sales-order confirmation deducts stock exactly once
  // --------------------------------------------------------------------------
  it('deducts stock exactly once upon valid sales-order confirmation', () => {
    const order = storage.createSalesOrder(orgA, {
      customerId: testCustomer.id,
      orderDate: '2026-11-01',
      items: [
        {
          productId: testProductA.id,
          productSku: testProductA.sku,
          productName: testProductA.name,
          quantity: 7, // 20 - 7 = 13
          unitPrice: 1850,
          taxRate: 18,
          lineTotal: 7 * 1850,
        },
      ],
    });

    const confirmed = storage.confirmSalesOrder(orgA, order.id, 'sales');
    expect(confirmed.status).toBe('CONFIRMED');

    const stock = storage.getProductById(orgA, testProductA.id)?.currentStock;
    expect(stock).toBe(13);

    // Verify movement recorded
    const movements = storage.getStockMovements(orgA).filter((m) => m.productId === testProductA.id);
    const salesMovements = movements.filter((m) => m.movementType === 'SALES_DISPATCH');
    expect(salesMovements).toHaveLength(1);
    expect(salesMovements[0].quantityChange).toBe(-7);
  });

  // --------------------------------------------------------------------------
  // TEST 6: Unauthorized user cannot create stock movements
  // --------------------------------------------------------------------------
  it('rejects order confirmation when user lacks inventory or sales role', () => {
    const order = storage.createSalesOrder(orgA, {
      customerId: testCustomer.id,
      orderDate: '2026-11-01',
      items: [
        {
          productId: testProductA.id,
          productSku: testProductA.sku,
          productName: testProductA.name,
          quantity: 2,
          unitPrice: 1850,
          taxRate: 18,
          lineTotal: 2 * 1850,
        },
      ],
    });

    // Attempting confirmation as unauthorized viewer or unassigned role
    expect(() => storage.confirmSalesOrder(orgA, order.id, null as any)).toThrow(
      /Permission denied: Role "unassigned" cannot confirm sales orders/i
    );
  });

  // --------------------------------------------------------------------------
  // TEST 7: Cross-organization product mutation is strictly rejected
  // --------------------------------------------------------------------------
  it('strictly rejects mutating a product belonging to a different organization', async () => {
    // Attempt to adjust Org B's product using Org A's tenant scope
    await expect(
      inventoryService.adjustStock(
        orgA,
        testProductB.id, // belongs to orgB
        -2,
        'Cross tenant malicious deduction attempt',
        '00000000-0000-0000-0000-000000000007',
        true
      )
    ).rejects.toThrow(/Product not found in this organization/i);

    // Verify Org B's product stock was unaffected
    const orgBStock = await inventoryService.getProductStock(orgB, testProductB.id, true);
    expect(orgBStock).toBe(10);
  });

  // --------------------------------------------------------------------------
  // TEST 8: Failed operation leaves zero partial movement or document mutation
  // --------------------------------------------------------------------------
  it('guarantees that a failed stock operation leaves no partial state or phantom movements', async () => {
    const movementsBefore = storage.getStockMovements(orgA);

    await expect(
      inventoryService.adjustStock(
        orgA,
        testProductA.id,
        -999,
        'Violating adjustment',
        '00000000-0000-0000-0000-000000000008',
        true
      )
    ).rejects.toThrow();

    const movementsAfter = storage.getStockMovements(orgA);
    expect(movementsAfter.length).toBe(movementsBefore.length);
  });

  // --------------------------------------------------------------------------
  // TEST 9: Repeating the same idempotent request does not duplicate the movement
  // --------------------------------------------------------------------------
  it('prevents duplicate stock deductions when repeating the same idempotent request', async () => {
    const idempotencyKey = 'c0000000-0000-0000-0000-000000000099';

    // Initial adjustment: deduct 5 coils
    const firstAttempt = await inventoryService.adjustStock(
      orgA,
      testProductA.id,
      -5,
      'Initial cycle count variance',
      idempotencyKey,
      true
    );

    expect(firstAttempt.quantityChange).toBe(-5);
    const stockAfterFirst = await inventoryService.getProductStock(orgA, testProductA.id, true);
    expect(stockAfterFirst).toBe(15);

    // Replay with identical key and payload: MUST return existing movement without re-deducting
    const replayAttempt = await inventoryService.adjustStock(
      orgA,
      testProductA.id,
      -5,
      'Initial cycle count variance',
      idempotencyKey,
      true
    );

    expect(replayAttempt.id).toBe(firstAttempt.id);

    // Verify stock is STILL 15, NOT 10!
    const stockAfterReplay = await inventoryService.getProductStock(orgA, testProductA.id, true);
    expect(stockAfterReplay).toBe(15);
  });

  // --------------------------------------------------------------------------
  // TEST 10: Concurrent operations against the same product cannot collectively produce negative stock
  // --------------------------------------------------------------------------
  it('serializes concurrent deductions so they cannot collectively drive stock negative', async () => {
    // Current stock is 20 coils.
    // Concurrently launch 3 deduction requests of 8 coils each (3 * 8 = 24 coils demanded, but only 20 available).
    const attempts = [
      inventoryService.adjustStock(orgA, testProductA.id, -8, 'Concurrent deduction 1', '00000000-0000-0000-0000-000000000010', true),
      inventoryService.adjustStock(orgA, testProductA.id, -8, 'Concurrent deduction 2', '00000000-0000-0000-0000-000000000020', true),
      inventoryService.adjustStock(orgA, testProductA.id, -8, 'Concurrent deduction 3', '00000000-0000-0000-0000-000000000030', true),
    ];

    const results = await Promise.allSettled(attempts);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly 2 operations of 8 can succeed (16 coils). The 3rd (requiring 24 total) must be rejected!
    expect(succeeded.length).toBe(2);
    expect(rejected.length).toBe(1);

    const finalStock = await inventoryService.getProductStock(orgA, testProductA.id, true);
    expect(finalStock).toBe(4); // 20 - 16 = 4 coils remaining (strictly >= 0)
    expect(finalStock).toBeGreaterThanOrEqual(0);
  });

  // --------------------------------------------------------------------------
  // TEST 11: Concurrent sales deduction and inventory adjustment cannot bypass validation
  // --------------------------------------------------------------------------
  it('coordinates order confirmations and adjustments so race conditions cannot breach stock balance', async () => {
    // Current stock is 20 coils.
    const order = storage.createSalesOrder(orgA, {
      customerId: testCustomer.id,
      orderDate: '2026-11-01',
      items: [
        {
          productId: testProductA.id,
          productSku: testProductA.sku,
          productName: testProductA.name,
          quantity: 15, // demands 15
          unitPrice: 1850,
          taxRate: 18,
          lineTotal: 15 * 1850,
        },
      ],
    });

    // Concurrently: Confirm order for 15 coils AND adjust stock by -10 coils (15 + 10 = 25 > 20)
    const taskA = Promise.resolve().then(() => storage.confirmSalesOrder(orgA, order.id, 'owner'));
    const taskB = inventoryService.adjustStock(
      orgA,
      testProductA.id,
      -10,
      'Concurrent audit adjustment',
      '00000000-0000-0000-0000-000000000040',
      true
    );

    const [resA, resB] = await Promise.allSettled([taskA, taskB]);

    // One must succeed, and the second must be rejected due to insufficient stock!
    const fulfilledCount = [resA, resB].filter((r) => r.status === 'fulfilled').length;
    const rejectedCount = [resA, resB].filter((r) => r.status === 'rejected').length;

    expect(fulfilledCount).toBe(1);
    expect(rejectedCount).toBe(1);

    const finalStock = await inventoryService.getProductStock(orgA, testProductA.id, true);
    expect(finalStock).toBeGreaterThanOrEqual(0);
  });

  // --------------------------------------------------------------------------
  // TEST 12: Retry after a failed operation behaves consistently
  // --------------------------------------------------------------------------
  it('permits a valid retry after a previous failure with identical or corrected parameters', async () => {
    // 1. Initial attempt fails because quantity is too large (-50 on 20)
    await expect(
      inventoryService.adjustStock(
        orgA,
        testProductA.id,
        -50,
        'Excess deduction',
        '00000000-0000-0000-0000-000000000051',
        true
      )
    ).rejects.toThrow(/Insufficient stock/);

    // 2. Retry with a valid quantity (-5) on the same product
    const retryMovement = await inventoryService.adjustStock(
      orgA,
      testProductA.id,
      -5,
      'Corrected deduction',
      '00000000-0000-0000-0000-000000000052',
      true
    );

    expect(retryMovement.quantityChange).toBe(-5);
    const finalStock = await inventoryService.getProductStock(orgA, testProductA.id, true);
    expect(finalStock).toBe(15);
  });

  // --------------------------------------------------------------------------
  // TEST 13: Cloud mode calls authoritative RPC `record_stock_adjustment`
  // --------------------------------------------------------------------------
  it('invokes record_stock_adjustment RPC in cloud mode and maps the created movement', async () => {
    const mockMovementId = 'mov-uuid-12345';
    let rpcCalledWith: any = null;

    mockSupabaseInstance = {
      rpc: vi.fn().mockImplementation((fn: string, params: any) => {
        if (fn === 'record_stock_adjustment') {
          rpcCalledWith = params;
          return Promise.resolve({
            data: {
              success: true,
              movement_id: mockMovementId,
              product_id: testProductA.id,
              quantity_change: -4,
              resulting_stock: 16,
              idempotent_replay: false,
            },
            error: null,
          });
        }
        throw new Error(`Unexpected RPC: ${fn}`);
      }),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'stock_movements') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: mockMovementId,
                    organization_id: orgA,
                    product_id: testProductA.id,
                    quantity_change: -4,
                    movement_type: 'ADJUSTMENT',
                    reference_type: 'MANUAL_ADJUSTMENT',
                    actor_id: 'usr-001',
                    notes: 'Cloud manual adjustment',
                    created_at: '2026-11-01T12:00:00Z',
                    products: {
                      id: testProductA.id,
                      name: testProductA.name,
                      sku: testProductA.sku,
                    },
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await inventoryService.adjustStock(
      orgA,
      testProductA.id,
      -4,
      'Cloud manual adjustment',
      '00000000-0000-0000-0000-000000000077',
      false // isMockAuth = false (Cloud Mode)
    );

    expect(rpcCalledWith).toEqual({
      p_org_id: orgA,
      p_product_id: testProductA.id,
      p_quantity_change: -4,
      p_notes: 'Cloud manual adjustment',
      p_idempotency_key: '00000000-0000-0000-0000-000000000077',
    });

    expect(result.id).toBe(mockMovementId);
    expect(result.quantityChange).toBe(-4);
  });

  // --------------------------------------------------------------------------
  // TEST 14: Cloud mode propagates database error when RPC rejects negative stock
  // --------------------------------------------------------------------------
  it('propagates descriptive error when record_stock_adjustment RPC rejects negative stock', async () => {
    mockSupabaseInstance = {
      rpc: vi.fn().mockImplementation((fn: string) => {
        if (fn === 'record_stock_adjustment') {
          return Promise.resolve({
            data: null,
            error: {
              message:
                'Insufficient stock for product "Polycab Copper Wire" (SKU: CBL-CU-01). Available: 5, Requested change: -10, Resulting balance: -5 (Negative stock is not permitted)',
            },
          });
        }
        throw new Error(`Unexpected RPC: ${fn}`);
      }),
    };

    await expect(
      inventoryService.adjustStock(
        orgA,
        testProductA.id,
        -10,
        'Attempting excess deduction in cloud',
        '00000000-0000-0000-0000-000000000088',
        false
      )
    ).rejects.toThrow(
      'Failed to adjust stock: Insufficient stock for product "Polycab Copper Wire" (SKU: CBL-CU-01). Available: 5, Requested change: -10, Resulting balance: -5 (Negative stock is not permitted)'
    );
  });

  // --------------------------------------------------------------------------
  // TEST 15: Missing or malformed idempotency key is rejected
  // --------------------------------------------------------------------------
  it('rejects adjustment when idempotency key is missing or malformed', async () => {
    // Missing key
    await expect(
      inventoryService.adjustStock(
        orgA,
        testProductA.id,
        -2,
        'Missing key test',
        '' as any,
        false
      )
    ).rejects.toThrow(/A valid UUID idempotency key is required/i);

    // Malformed key
    await expect(
      inventoryService.adjustStock(
        orgA,
        testProductA.id,
        -2,
        'Malformed key test',
        'not-a-valid-uuid',
        false
      )
    ).rejects.toThrow(/A valid UUID idempotency key is required/i);
  });

  // --------------------------------------------------------------------------
  // TEST 16: Same idempotency key with different payload is rejected as conflict
  // --------------------------------------------------------------------------
  it('rejects adjustment when same idempotency key is reused with a different payload', async () => {
    const sharedKey = '00000000-0000-0000-0000-000000000099';

    // First call with quantity = -2
    const first = await inventoryService.adjustStock(
      orgA,
      testProductA.id,
      -2,
      'First valid payload',
      sharedKey,
      true
    );
    expect(first.quantityChange).toBe(-2);

    // Reusing same key with quantity = -5 (different payload) must throw
    await expect(
      inventoryService.adjustStock(
        orgA,
        testProductA.id,
        -5, // Different quantity
        'Conflicting second payload',
        sharedKey,
        true
      )
    ).rejects.toThrow(/Idempotency conflict/i);
  });

  // --------------------------------------------------------------------------
  // TEST 17: Double submission does not duplicate the stock movement
  // --------------------------------------------------------------------------
  it('ensures rapid double submission with same key returns original movement without double deduction', async () => {
    const rapidKey = '00000000-0000-0000-0000-000000000055';
    const initialStock = await inventoryService.getProductStock(orgA, testProductA.id, true);

    // Fire two calls concurrently with the same idempotency key
    const [res1, res2] = await Promise.all([
      inventoryService.adjustStock(orgA, testProductA.id, -3, 'Rapid double click', rapidKey, true),
      inventoryService.adjustStock(orgA, testProductA.id, -3, 'Rapid double click', rapidKey, true),
    ]);

    // Both calls must resolve to the identical movement ID
    expect(res1.id).toBe(res2.id);

    // Stock must be deducted exactly once (-3, not -6)
    const finalStock = await inventoryService.getProductStock(orgA, testProductA.id, true);
    expect(finalStock).toBe(initialStock - 3);
  });

  // --------------------------------------------------------------------------
  // TEST 18: Retry after timeout/network error uses the original key safely
  // --------------------------------------------------------------------------
  it('recovers safely on retry using the original idempotency key after ambiguous timeout', async () => {
    const timeoutKey = '00000000-0000-0000-0000-000000000033';

    // Initial submission succeeds on backend
    const committedMovement = await inventoryService.adjustStock(
      orgA,
      testProductA.id,
      -4,
      'Network timeout simulation',
      timeoutKey,
      true
    );

    // Client retries using the exact same key and payload (retaining key across retry)
    const retryResult = await inventoryService.adjustStock(
      orgA,
      testProductA.id,
      -4,
      'Network timeout simulation',
      timeoutKey,
      true
    );

    expect(retryResult.id).toBe(committedMovement.id);
    expect(retryResult.quantityChange).toBe(-4);
  });

  // --------------------------------------------------------------------------
  // TEST 19: Different organizations can use independent idempotency keys
  // --------------------------------------------------------------------------
  it('allows different organizations to use the same idempotency key independently', async () => {
    const sharedKey = '00000000-0000-0000-0000-000000000011';

    // Org A uses key
    const movA = await inventoryService.adjustStock(
      orgA,
      testProductA.id,
      -2,
      'Org A Adjustment',
      sharedKey,
      true
    );

    // Org B uses identical key for its own product without collision
    const movB = await inventoryService.adjustStock(
      orgB,
      testProductB.id,
      -3,
      'Org B Adjustment',
      sharedKey,
      true
    );

    expect(movA.organizationId).toBe(orgA);
    expect(movB.organizationId).toBe(orgB);
    expect(movA.id).not.toBe(movB.id);
  });
});
