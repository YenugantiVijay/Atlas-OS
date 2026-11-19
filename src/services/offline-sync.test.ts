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

describe('Offline Action Queue & Optimistic Mutations', () => {
  const orgId = 'org-offline-test';

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('enqueues invoice creation on network failure and returns optimistic invoice', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Failed to fetch', code: 'FETCH_ERROR' },
    });

    const invoice = await invoicesService.createInvoice(
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
    );

    expect(invoice.id).toContain('inv-offline');
    expect(invoice.invoiceNumber).toContain('INV-OFFLINE');
    expect(invoice.totalAmount).toBe(1180);

    const queued = offlineQueue.getAll(orgId);
    expect(queued).toHaveLength(1);
    expect(queued[0].actionType).toBe('CREATE_INVOICE');
    expect(queued[0].status).toBe('pending');
  });

  it('enqueues payment recording on network failure and returns optimistic payment', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'TypeError: Failed to fetch', code: 'FETCH_ERROR' },
    });

    const payment = await paymentsService.recordPayment(
      orgId,
      {
        customerId: 'cust-1',
        amount: 1180,
        paymentMethod: 'UPI',
        paymentDate: '2026-11-19',
        referenceNumber: 'UPI-REF-1234',
      },
      false
    );

    expect(payment.id).toContain('pay-offline');
    expect(payment.paymentNumber).toContain('RCP-OFFLINE');
    expect(payment.amount).toBe(1180);

    const queued = offlineQueue.getAll(orgId);
    expect(queued).toHaveLength(1);
    expect(queued[0].actionType).toBe('RECORD_PAYMENT');
  });

  it('enqueues stock adjustment on network failure and returns optimistic stock movement', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'NetworkError when attempting to fetch resource', code: 'NETWORK_ERROR' },
    });

    const uuid = '00000000-0000-0000-0000-000000000001';
    const movement = await inventoryService.adjustStock(
      orgId,
      'prod-1',
      5,
      'Physical verification',
      uuid,
      false
    );

    expect(movement.id).toContain('mov-offline');
    expect(movement.quantityChange).toBe(5);

    const queued = offlineQueue.getAll(orgId);
    expect(queued).toHaveLength(1);
    expect(queued[0].actionType).toBe('ADJUST_STOCK');
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
