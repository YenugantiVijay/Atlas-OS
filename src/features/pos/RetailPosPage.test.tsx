import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RetailPosPage } from './RetailPosPage';
import { useOrg } from '@/features/organizations/OrgContext';
import { useActionPermission } from '@/hooks/useActionPermission';
import { productsService } from '@/services/products.service';
import { productAlternativesService } from '@/services/product-alternatives.service';
import { customersService } from '@/services/customers.service';
import { ordersService } from '@/services/orders.service';
import { invoicesService } from '@/services/invoices.service';
import { paymentsService } from '@/services/payments.service';
import { counterCheckoutService } from '@/services/counter-checkout.service';
import { counterShiftsService } from '@/services/counter-shifts.service';
import { searchCustomerDirectory } from '@/services/customer-directory-search.service';

vi.mock('@/features/organizations/OrgContext', () => ({ useOrg: vi.fn() }));
vi.mock('@/hooks/useActionPermission', () => ({ useActionPermission: vi.fn() }));
vi.mock('@/services/products.service', () => ({
  productsService: { getProductsPaginated: vi.fn() },
}));
vi.mock('@/services/product-alternatives.service', () => ({
  productAlternativesService: { forCounter: vi.fn() },
}));
vi.mock('@/services/customers.service', () => ({
  customersService: { getCustomersPaginated: vi.fn(), getCustomerById: vi.fn() },
}));
vi.mock('@/services/customer-directory-search.service', () => ({
  searchCustomerDirectory: vi.fn(),
}));
vi.mock('@/services/orders.service', () => ({
  ordersService: { createSalesOrder: vi.fn(), confirmSalesOrder: vi.fn() },
}));
vi.mock('@/services/invoices.service', () => ({
  invoicesService: { createInvoice: vi.fn(), getInvoiceById: vi.fn() },
}));
vi.mock('@/services/payments.service', () => ({
  paymentsService: { recordPayment: vi.fn(), getPayments: vi.fn() },
}));
vi.mock('@/services/counter-shifts.service', () => ({
  counterShiftsService: {
    getLatestShift: vi.fn(),
    getShiftPayments: vi.fn(),
    linkDemoPayment: vi.fn(),
    openShift: vi.fn(),
    closeShift: vi.fn(),
  },
  summarizeCounterShiftCash: vi.fn(),
}));

const orgId = 'org-POS';
const product = {
  id: 'p-1', organizationId: orgId, name: 'Copper Wire', sku: 'WIRE-1',
  category: 'Wires & Cables', brand: 'Atlas', uom: 'Nos',
  purchaseCost: 50, sellingPrice: 100, taxRate: 18, isActive: true,
  reorderThreshold: 5, currentStock: 12, createdAt: '', updatedAt: '',
};
const activeCustomer = {
  id: 'c-1', organizationId: orgId, name: 'Ravi Electricals', isActive: true,
};
const check = vi.fn();

function mount() {
  return render(<MemoryRouter><RetailPosPage /></MemoryRouter>);
}
async function fillCart() {
  fireEvent.change(screen.getByLabelText('Search POS products'), { target: { value: 'Wire' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Add Copper Wire' }));
  fireEvent.change(screen.getByLabelText('Search POS customers'), { target: { value: 'Ravi' } });
  fireEvent.click(await screen.findByRole('button', { name: /Ravi Electricals/ }));
}

describe('Retail Counter — safe draft order workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.spyOn(counterCheckoutService, 'complete').mockResolvedValue({
      state: 'COMPLETED', invoiceId: 'inv-1', invoiceNumber: 'ATL/2026-27/0001',
      receiptId: 'pay-1', receiptNumber: 'RCP-2026-0001',
    });
    vi.stubGlobal('crypto', { randomUUID: () => '93a54640-11bb-4390-84ad-1084d4bc52a3' });
    vi.mocked(useOrg).mockReturnValue({
      currentOrg: { id: orgId, name: 'Atlas Counter' }, currentUser: { id: 'u1' },
      currentRole: 'owner', isMockAuth: false,
    } as any);
    check.mockReturnValue({ allowed: true });
    vi.mocked(useActionPermission).mockReturnValue({ check, can: vi.fn() });
    vi.mocked(productsService.getProductsPaginated).mockResolvedValue({
      data: [product], totalCount: 1,
    } as any);
    vi.mocked(productAlternativesService.forCounter).mockResolvedValue([]);
    vi.mocked(searchCustomerDirectory).mockResolvedValue([
      { id: 'c-1', name: 'Ravi Electricals', phone: '+91 98765-43210' },
    ]);
    vi.mocked(customersService.getCustomerById).mockResolvedValue(activeCustomer as any);
    vi.mocked(ordersService.createSalesOrder).mockResolvedValue({
      id: 'order-1', orderNumber: 'SO-POS-001', status: 'DRAFT',
    } as any);
    vi.mocked(ordersService.confirmSalesOrder).mockResolvedValue({ success: true, status: 'CONFIRMED' });
    vi.mocked(counterShiftsService.getLatestShift).mockResolvedValue({
      id: 'shift-1', organizationId: orgId, openedBy: 'u1', openedAt: new Date().toISOString(),
      openingCash: 500, status: 'OPEN', idempotencyKey: 'shift-key',
    });
    vi.mocked(counterShiftsService.linkDemoPayment).mockResolvedValue(undefined);
    vi.mocked(invoicesService.createInvoice).mockResolvedValue({
      id: 'inv-1', invoiceNumber: 'ATL/2026-27/0001', totalAmount: 118,
    } as any);
    vi.mocked(invoicesService.getInvoiceById).mockResolvedValue({
      id: 'inv-1', invoiceNumber: 'ATL/2026-27/0001', totalAmount: 118,
    } as any);
    vi.mocked(paymentsService.recordPayment).mockResolvedValue({
      id: 'pay-1', paymentNumber: 'RCP-2026-0001',
    } as any);
    vi.mocked(paymentsService.getPayments).mockResolvedValue([{
      id: 'pay-1', paymentNumber: 'RCP-2026-0001',
    }] as any);
  });

  it('builds single-item checkout through existing authoritative draft RPC, without stock or payment writes', async () => {
    mount();
    await fillCart();
    expect(screen.getAllByText(/Paid checkout confirms stock/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft sales order' }));
    await waitFor(() => expect(ordersService.createSalesOrder).toHaveBeenCalledTimes(1));
    expect(ordersService.createSalesOrder).toHaveBeenCalledWith(orgId, expect.objectContaining({
      customerId: 'c-1',
      idempotencyKey: '93a54640-11bb-4390-84ad-1084d4bc52a3',
      items: [expect.objectContaining({
        productId: 'p-1', productSku: 'WIRE-1', quantity: 1, unitPrice: 100, taxRate: 18,
      })],
    }), false);
    expect(await screen.findByRole('button', { name: 'Review order' })).toBeInTheDocument();
    expect(ordersService.confirmSalesOrder).not.toHaveBeenCalled();
  });

  it('supports changing bulk quantity before saving and warns when displayed stock is insufficient', async () => {
    mount();
    await fillCart();
    fireEvent.change(screen.getByLabelText('Quantity for Copper Wire'), { target: { value: '20' } });
    expect(screen.getByText(/Quantity exceeds last displayed stock/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft sales order' }));
    await waitFor(() => expect(ordersService.createSalesOrder).toHaveBeenCalledTimes(1));
    const args = vi.mocked(ordersService.createSalesOrder).mock.calls[0][1];
    expect(args.items[0].quantity).toBe(20);
    expect(ordersService.confirmSalesOrder).not.toHaveBeenCalled();
  });

  it('does not call the backend with an invalid quantity', async () => {
    mount();
    await fillCart();
    fireEvent.change(screen.getByLabelText('Quantity for Copper Wire'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft sales order' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('whole numbers');
    expect(ordersService.createSalesOrder).not.toHaveBeenCalled();
  });

  it('enforces write permission before checkout', async () => {
    check.mockReturnValue({ allowed: false, message: 'Orders are restricted' });
    mount();
    await fillCart();
    expect(screen.getByText('Orders are restricted')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft sales order' })).toBeDisabled();
    expect(ordersService.createSalesOrder).not.toHaveBeenCalled();
  });

  it('preserves the idempotency key on a failed request so retry cannot double-create', async () => {
    vi.mocked(ordersService.createSalesOrder).mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ orderNumber: 'SO-POS-001' } as any);
    mount();
    await fillCart();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft sales order' }));
    await screen.findByText('Network error');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft sales order' }));
    await waitFor(() => expect(ordersService.createSalesOrder).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(ordersService.createSalesOrder).mock.calls;
    expect(first[1].idempotencyKey).toBe(second[1].idempotencyKey);
  });
  it('shows the billing worksheet with product-master GST and exact totals', async () => {
    mount();
    await fillCart();
    const grid = screen.getByRole('region', { name: 'Scroll billing line items' });
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(grid).toHaveTextContent('Copper Wire');
    expect(grid).toHaveTextContent('WIRE-1');
    expect(grid).toHaveTextContent('18%');
    expect(screen.getByText('Estimated total')).toBeInTheDocument();
    expect(screen.getAllByText('₹118.00').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Draft vs\. paid sale:/)).toBeInTheDocument();
    expect(screen.getByText(/Paid checkout confirms stock, issues an invoice, records payment/)).toBeInTheDocument();
  });

  it('adds a selected result using ArrowDown and Enter without creating an invoice', async () => {
    const second = { ...product, id: 'p-2', name: 'LED Panel', sku: 'LED-2', hsnCode: '9405' };
    vi.mocked(productsService.getProductsPaginated).mockResolvedValue({
      data: [product, second], totalCount: 2,
    } as any);
    mount();
    const lookup = screen.getByLabelText('Search POS products');
    fireEvent.change(lookup, { target: { value: 'LED' } });
    await screen.findByRole('button', { name: 'Add LED Panel' });
    fireEvent.keyDown(lookup, { key: 'ArrowDown' });
    fireEvent.keyDown(lookup, { key: 'Enter' });
    expect(screen.getByRole('table')).toHaveTextContent('LED Panel');
    expect(screen.getByRole('table')).not.toHaveTextContent('WIRE-1');
    expect(screen.getByLabelText('Search POS products')).toHaveValue('');
    expect(ordersService.createSalesOrder).not.toHaveBeenCalled();
  });

  it('accepts customer selection by keyboard and Ctrl+Enter saves only a draft', async () => {
    mount();
    const productLookup = screen.getByLabelText('Search POS products');
    fireEvent.change(productLookup, { target: { value: 'Wire' } });
    await screen.findByRole('button', { name: 'Add Copper Wire' });
    fireEvent.keyDown(productLookup, { key: 'Enter' });
    const lookup = screen.getByLabelText('Search POS customers');
    fireEvent.change(lookup, { target: { value: 'Ravi' } });
    await screen.findByRole('button', { name: /Ravi Electricals/ });
    fireEvent.keyDown(lookup, { key: 'Enter' });
    expect(screen.getByText('Selected')).toBeInTheDocument();
    fireEvent.keyDown(lookup, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(ordersService.createSalesOrder).toHaveBeenCalledTimes(1));
    expect(ordersService.confirmSalesOrder).not.toHaveBeenCalled();
  });

  it('disables search, cart changes and saving when order creation is forbidden', () => {
    check.mockReturnValue({ allowed: false, message: 'Orders are restricted' });
    mount();
    expect(screen.getByLabelText('Search POS products')).toBeDisabled();
    expect(screen.getByRole('table')).toHaveTextContent('No items in this bill yet');
    expect(screen.getByRole('button', { name: 'Save draft sales order' })).toBeDisabled();
    expect(ordersService.createSalesOrder).not.toHaveBeenCalled();
  });

  it('adds an HSN-matched cloud product using existing paginated product search', async () => {
    vi.mocked(productsService.getProductsPaginated).mockResolvedValueOnce({
      data: [{ ...product, hsnCode: '8544' }], totalCount: 1,
    } as any);
    mount();
    fireEvent.change(screen.getByLabelText('Search POS products'), { target: { value: '8544' } });
    const result = await screen.findByRole('button', { name: 'Add Copper Wire' });
    expect(productsService.getProductsPaginated).toHaveBeenCalledWith(orgId, {
      search: '8544', page: 1, pageSize: 8, isActive: true,
    }, false);
    fireEvent.click(result);
    expect(screen.getByRole('table')).toHaveTextContent('8544');
    expect(ordersService.createSalesOrder).not.toHaveBeenCalled();
  });

  it('allows cloud GSTIN customer lookup without displaying restricted finance fields', async () => {
    vi.mocked(searchCustomerDirectory).mockResolvedValueOnce([{
      id: 'c-1', name: 'Ravi Electricals', companyName: 'Ravi Traders',
      phone: '+91 98765-43210',
    }]);
    mount();
    fireEvent.change(screen.getByLabelText('Search POS customers'), { target: { value: 'ABCDE1234F' } });
    const result = await screen.findByRole('button', { name: /Ravi Traders/ });
    expect(searchCustomerDirectory).toHaveBeenCalledWith(orgId, 'ABCDE1234F', 5);
    expect(result).not.toHaveTextContent('credit');
    expect(result).not.toHaveTextContent('receivable');
    fireEvent.click(result);
    expect(screen.getByText('Selected')).toBeInTheDocument();
  });

  it('shows approved substitutes for an out-of-stock item and requires explicit selection', async () => {
    vi.mocked(productsService.getProductsPaginated).mockResolvedValueOnce({
      data: [{ ...product, currentStock: 0 }], totalCount: 1,
    } as any);
    vi.mocked(productAlternativesService.forCounter).mockResolvedValueOnce([{
      sourceProductId: 'p-1', comparisonNote: 'Same size and rating',
      product: { ...product, id: 'p-2', name: 'Copper Wire Plus', sku: 'WIRE-2', uom: 'Nos',
        sellingPrice: 125, currentStock: 7 },
    }]);
    mount();
    fireEvent.change(screen.getByLabelText('Search POS products'), { target: { value: 'Old wire code' } });
    const alternative = await screen.findByRole('button', { name: 'Add approved alternative Copper Wire Plus' });
    expect(productAlternativesService.forCounter).toHaveBeenCalledWith(orgId, ['p-1']);
    expect(alternative).toHaveTextContent('Stock 7');
    expect(alternative).toHaveTextContent('₹125.00');
    expect(alternative).toHaveTextContent('Same size and rating');
    expect(screen.getByRole('table')).toHaveTextContent('No items in this bill yet');
    fireEvent.click(alternative);
    expect(screen.getByRole('table')).toHaveTextContent('WIRE-2');
    expect(ordersService.createSalesOrder).not.toHaveBeenCalled();
  });

  it('submits the paid cloud sale as a single request', async () => {
    mount();
    await fillCart();
    fireEvent.click(screen.getByRole('button', { name: 'Complete paid sale' }));

    expect(await screen.findByText(/Paid sale complete/)).toBeInTheDocument();
    expect(counterCheckoutService.complete).toHaveBeenCalledWith(orgId, expect.objectContaining({
      shiftId: 'shift-1', customerId: 'c-1', tender: 'CASH',
      items: [expect.objectContaining({ productId: 'p-1', quantity: 1, taxRate: 18 })],
    }));
    expect(ordersService.createSalesOrder).not.toHaveBeenCalled();
    expect(paymentsService.recordPayment).not.toHaveBeenCalled();
    expect(localStorage.getItem('atlas_counter_checkout_v1:' + orgId + ':u1:false')).toBeNull();
  });

  it('resumes the same checkout after remount even when the drawer has since closed', async () => {
    vi.mocked(counterCheckoutService.complete).mockRejectedValueOnce(new Error('Connection lost'));
    const first = mount();
    await fillCart();
    fireEvent.change(screen.getByPlaceholderText(/Delivery instructions/), { target: { value: 'Keep this note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete paid sale' }));
    expect(await screen.findByText('Connection lost')).toBeInTheDocument();
    first.unmount();
    vi.mocked(counterShiftsService.getLatestShift).mockResolvedValue(null);
    mount();
    const retry = await screen.findByRole('button', { name: 'Retry paid sale' });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);

    expect(await screen.findByText(/Paid sale complete/)).toBeInTheDocument();
    const [firstCall, retryCall] = vi.mocked(counterCheckoutService.complete).mock.calls;
    expect(firstCall).toEqual(retryCall);
    expect(retryCall[1].notes).toBe('Keep this note');
    expect(localStorage.getItem('atlas_counter_checkout_v1:' + orgId + ':u1:false')).toBeNull();
  });
});
