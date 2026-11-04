import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OrdersPage } from './OrdersPage';
import * as OrgContextModule from '@/features/organizations/OrgContext';
import { ordersService } from '@/services/orders.service';
import { customersService } from '@/services/customers.service';
import { productsService } from '@/services/products.service';
import { Organization, Customer, Product } from '@/types';
import { MemoryRouter } from 'react-router-dom';

const mockShowToast = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

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

vi.mock('@/services/invoices.service', () => ({
  invoicesService: {
    createInvoiceFromOrder: vi.fn(),
  },
}));

describe('OrdersPage — Frontend Submission Idempotency & Retry Integrity', () => {
  const mockOrg: Organization = {
    id: 'org-test-orders-001',
    name: 'Havells Electrical Agency',
    currency: 'INR',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const sampleCustomer: Customer = {
    id: 'cust-uuid-001',
    organizationId: mockOrg.id,
    name: 'Kiran Electrical Contractors',
    companyName: 'Kiran Electricals Pvt Ltd',
    phone: '+91 98450 12345',
    creditLimit: 500000,
    creditDays: 30,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const sampleProduct: Product = {
    id: 'prod-uuid-001',
    organizationId: mockOrg.id,
    name: 'Havells 32A MCB Double Pole',
    sku: 'HVL-MCB-32DP',
    hsnCode: '8536',
    category: 'Switchgear',
    uom: 'Nos',
    purchaseCost: 350,
    sellingPrice: 480,
    taxRate: 18,
    reorderThreshold: 10,
    currentStock: 100,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const setupOrgContext = (overrides: Partial<OrgContextModule.OrgContextType> = {}) => {
    const defaultCtx: OrgContextModule.OrgContextType = {
      currentOrg: mockOrg,
      organizations: [mockOrg],
      currentRole: 'sales',
      currentUser: { id: 'usr-1', email: 'sales@havells.com', fullName: 'Sales Executive' },
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
        productLines: ['Switchgear'],
        declaredAt: '2026-01-01T00:00:00Z',
        declaredBy: 'usr-1',
        reviewedAt: null,
        rejectionReason: null,
      },
      subscription: {
        organizationId: mockOrg.id,
        planTier: 'growth',
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
      switchOrganization: vi.fn(),
      createOrganization: vi.fn(),
      updateOrganization: vi.fn(),
      updateCurrentUser: vi.fn(),
      refreshOrgData: vi.fn(),
      memberships: [],
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      enterDemoMode: vi.fn(),
      exitDemoMode: vi.fn(),
      ...overrides,
    };
    vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue(defaultCtx);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setupOrgContext();
    vi.mocked(ordersService.getSalesOrders).mockResolvedValue([]);
    vi.mocked(customersService.getCustomers).mockResolvedValue([sampleCustomer]);
    vi.mocked(productsService.getProducts).mockResolvedValue([sampleProduct]);
  });

  it('submits sales order with a generated UUID idempotency key', async () => {
    vi.mocked(ordersService.createSalesOrder).mockResolvedValue({
      id: 'so-uuid-001',
      organizationId: mockOrg.id,
      orderNumber: 'SO-2026-0001',
      customerId: sampleCustomer.id,
      status: 'DRAFT',
      orderDate: '2026-11-03',
      subtotal: 480,
      discountAmount: 0,
      taxAmount: 86.4,
      totalAmount: 566.4,
      totalsVersion: 2,
      createdAt: '2026-11-03T00:00:00Z',
      updatedAt: '2026-11-03T00:00:00Z',
      items: [],
    });

    render(
      <MemoryRouter>
        <OrdersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('New Sales Order')[0]).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText('New Sales Order')[0]);

    await waitFor(() => {
      expect(screen.getByText('Create Sales Order')).toBeInTheDocument();
    });

    const submitBtn = screen.getByRole('button', { name: /Save Sales Order/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(ordersService.createSalesOrder).toHaveBeenCalledTimes(1);
    });

    const passedParams = vi.mocked(ordersService.createSalesOrder).mock.calls[0][1];
    expect(passedParams.idempotencyKey).toBeDefined();
    expect(passedParams.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('preserves the identical idempotency key when retrying after network timeout', async () => {
    // 1st attempt: Network timeout
    vi.mocked(ordersService.createSalesOrder).mockRejectedValueOnce(
      new Error('Connection timeout to upstream database')
    );
    // 2nd attempt: Success
    vi.mocked(ordersService.createSalesOrder).mockResolvedValueOnce({
      id: 'so-uuid-002',
      organizationId: mockOrg.id,
      orderNumber: 'SO-2026-0002',
      customerId: sampleCustomer.id,
      status: 'DRAFT',
      orderDate: '2026-11-03',
      subtotal: 480,
      discountAmount: 0,
      taxAmount: 86.4,
      totalAmount: 566.4,
      totalsVersion: 2,
      createdAt: '2026-11-03T00:00:00Z',
      updatedAt: '2026-11-03T00:00:00Z',
      items: [],
    });

    render(
      <MemoryRouter>
        <OrdersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('New Sales Order')[0]).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText('New Sales Order')[0]);

    await waitFor(() => {
      expect(screen.getByText('Create Sales Order')).toBeInTheDocument();
    });

    const submitBtn = screen.getByRole('button', { name: /Save Sales Order/i });

    // 1st click fails
    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(ordersService.createSalesOrder).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith('error', 'Failed to Create', expect.stringContaining('timeout'));
    });

    const firstKey = vi.mocked(ordersService.createSalesOrder).mock.calls[0][1].idempotencyKey;
    expect(firstKey).toBeDefined();

    // 2nd click: user retries the submission
    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(ordersService.createSalesOrder).toHaveBeenCalledTimes(2);
    });

    const secondKey = vi.mocked(ordersService.createSalesOrder).mock.calls[1][1].idempotencyKey;
    // CRITICAL: The retry must use the exact same idempotency key for safe backend replay
    expect(secondKey).toBe(firstKey);
  });

  it('prevents double-click submissions while submission is in flight', async () => {
    let resolveFirstCall: (value: any) => void;
    const slowPromise = new Promise((resolve) => {
      resolveFirstCall = resolve;
    });
    vi.mocked(ordersService.createSalesOrder).mockImplementation(() => slowPromise as any);

    render(
      <MemoryRouter>
        <OrdersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('New Sales Order')[0]).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText('New Sales Order')[0]);

    await waitFor(() => {
      expect(screen.getByText('Create Sales Order')).toBeInTheDocument();
    });

    const submitBtn = screen.getByRole('button', { name: /Save Sales Order/i });

    // First click initiates submission
    fireEvent.click(submitBtn);

    // Button should be disabled during in-flight submission
    expect(submitBtn).toBeDisabled();

    // Attempt second rapid click
    fireEvent.click(submitBtn);

    // createSalesOrder should only have been called once
    expect(ordersService.createSalesOrder).toHaveBeenCalledTimes(1);

    // Resolve in-flight request
    resolveFirstCall!({
      id: 'so-uuid-003',
      organizationId: mockOrg.id,
      orderNumber: 'SO-2026-0003',
      customerId: sampleCustomer.id,
      status: 'DRAFT',
      orderDate: '2026-11-03',
      subtotal: 480,
      discountAmount: 0,
      taxAmount: 86.4,
      totalAmount: 566.4,
      totalsVersion: 2,
      createdAt: '2026-11-03T00:00:00Z',
      updatedAt: '2026-11-03T00:00:00Z',
      items: [],
    });
  });
});
