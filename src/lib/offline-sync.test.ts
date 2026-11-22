import { beforeEach, describe, expect, it, vi } from 'vitest';
import { offlineQueue } from './offline-queue';

const mocked = vi.hoisted(() => ({
  invoice: vi.fn(),
  payment: vi.fn(),
  stock: vi.fn(),
  order: vi.fn(),
}));

vi.mock('@/services/invoices.service', () => ({
  invoicesService: { createInvoice: mocked.invoice },
}));
vi.mock('@/services/payments.service', () => ({
  paymentsService: { recordPayment: mocked.payment },
}));
vi.mock('@/services/inventory.service', () => ({
  inventoryService: { adjustStock: mocked.stock },
}));
vi.mock('@/services/orders.service', () => ({
  ordersService: { createSalesOrder: mocked.order },
}));

import { flushOfflineSync } from './offline-sync';

describe('Offline financial replay: server confirmation and idempotency', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocked.invoice.mockResolvedValue({ id: 'invoice-server-1' });
    mocked.payment.mockResolvedValue({ id: 'payment-server-1' });
    mocked.stock.mockResolvedValue({ id: 'stock-server-1' });
    mocked.order.mockResolvedValue({ id: 'order-server-1' });
  });

  it('discovers every organization when no tenant is supplied and preserves keys', async () => {
    offlineQueue.enqueue('tenant-a', 'RECORD_PAYMENT', { amount: 250, customerId: 'c1' }, { idempotencyKey: 'payment-key' });
    offlineQueue.enqueue('tenant-b', 'CREATE_INVOICE', { customerId: 'c2', items: [] }, { idempotencyKey: 'invoice-key' });
    expect(offlineQueue.getAll()).toHaveLength(2);
    expect(offlineQueue.getAll('tenant-a')).toHaveLength(1);

    const result = await flushOfflineSync();
    expect(result).toMatchObject({ processed: 2, succeeded: 2, failed: 0 });
    expect(mocked.payment).toHaveBeenCalledWith('tenant-a', expect.objectContaining({ idempotencyKey: 'payment-key' }), false);
    expect(mocked.invoice).toHaveBeenCalledWith('tenant-b', expect.objectContaining({ idempotencyKey: 'invoice-key' }), false);
    expect(offlineQueue.getSummary('tenant-a').synced).toBe(1);
    expect(offlineQueue.getSummary('tenant-b').synced).toBe(1);
  });

  it('never marks offline-optimistic payment as committed', async () => {
    mocked.payment.mockResolvedValue({ id: 'pay-offline-pending' });
    offlineQueue.enqueue('tenant-a', 'RECORD_PAYMENT', { amount: 150 }, { idempotencyKey: 'stable-key' });
    const result = await flushOfflineSync('tenant-a');
    expect(result).toMatchObject({ succeeded: 0, failed: 1 });
    expect(offlineQueue.getSummary('tenant-a').failed).toBe(1);
    expect(offlineQueue.getAll('tenant-a')[0].lastError).toMatch(/server confirmation/);
    const again = await flushOfflineSync('tenant-a');
    expect(again.processed).toBe(0); // manual retry required after an uncertain outcome
    expect(mocked.payment).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown actions instead of recording a false success', async () => {
    offlineQueue.enqueue('tenant-a', 'RECEIVE_GOODS', { receiptId: 'receipt-1' });
    const result = await flushOfflineSync('tenant-a');
    expect(result).toMatchObject({ succeeded: 0, failed: 1 });
    expect(offlineQueue.getAll('tenant-a')[0].lastError).toMatch(/Unsupported offline action/);
  });

  it('preserves idempotency when explicitly retried after a transient error', async () => {
    mocked.invoice.mockRejectedValueOnce(new Error('network error')).mockResolvedValueOnce({ id: 'invoice-server-2' });
    const action = offlineQueue.enqueue('tenant-a', 'CREATE_INVOICE', { items: [] }, { idempotencyKey: 'repeatable-key' });
    expect((await flushOfflineSync('tenant-a')).failed).toBe(1);
    expect(offlineQueue.retry('tenant-a', action.id)).toBe(true);
    expect((await flushOfflineSync('tenant-a')).succeeded).toBe(1);
    expect(mocked.invoice).toHaveBeenNthCalledWith(1, 'tenant-a', expect.objectContaining({ idempotencyKey: 'repeatable-key' }), false);
    expect(mocked.invoice).toHaveBeenNthCalledWith(2, 'tenant-a', expect.objectContaining({ idempotencyKey: 'repeatable-key' }), false);
  });

  it('never treats optimistic stock or invoice records as server-committed', async () => {
    mocked.stock.mockResolvedValue({ id: 'mov-offline-key' });
    mocked.invoice.mockResolvedValue({ id: 'inv-offline-key' });
    offlineQueue.enqueue('tenant-a', 'ADJUST_STOCK', { productId: 'p1', quantityChange: 2, notes: 'count' }, { idempotencyKey: 'stock-key' });
    offlineQueue.enqueue('tenant-a', 'CREATE_INVOICE', { items: [] }, { idempotencyKey: 'invoice-key' });
    const result = await flushOfflineSync('tenant-a');
    expect(result).toMatchObject({ succeeded: 0, failed: 2 });
    expect(mocked.stock).toHaveBeenCalledWith('tenant-a', 'p1', 2, 'count', 'stock-key', false);
  });

  it('preserves concurrently enqueued actions when new mutations arrive mid-sync (P1-01 fix)', async () => {
    let releaseFirstSync!: () => void;
    const firstSyncPromise = new Promise<void>((resolve) => {
      releaseFirstSync = resolve;
    });

    mocked.payment.mockImplementationOnce(async () => {
      // Simulate slow network request awaiting server response
      await firstSyncPromise;
      return { id: 'payment-server-slow' };
    });

    // 1. Initial pending action
    offlineQueue.enqueue('tenant-a', 'RECORD_PAYMENT', { amount: 500 }, { idempotencyKey: 'in-flight-key' });

    // 2. Start sync in background
    const syncPromise = flushOfflineSync('tenant-a');

    // 3. User enqueues another action while first action is awaiting server response
    offlineQueue.enqueue('tenant-a', 'CREATE_INVOICE', { items: [{ sku: 'WIRE-1' }] }, { idempotencyKey: 'mid-flight-key' });

    // Verify both exist in localStorage at this moment
    expect(offlineQueue.getAll('tenant-a')).toHaveLength(2);

    // 4. Server finally responds to first action
    releaseFirstSync();
    const result = await syncPromise;

    expect(result.succeeded).toBe(1);
    expect(result.processed).toBe(1);

    // 5. Critical check: The newly enqueued item must NOT be overwritten by the stale initial snapshot
    const allItems = offlineQueue.getAll('tenant-a');
    expect(allItems).toHaveLength(2);
    const midFlightAction = allItems.find((i) => i.idempotencyKey === 'mid-flight-key');
    expect(midFlightAction).toBeDefined();
    expect(midFlightAction?.status).toBe('pending');
    expect(offlineQueue.getSummary('tenant-a').pending).toBe(1);
    expect(offlineQueue.getSummary('tenant-a').synced).toBe(1);
  });
});
