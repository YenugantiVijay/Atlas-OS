import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OrdersPage } from './OrdersPage';
import * as OrgContextModule from '@/features/organizations/OrgContext';
import { ordersService } from '@/services/orders.service';
import { customersService } from '@/services/customers.service';
import { productsService } from '@/services/products.service';
import { Organization, Customer, Product } from '@/types';

// Mock Toast
const mockShowToast = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock Services
vi.mock('@/services/orders.service', () => ({
  ordersService: {
    getSalesOrders: vi.fn(),
    createSalesOrder: vi.fn(),
    confirmSalesOrder: vi.fn(),
  },
}));

vi.mock('@/services/customers.service', () => ({
  customersService: {
    getCustomers: vi.fn(),
  },
}));

vi.mock('@/services/products.service', () => ({
  productsService: {
    getProducts: vi.fn(),
  },
}));

describe('OrdersPage — Asynchronous Form Opening & Race Condition Protection', () => {
  const mockOrg: Organization = {
    id: 'org-test-orders-race',
    name: 'Polycab Distributors Bangalore',
    currency: 'INR',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const sampleCustomers: Customer[] = [
    {
      id: 'cust-1',
      organizationId: mockOrg.id,
      name: 'Apex Electricals',
      companyName: 'Apex Enterprises Pvt Ltd',
      phone: '+91 9876543210',
      email: 'sales@apex.com',
      billingAddress: 'Peenya Industrial Area',
      gstin: '29ABCDE1234F1Z5',
      creditDays: 30,
      creditLimit: 500000,
      currentReceivable: 0,
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  const sampleProducts: Product[] = [
    {
      id: 'prod-1',
      organizationId: mockOrg.id,
      name: 'Polycab 2.5 sqmm FR PVC Copper Wire',
      sku: 'CBL-CU-25',
      hsnCode: '8544',
      category: 'Wires & Cables',
      uom: 'Meters',
      purchaseCost: 1500,
      sellingPrice: 1850,
      taxRate: 18,
      reorderThreshold: 10,
      currentStock: 100,
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  const setupOrgMock = (overrides: Partial<OrgContextModule.OrgContextType> = {}) => {
    const defaultCtx: OrgContextModule.OrgContextType = {
      currentOrg: mockOrg,
      organizations: [mockOrg],
      currentRole: 'owner',
      currentUser: { id: 'u1', email: 'owner@test.com', fullName: 'Owner' },
      session: null,
      isAuthenticated: true,
      isMockAuth: false,
      isDemoMode: false,
      isLoadingAuth: false,
      isLoadingOrgData: false,
      isSwitchingOrg: false,
      authError: null,
      eligibility: {
        organizationId: mockOrg.id,
        status: 'approved',
        businessCategory: 'electrical_wholesale_distributor',
        sellsElectricalProducts: true,
        productLines: ['Wires & Cables'],
        declaredAt: '2026-01-01T00:00:00Z',
        declaredBy: 'u1',
        reviewedAt: null,
        rejectionReason: null,
      },
      subscription: {
        organizationId: mockOrg.id,
        planTier: 'pro',
        status: 'active',
        trialStartedAt: '2026-01-01T00:00:00Z',
        trialEndsAt: '2026-01-08T00:00:00Z',
        currentPeriodStartsAt: '2026-01-01T00:00:00Z',
        currentPeriodEndsAt: '2027-01-01T00:00:00Z',
        paymentMethodEntered: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      canWriteOperations: true,
      declareEligibility: vi.fn(),
      switchOrganization: vi.fn(),
      createOrganization: vi.fn(),
      updateOrganization: vi.fn(),
      updateCurrentUser: vi.fn(),
      refreshOrgData: vi.fn(),
      memberships: [],
      signIn: vi.fn(),
      signUp: vi.fn(),
      sendEmailCode: vi.fn(),
      verifyEmailCode: vi.fn(),
      signOut: vi.fn(),
      enterDemoMode: vi.fn(),
      exitDemoMode: vi.fn(),
      ...overrides,
    };

    vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue(defaultCtx);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ordersService.getSalesOrders).mockResolvedValue([]);
    vi.mocked(customersService.getCustomers).mockResolvedValue(sampleCustomers);
    vi.mocked(productsService.getProducts).mockResolvedValue(sampleProducts);
  });

  it('reliably opens Create Sales Order modal on /orders?action=create after data loads', async () => {
    setupOrgMock();

    render(
      <MemoryRouter initialEntries={['/orders?action=create']}>
        <Routes>
          <Route path="/orders" element={<OrdersPage />} />
        </Routes>
      </MemoryRouter>
    );

    // Modal opens reliably with populated customers and products
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Create Sales Order')).toBeInTheDocument();
    });

    // Verify misleading "No customers found" toast was NOT fired
    expect(mockShowToast).not.toHaveBeenCalledWith(
      'error',
      'No Customers Found',
      expect.anything()
    );
  });

  it('displays "Preparing sales order..." indicator during slow asynchronous loading', async () => {
    setupOrgMock();

    let resolveCustomers: (value: Customer[]) => void;
    const slowCustomersPromise = new Promise<Customer[]>((resolve) => {
      resolveCustomers = resolve;
    });
    vi.mocked(customersService.getCustomers).mockReturnValue(slowCustomersPromise);

    render(
      <MemoryRouter initialEntries={['/orders?action=create']}>
        <Routes>
          <Route path="/orders" element={<OrdersPage />} />
        </Routes>
      </MemoryRouter>
    );

    // Preparing indicator is shown while loading
    expect(screen.getByRole('status')).toHaveTextContent(/Preparing sales order/i);

    // Form modal is not yet open
    expect(screen.queryByText('Create Sales Order')).not.toBeInTheDocument();

    // Now resolve data
    resolveCustomers!(sampleCustomers);

    // Once resolved, modal opens and preparing indicator disappears
    await waitFor(() => {
      expect(screen.getByText('Create Sales Order')).toBeInTheDocument();
    });
  });

  it('shows retriable LoadError when network request fails, without claiming catalog is empty', async () => {
    setupOrgMock();
    vi.mocked(customersService.getCustomers).mockRejectedValue(new Error('Network connection dropped'));

    render(
      <MemoryRouter initialEntries={['/orders?action=create']}>
        <Routes>
          <Route path="/orders" element={<OrdersPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/Network connection dropped/i)).toBeInTheDocument();
    });

    // Form modal should NOT open in broken half-loaded state
    expect(screen.queryByText('Create Sales Order')).not.toBeInTheDocument();

    // False missing customer/product modal is NOT opened
    expect(screen.queryByText('No Customers Found')).not.toBeInTheDocument();
  });

  it('shows PrerequisiteModal when customer catalog is legitimately empty', async () => {
    setupOrgMock();
    vi.mocked(customersService.getCustomers).mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={['/orders?action=create']}>
        <Routes>
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/customers" element={<div data-testid="customers-target">Customers Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('No Customers Found')).toBeInTheDocument();
      expect(
        screen.getByText('No customers found. Add a customer before creating this sales order.')
      ).toBeInTheDocument();
    });

    // Action button to Add Customer exists
    const addCustomerBtn = screen.getByRole('button', { name: /Add Customer/i });
    expect(addCustomerBtn).toBeInTheDocument();
    fireEvent.click(addCustomerBtn);

    await waitFor(() => {
      expect(screen.getByTestId('customers-target')).toBeInTheDocument();
    });
  });

  it('shows PrerequisiteModal when product catalog is legitimately empty', async () => {
    setupOrgMock();
    vi.mocked(productsService.getProducts).mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={['/orders?action=create']}>
        <Routes>
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/products" element={<div data-testid="products-target">Products Page</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('No Products Found')).toBeInTheDocument();
      expect(
        screen.getByText('No products found. Add a product before creating this sales order.')
      ).toBeInTheDocument();
    });

    const addProductBtn = screen.getByRole('button', { name: /Add Product/i });
    expect(addProductBtn).toBeInTheDocument();
    fireEvent.click(addProductBtn);

    await waitFor(() => {
      expect(screen.getByTestId('products-target')).toBeInTheDocument();
    });
  });

  it('denies order creation for viewer role even via direct URL ?action=create', async () => {
    setupOrgMock({ currentRole: 'viewer' });

    render(
      <MemoryRouter initialEntries={['/orders?action=create']}>
        <Routes>
          <Route path="/orders" element={<OrdersPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        'error',
        'Permission Denied',
        expect.stringContaining('Your current role (Viewer) does not have permission to create sales orders')
      );
    });

    // Modal must NOT open
    expect(screen.queryByText('Create Sales Order')).not.toBeInTheDocument();
  });
});
