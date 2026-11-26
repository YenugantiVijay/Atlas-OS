import { beforeEach, describe, expect, it, vi } from 'vitest';
import { offlineQueue } from '@/lib/offline-queue';
import { flushOfflineSync } from '@/lib/offline-sync';
import { invoicesService } from '@/services/invoices.service';
import { paymentsService } from '@/services/payments.service';
import { inventoryService } from '@/services/inventory.service';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

const mockSupabase = supabase as unknown as {
  rpc: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
};

describe('Pending Action Queue & Server Confirmation', () => {
  const orgId = 'org-offline-test';

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('preserves an invoice recovery request but rejects unconfirmed success', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Failed to fetch', code: 'FETCH_ERROR' },
    });

    await expect(invoicesService.createInvoice(
      orgId,
      {
        customerId: 'cust-1',
        invoiceDate: '2026-11-19',
        dueDate: '2026-11-19',
        items: [
          {
            productId: 'prod-1',
            productName: 'LED Panel',
            productSku: 'LED-01',
            uom: 'Nos',
            quantity: 2,
            unitPrice: 500,
            taxRate: 18,
          },
        ],
      },
      false
    )).rejects.toThrow('Pending server confirmation');

    const queued = offlineQueue.getAll(orgId);
    expect(queued).toHaveLength(1);
    expect(queued[0].actionType).toBe('CREATE_INVOICE');
    expect(queued[0].status).toBe('pending');
  });

  it('preserves a payment recovery request but never fabricates a receipt', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'TypeError: Failed to fetch', code: 'FETCH_ERROR' },
    });

    await expect(paymentsService.recordPayment(
      orgId,
      {
        customerId: 'cust-1',
        amount: 1180,
        paymentMethod: 'UPI',
        paymentDate: '2026-11-19',
        referenceNumber: 'UPI-REF-1234',
      },
      false
    )).rejects.toThrow('Pending server confirmation');

    const queued = offlineQueue.getAll(orgId);
    expect(queued).toHaveLength(1);
    expect(queued[0].actionType).toBe('RECORD_PAYMENT');
  });

  it('preserves a stock recovery request but rejects unconfirmed movement', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'NetworkError when attempting to fetch resource', code: 'NETWORK_ERROR' },
    });

    const uuid = '00000000-0000-0000-0000-000000000001';
    await expect(inventoryService.adjustStock(
      orgId,
      'prod-1',
      5,
      'Physical verification',
      uuid,
      false
    )).rejects.toThrow('Pending server confirmation');

    const queued = offlineQueue.getAll(orgId);
    expect(queued).toHaveLength(1);
    expect(queued[0].actionType).toBe('ADJUST_STOCK');
  });

  it.each(['invoice', 'payment', 'stock'] as const)('keeps %s pending while disconnected, without calling the backend or returning a posted record', async (kind) => {
    const connectivity = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const key = '00000000-0000-0000-0000-000000000009';
    try {
      const submit = () => kind === 'invoice'
        ? invoicesService.createInvoice(orgId, { customerId: 'cust-1', invoiceDate: '2026-11-26', dueDate: '2026-11-26', idempotencyKey: key, items: [{ productId: 'p1', productName: 'Product', productSku: 'P1', uom: 'Nos', quantity: 1, unitPrice: 100, taxRate: 18 }] }, false)
        : kind === 'payment'
          ? paymentsService.recordPayment(orgId, { customerId: 'cust-1', amount: 100, paymentMethod: 'CASH', paymentDate: '2026-11-26', idempotencyKey: key }, false)
          : inventoryService.adjustStock(orgId, 'p1', 1, 'Physical count', key, false);
      await expect(submit()).rejects.toThrow('Pending server confirmation');
      await expect(submit()).rejects.toThrow('Pending server confirmation');
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
      expect(offlineQueue.getAll(orgId)).toHaveLength(1);
      expect(offlineQueue.getAll(orgId)[0]).toMatchObject({ organizationId: orgId, idempotencyKey: key, status: 'pending' });
    } finally { connectivity.mockRestore(); }
  });

  it('flushes queued actions in FIFO order when flushOfflineSync is called', async () => {
    offlineQueue.enqueue(orgId, 'ADJUST_STOCK', { productId: 'p1', quantityChange: 2, notes: 'Count' }, { idempotencyKey: '00000000-0000-0000-0000-000000000001' });
    offlineQueue.enqueue(orgId, 'ADJUST_STOCK', { productId: 'p2', quantityChange: -1, notes: 'Damage' }, { idempotencyKey: '00000000-0000-0000-0000-000000000002' });

    mockSupabase.rpc.mockResolvedValue({
      data: { movement_id: 'mov-synced-1' },
      error: null,
    });
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    });

    const res = await flushOfflineSync(orgId);
    expect(res.processed).toBe(2);
    expect(res.succeeded).toBe(2);
    expect(res.failed).toBe(0);

    const summary = offlineQueue.getSummary(orgId);
    expect(summary.synced).toBe(2);
    expect(summary.pending).toBe(0);
  });
});
