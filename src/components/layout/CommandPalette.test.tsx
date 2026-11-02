import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette';
import { useOrg, OrgContextType } from '@/features/organizations/OrgContext';
import { productsService } from '@/services/products.service';
import { customersService } from '@/services/customers.service';

vi.mock('@/features/organizations/OrgContext', () => ({ useOrg: vi.fn() }));
vi.mock('@/services/products.service', () => ({ productsService: { getProducts: vi.fn() } }));
vi.mock('@/services/customers.service', () => ({ customersService: { getCustomers: vi.fn() } }));

function Location() {
  const location = useLocation();
  return <output>{location.pathname}{location.search}</output>;
}

const context = { currentOrg: { id: 'cloud-org' }, currentRole: 'owner', isMockAuth: false, canWriteOperations: true } as OrgContextType;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useOrg).mockReturnValue(context);
  vi.mocked(productsService.getProducts).mockResolvedValue([]);
  vi.mocked(customersService.getCustomers).mockResolvedValue([]);
});

function renderPalette() {
  return render(<MemoryRouter><CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} /><Location /></MemoryRouter>);
}

it('queries the active cloud organization and opens a matching product search', async () => {
  vi.mocked(productsService.getProducts).mockResolvedValue([
    { id: 'p1', sku: 'CLOUD+SKU', name: 'Cloud Wire', sellingPrice: 0, uom: 'Coils' } as Awaited<ReturnType<typeof productsService.getProducts>>[number],
  ]);
  renderPalette();
  expect(productsService.getProducts).toHaveBeenCalledWith('cloud-org', false);
  expect(customersService.getCustomers).toHaveBeenCalledWith('cloud-org', false);
  fireEvent.change(screen.getByLabelText('Search Atlas OS'), { target: { value: 'Cloud Wire' } });
  fireEvent.click(await screen.findByRole('button', { name: /Cloud Wire/ }));
  expect(screen.getByText('/products?search=CLOUD%2BSKU')).toBeInTheDocument();
});

it('offers retry after a search request fails', async () => {
  vi.mocked(productsService.getProducts).mockRejectedValueOnce(new Error('Offline'));
  renderPalette();
  expect(await screen.findByRole('alert')).toHaveTextContent('Search data could not be loaded');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(productsService.getProducts).toHaveBeenCalledTimes(2);
});

it('hides unauthorized quick actions and the audit route from viewers', async () => {
  vi.mocked(useOrg).mockReturnValue({ ...context, currentRole: 'viewer' });
  renderPalette();
  await waitFor(() => expect(screen.queryByText('Loading products and customers...')).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'New Product' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Audit Trail/ })).not.toBeInTheDocument();
});
