import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CounterShiftPage } from './CounterShiftPage';
import { useOrg } from '@/features/organizations/OrgContext';
import { useActionPermission } from '@/hooks/useActionPermission';
import { counterShiftsService } from '@/services/counter-shifts.service';
import { paymentsService } from '@/services/payments.service';

vi.mock('@/features/organizations/OrgContext', () => ({ useOrg: vi.fn() }));
vi.mock('@/hooks/useActionPermission', () => ({ useActionPermission: vi.fn() }));
vi.mock('@/services/counter-shifts.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/counter-shifts.service')>();
  return {
    ...actual,
    counterShiftsService: {
      getLatestShift: vi.fn(),
      getShiftPayments: vi.fn(),
      getLinkedPaymentIds: vi.fn(),
      openShift: vi.fn(),
      linkPayment: vi.fn(),
      closeShift: vi.fn(),
    },
  };
});
vi.mock('@/services/payments.service', () => ({ paymentsService: { getPayments: vi.fn() } }));

const check = vi.fn();
const shift = {
  id: 'shift-1',
  organizationId: 'org-1',
  openedBy: 'user-1',
  openedAt: '2026-11-15T08:00:00.000Z',
  openingCash: 500,
  status: 'OPEN' as const,
  idempotencyKey: 'key-1',
};
const payment = {
  id: 'payment-1',
  organizationId: 'org-1',
  paymentNumber: 'RCT-001',
  customerId: 'customer-1',
  customer: { name: 'Walk-in' },
  amount: 125,
  paymentMethod: 'CASH' as const,
  paymentDate: '2026-11-15',
  createdAt: '2026-11-15T08:30:00.000Z',
};
let linked = false;
let shiftState: typeof shift | { status: 'CLOSED'; expectedCash: number; closingCash: number; variance: number } = shift;

describe('Counter shift cash reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    linked = false;
    shiftState = shift;
    vi.mocked(useOrg).mockReturnValue({
      currentOrg: { id: 'org-1', name: 'Stall' },
      isMockAuth: false,
    } as any);
    check.mockReturnValue({ allowed: true });
    vi.mocked(useActionPermission).mockReturnValue({ check, can: vi.fn() } as any);
    vi.mocked(counterShiftsService.getLatestShift).mockImplementation(async () => shiftState as any);
    vi.mocked(counterShiftsService.getShiftPayments).mockResolvedValue([
      { ...payment, customerName: payment.customer?.name },
    ] as any);
    vi.mocked(counterShiftsService.getLinkedPaymentIds).mockImplementation(async () => linked ? ['payment-1'] : []);
    vi.mocked(counterShiftsService.linkPayment).mockImplementation(async () => { linked = true; });
    vi.mocked(counterShiftsService.closeShift).mockImplementation(async (_orgId, _shiftId, closingCash) => {
      shiftState = { status: 'CLOSED', expectedCash: 625, closingCash, variance: closingCash - 625 } as any;
      return shiftState as any;
    });
    vi.mocked(paymentsService.getPayments).mockResolvedValue([payment] as any);
  });

  it('requires every receipt to be assigned and reconciles counted cash against linked cash receipts', async () => {
    render(<MemoryRouter><CounterShiftPage/></MemoryRouter>);
    expect(await screen.findByText(/1 unassigned/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close shift/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Assign/ }));
    await waitFor(() => expect(counterShiftsService.linkPayment).toHaveBeenCalledWith(
      'org-1', 'shift-1', 'payment-1', false,
    ));
    fireEvent.change(screen.getByLabelText('Counted cash in drawer'), { target: { value: '625' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Close shift/ })).toBeEnabled());
    expect(screen.getByText('Preview variance:')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Close shift/ }));
    await waitFor(() => expect(counterShiftsService.closeShift).toHaveBeenCalledWith(
      'org-1', 'shift-1', 625, false,
    ));
  });
});
