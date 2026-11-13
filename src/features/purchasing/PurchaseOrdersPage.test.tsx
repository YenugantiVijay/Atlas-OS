import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { productsService } from '@/services/products.service';
import { purchaseOrdersService, type PurchaseOrder } from '@/services/purchase-orders.service';
import { supplierPriceHistoryService, type SupplierPriceEntry } from '@/services/supplier-price-history.service';
import type { Product } from '@/types';
import { PurchaseOrdersPage } from './PurchaseOrdersPage';

const state = vi.hoisted(() => ({ canWrite: true }));
vi.mock('@/features/organizations/OrgContext', () => ({
  useOrg: () => ({ currentOrg: { id: 'org-a' }, currentUser: { id: 'operator-a' }, currentRole: 'inventory', isMockAuth: false }),
}));
vi.mock('@/hooks/useActionPermission', () => ({
  useActionPermission: () => ({ check: (action: string) => ({
    allowed: action === 'data:read' || state.canWrite,
    message: action === 'inventory:receive' && !state.canWrite ? 'Your trial has expired.' : undefined,
  }) }),
}));
vi.mock('@/services/purchase-orders.service', () => ({
  purchaseOrdersService: { list: vi.fn(), searchSuppliers: vi.fn(), saveDraft: vi.fn(), markOrdered: vi.fn() },
}));
vi.mock('@/services/products.service', () => ({ productsService: { getProductsPaginated: vi.fn() } }));
vi.mock('@/services/supplier-price-history.service', () => ({ supplierPriceHistoryService: { list: vi.fn() } }));

const product: Product = {
  id: 'product-a', organizationId: 'org-a', name: 'Modular Switch', sku: 'SW-12', uom: 'Nos', category: 'Switchgear',
  purchaseCost: 10, sellingPrice: 18, taxRate: 18, reorderThreshold: 5, currentStock: 4, isActive: true,
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
};
const supplier = { id: 'supplier-a', name: 'Apex Supplier' };
const rate: SupplierPriceEntry = {
  id: 'rate-a', organizationId: 'org-a', supplierId: supplier.id, supplierName: supplier.name,
  productId: product.id, productName: product.name, productSku: product.sku, productUom: product.uom,
  unitCost: 13.25, effectiveOn: '2026-11-12', sourceType: 'SUPPLIER_QUOTE', sourceReference: 'Quote Q42', notes: 'Quote Q42',
  actorId: 'operator-a', recordedAt: '2026-11-12T07:30:00Z',
};
const stored: PurchaseOrder = {
  id: 'order-a', organization_id: 'org-a', supplier_id: supplier.id, supplier_name: supplier.name, expected_on: '2026-12-01',
  notes: 'Supplier reference Q42', lines: [{ productId: product.id, productName: product.name, sku: product.sku, uom: product.uom, quantity: 100, unitCost: rate.unitCost }],
  status: 'DRAFT', order_number: null, ordered_at: null, updated_at: '2026-11-12T09:30:00Z', revision: 1,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><PurchaseOrdersPage /></MemoryRouter></QueryClientProvider>);
}

describe('Purchase Orders', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    state.canWrite = true;
    vi.mocked(purchaseOrdersService.list).mockResolvedValue({ rows: [], hasNext: false });
    vi.mocked(purchaseOrdersService.searchSuppliers).mockResolvedValue([supplier]);
    vi.mocked(productsService.getProductsPaginated).mockResolvedValue({
      data: [product], page: 1, pageSize: 8, total: 1, totalCount: 1, totalPages: 1, hasNextPage: false, hasPrevPage: false,
    });
    vi.mocked(supplierPriceHistoryService.list).mockResolvedValue([rate]);
  });

  it('saves an unnumbered draft and assigns a number after confirmation using the saved revision', async () => {
    let saved: PurchaseOrder | undefined;
    vi.mocked(purchaseOrdersService.list).mockImplementation(async () => ({ rows: saved ? [saved] : [], hasNext: false }));
    vi.mocked(purchaseOrdersService.saveDraft).mockImplementation(async (_, input) => {
      saved = { ...stored, id: input.id };
      return saved;
    });
    vi.mocked(purchaseOrdersService.markOrdered).mockImplementation(async () => {
      if (!saved) throw new Error('The test must save a draft before ordering.');
      saved = { ...saved, revision: 2, order_number: 'PO-2026-0001', status: 'ORDERED', ordered_at: '2026-11-12T10:00:00Z' };
      return saved;
    });
    renderPage();

    const create = screen.getByRole('button', { name: 'New purchase order' });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    fireEvent.change(screen.getByLabelText('Find supplier'), { target: { value: 'Apex' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Apex Supplier' }));
    fireEvent.change(screen.getByLabelText('Expected delivery'), { target: { value: '2026-12-01' } });
    fireEvent.change(screen.getByLabelText('Order notes'), { target: { value: stored.notes } });
    fireEvent.change(screen.getByLabelText('Add product'), { target: { value: 'SW-12' } });
    fireEvent.click(await screen.findByRole('button', { name: /Modular Switch.*Stock 4 Nos/ }));
    fireEvent.change(screen.getByLabelText('Quantity for Modular Switch'), { target: { value: '100' } });
    const cost = screen.getByLabelText('Purchase rate for Modular Switch');
    expect(cost).toHaveValue('');
    fireEvent.click(await screen.findByRole('button', { name: 'Use last supplier rate for Modular Switch' }));
    expect(cost).toHaveValue('13.25');
    expect(screen.getByText('₹1,325.00')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Purchase order draft saved.')).toBeVisible();
    expect(purchaseOrdersService.saveDraft).toHaveBeenCalledWith('org-a', {
      id: expect.any(String), revision: null, supplierId: supplier.id, expectedOn: stored.expected_on,
      notes: stored.notes, lines: [{ productId: product.id, uom: product.uom, quantity: 100, unitCost: 13.25 }],
    });
    expect(purchaseOrdersService.markOrdered).not.toHaveBeenCalled();
    const mark = screen.getByRole('button', { name: 'Mark ordered' });
    await waitFor(() => expect(mark).toBeEnabled());
    fireEvent.click(mark);
    expect(purchaseOrdersService.markOrdered).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm ordered' }));
    expect(await screen.findByRole('heading', { name: 'PO-2026-0001' })).toBeVisible();
    expect(purchaseOrdersService.markOrdered).toHaveBeenCalledWith('org-a', saved?.id, 1);
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    const back = screen.getByRole('button', { name: 'Back to orders' });
    await waitFor(() => expect(back).toBeEnabled());
    fireEvent.click(back);
    expect(await screen.findByRole('button', { name: 'View PO-2026-0001' })).toBeVisible();
  });

  it('keeps a saved draft readable when the workspace cannot make operational writes', async () => {
    state.canWrite = false;
    vi.mocked(purchaseOrdersService.list).mockResolvedValue({ rows: [stored], hasNext: false });
    renderPage();
    expect(await screen.findByText('Your trial has expired.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'New purchase order' })).toBeDisabled();
    fireEvent.click(await screen.findByRole('button', { name: 'Open draft for Apex Supplier' }));
    expect(screen.getByLabelText('Order notes')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Mark ordered' })).not.toBeInTheDocument();
  });
});
