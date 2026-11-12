import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { goodsReceiptFollowUpService, type GoodsReceiptFollowUp } from '@/services/goods-receipt-follow-up.service';
import { SupplierFollowUpPage } from './SupplierFollowUpPage';

const state = vi.hoisted(() => ({ canResolve: true }));
vi.mock('@/features/organizations/OrgContext', () => ({
  useOrg: () => ({ currentOrg: { id: 'org-a' }, currentUser: { id: 'operator-a' }, currentRole: 'inventory', isMockAuth: false }),
}));
vi.mock('@/hooks/useActionPermission', () => ({
  useActionPermission: () => ({ check: (action: string) => ({
    allowed: action === 'data:read' || state.canResolve,
    message: action === 'inventory:receive' && !state.canResolve ? 'Your trial has expired.' : undefined,
  }) }),
}));
vi.mock('@/services/goods-receipt-follow-up.service', () => ({
  goodsReceiptFollowUpService: { list: vi.fn(), resolve: vi.fn() },
}));

const entry: GoodsReceiptFollowUp = {
  receipt_id: 'receipt-a', supplier_invoice_number: 'INV-204', supplier_name: 'Supplier A',
  received_on: '2026-11-12', posted_at: '2026-11-12T07:30:00Z',
  lines: [{ productId: 'switch', productName: 'Modular switch', sku: 'SW-12', totalUnits: 98, billedUnits: 100, damagedUnits: 3 }],
  resolution_note: null, resolved_at: null,
};

function openPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><SupplierFollowUpPage /></MemoryRouter></QueryClientProvider>);
}

describe('Supplier Follow-up', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    state.canResolve = true;
    vi.mocked(goodsReceiptFollowUpService.list).mockResolvedValue({ rows: [entry], next: null });
  });

  it('keeps a failed note for retry and shows a confirmed resolution in history', async () => {
    const note = 'Supplier issued credit CN-42 and replaced the damaged units.';
    let isResolved = false;
    const completed = { ...entry, resolution_note: note, resolved_at: '2026-11-12T09:00:00Z' };
    vi.mocked(goodsReceiptFollowUpService.list).mockImplementation(async (_, resolved) => {
      if (resolved !== isResolved) return { rows: [], next: null };
      return { rows: [resolved ? completed : entry], next: null };
    });
    vi.mocked(goodsReceiptFollowUpService.resolve)
      .mockRejectedValueOnce(new Error('Connection lost. Try again.'))
      .mockImplementationOnce(async () => { isResolved = true; });
    openPage();

    const receipt = await screen.findByRole('article', { name: 'INV-204' });
    fireEvent.click(within(receipt).getByText(/View delivery details/));
    const counts = within(receipt).getByRole('table', { name: 'Delivery details for INV-204' });
    expect(within(counts).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['100', '98', '3', '95', '2', '0']);
    fireEvent.click(within(receipt).getByRole('button', { name: 'Record resolution' }));
    const field = within(receipt).getByLabelText('Resolution note');
    const submit = within(receipt).getByRole('button', { name: 'Mark resolved' });
    expect(submit).toBeDisabled();
    fireEvent.change(field, { target: { value: '  ' + note + '  ' } });
    fireEvent.click(submit);
    expect(await within(receipt).findByRole('alert')).toHaveTextContent('Connection lost. Try again.');
    expect(field).toHaveValue('  ' + note + '  ');
    fireEvent.click(submit);
    expect(await screen.findByText('Follow-up resolved for INV-204.')).toBeVisible();
    expect(await screen.findByText('No open supplier follow-ups.')).toBeVisible();
    expect(goodsReceiptFollowUpService.resolve).toHaveBeenNthCalledWith(2, 'org-a', 'receipt-a', note);

    const resolved = screen.getByRole('button', { name: 'Resolved' });
    await waitFor(() => expect(resolved).toBeEnabled());
    fireEvent.click(resolved);
    expect(await screen.findByText(note)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Record resolution' })).not.toBeInTheDocument();
  });

  it('shows permitted history when operational writes are restricted', async () => {
    state.canResolve = false;
    openPage();
    expect(await screen.findByRole('article', { name: 'INV-204' })).toBeVisible();
    expect(screen.getByText('Your trial has expired.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Record resolution' })).not.toBeInTheDocument();
  });
});
