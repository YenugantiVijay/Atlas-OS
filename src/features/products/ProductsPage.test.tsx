import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductsPage } from './ProductsPage';
import { useOrg } from '@/features/organizations/OrgContext';
import { productsService } from '@/services/products.service';

vi.mock('@/features/organizations/OrgContext', () => ({
  useOrg: vi.fn(),
}));

vi.mock('@/services/products.service', () => ({
  productsService: {
    getProductsPaginated: vi.fn(),
  },
}));

vi.mock('@/hooks/useActionPermission', () => ({
  useActionPermission: () => ({ check: () => ({ allowed: true, message: '' }) }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

describe('ProductsPage responsive product list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useOrg).mockReturnValue({
      currentOrg: { id: 'org-1', currency: 'INR' },
      currentRole: 'owner',
      isAuthenticated: true,
      isDemoMode: false,
      isMockAuth: true,
      canWriteOperations: true,
      eligibility: null,
      subscription: null,
      authError: null,
    } as ReturnType<typeof useOrg>);
    vi.mocked(productsService.getProductsPaginated).mockResolvedValue({
      data: [{
        id: 'product-1',
        organizationId: 'org-1',
        sku: 'WIRE-001',
        name: 'Copper Wire',
        brand: 'Atlas',
        category: 'Wires & Cables',
        uom: 'Coils',
        purchaseCost: 100,
        sellingPrice: 150,
        taxRate: 18,
        hsnCode: '8544',
        reorderThreshold: 5,
        currentStock: 3,
        isActive: true,
        createdAt: '',
        updatedAt: '',
      }],
      totalCount: 1,
      totalPages: 1,
      page: 1,
      pageSize: 25,
      total: 1,
      hasNextPage: false,
      hasPrevPage: false,
    });
  });

  it('shows stock and actions in the narrow-screen product cards', async () => {
    render(
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>
    );

    const mobileList = await screen.findByRole('list', { name: 'Products' });
    expect(mobileList).toHaveClass('lg:hidden');
    expect(mobileList).toHaveTextContent('3 Coils');
    expect(mobileList).toHaveTextContent(/Low stock.*Min 5/);
    expect(mobileList).toHaveTextContent('Edit');
  });
});
