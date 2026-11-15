import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));

import { counterShiftsService, summarizeCounterShiftCash } from './counter-shifts.service';

beforeEach(() => rpc.mockReset());

describe('counter shift cash summary', () => {
  it('adds only linked cash receipts to the opening float', () => {
    expect(summarizeCounterShiftCash(500, [
      { amount: 125.5, paymentMethod: 'CASH' },
      { amount: 200, paymentMethod: 'UPI' },
      { amount: 74.5, paymentMethod: 'CASH' },
    ])).toEqual({
      expectedCash: 700,
      cashReceipts: 200,
      nonCashReceipts: 200,
      receiptCount: 3,
    });
  });

  it('preserves zero totals and rejects invalid drawer amounts', () => {
    expect(summarizeCounterShiftCash(0, [])).toEqual({
      expectedCash: 0,
      cashReceipts: 0,
      nonCashReceipts: 0,
      receiptCount: 0,
    });
    expect(() => summarizeCounterShiftCash(-1, [])).toThrow('Opening cash');
    expect(() => summarizeCounterShiftCash(10, [{ amount: Number.NaN, paymentMethod: 'CASH' }])).toThrow('Receipt amounts');
  });

  it('loads the minimal receipt projection through the authorized shift RPC', async () => {
    rpc.mockResolvedValue({
      data: [{
        id: 'payment-1',
        organization_id: 'org-1',
        payment_number: 'RCT-001',
        customer_id: 'customer-1',
        customer_name: 'Walk-in',
        amount: '125.50',
        payment_method: 'CASH',
        payment_date: '2026-11-15',
        created_at: '2026-11-15T08:30:00.000Z',
      }],
      error: null,
    });

    await expect(counterShiftsService.getShiftPayments(
      'org-1',
      'shift-1',
      '2026-11-15T08:00:00.000Z',
    )).resolves.toEqual([{
      id: 'payment-1',
      organizationId: 'org-1',
      paymentNumber: 'RCT-001',
      customerId: 'customer-1',
      customerName: 'Walk-in',
      amount: 125.5,
      paymentMethod: 'CASH',
      paymentDate: '2026-11-15',
      createdAt: '2026-11-15T08:30:00.000Z',
    }]);
    expect(rpc).toHaveBeenCalledWith('get_counter_shift_receipts', {
      p_org_id: 'org-1',
      p_shift_id: 'shift-1',
    });
  });
});
