import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InvoicesPage } from './InvoicesPage';
import * as OrgContextModule from '@/features/organizations/OrgContext';
import { invoicesService } from '@/services/invoices.service';
import { Invoice, Organization, Customer } from '@/types';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/services/invoices.service', () => ({
  invoicesService: {
    getInvoices: vi.fn(),
  },
}));

describe('InvoicesPage — Statutory Tax Invoice Presentation and Compliance', () => {
  const completeOrg: Organization = {
    id: 'org-test-inv-pres-01',
    name: 'Sri Lakshmi Electricals & Co',
    legalName: 'Sri Lakshmi Electrical Distributors LLP',
    gstin: '29ABCDE1234F1Z5',
    phone: '+91 98450 12345',
    addressLine1: '42 BVK Iyengar Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560053',
    currency: 'INR',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const interStateCustomer: Customer = {
    id: 'cust-interstate-01',
    organizationId: completeOrg.id,
    name: 'Apex Industrial Electrics',
    companyName: 'Apex Industrial Electrics Pvt Ltd',
    gstin: '27AAAAA0000A1Z5', // Maharashtra
    phone: '+91 94400 98765',
    billingAddress: 'Unit 5, Lamington Road, Mumbai, Maharashtra - 400007',
    creditLimit: 1000000,
    creditDays: 30,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const sampleInvoice: Invoice = {
    id: 'inv-uuid-001',
    organizationId: completeOrg.id,
    invoiceNumber: 'INV-2026-0001',
    customerId: interStateCustomer.id,
    customer: interStateCustomer,
    status: 'ISSUED',
    invoiceDate: '2026-11-03',
    dueDate: '2026-12-03',
    subtotal: 10000,
    discountAmount: 0,
    taxAmount: 1800,
    totalAmount: 11800,
    totalPaid: 0,
    totalsVersion: 2,
    createdAt: '2026-11-03T00:00:00Z',
    updatedAt: '2026-11-03T00:00:00Z',
    items: [
      {
        id: 'item-1',
        invoiceId: 'inv-uuid-001',
        productId: 'prod-1',
        productName: 'Polycab 4 sqmm 3-Core Industrial Cable',
        productSku: 'CBL-IND-40',
        hsnCode: '8544',
        uom: 'Meters',
        quantity: 100,
        unitPrice: 100,
        discountPercent: 0,
        taxRate: 18,
        lineSubtotal: 10000,
        lineTax: 1800,
        lineTotal: 11800,
      },
    ],
  };

  const setupOrg = (orgOverrides: Partial<Organization> = {}) => {
    const org = { ...completeOrg, ...orgOverrides };
    const defaultCtx: OrgContextModule.OrgContextType = {
      currentOrg: org,
      organizations: [org],
      currentRole: 'admin',
      currentUser: { id: 'usr-1', email: 'admin@srilakshmi.com', fullName: 'Administrator' },
      session: null,
      isAuthenticated: true,
      isMockAuth: false,
      isDemoMode: false,
      isLoadingAuth: false,
      isLoadingOrgData: false,
      isSwitchingOrg: false,
      authError: null,
      eligibility: null,
      subscription: null,
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
    };
    vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue(defaultCtx);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders verified organization details and interstate Place of Supply from customer GSTIN', async () => {
    setupOrg();
    vi.mocked(invoicesService.getInvoices).mockResolvedValue([sampleInvoice]);

    render(
      <MemoryRouter>
        <InvoicesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('INV-2026-0001')).toBeInTheDocument();
    });

    // Open View / Print Modal
    const viewBtn = screen.getByRole('button', { name: /View Invoice/i });
    fireEvent.click(viewBtn);

    await waitFor(() => {
      expect(screen.getByText('TAX INVOICE')).toBeInTheDocument();
    });

    // Verify organization tax info
    expect(screen.getByText('Sri Lakshmi Electrical Distributors LLP')).toBeInTheDocument();
    expect(screen.getByText('29ABCDE1234F1Z5')).toBeInTheDocument();

    // Verify Place of Supply is resolved accurately as Maharashtra from 27AAAAA0000A1Z5
    expect(screen.getByText('27 - Maharashtra')).toBeInTheDocument();
    expect(screen.getAllByText(/27AAAAA0000A1Z5/).length).toBeGreaterThanOrEqual(1);
  });

  it('displays actionable warning when organization GSTIN is missing, and does NOT fallback to dummy GSTIN', async () => {
    setupOrg({ gstin: undefined });
    vi.mocked(invoicesService.getInvoices).mockResolvedValue([sampleInvoice]);

    render(
      <MemoryRouter>
        <InvoicesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('INV-2026-0001')).toBeInTheDocument();
    });

    const viewBtn = screen.getByRole('button', { name: /View Invoice/i });
    fireEvent.click(viewBtn);

    await waitFor(() => {
      expect(screen.getByText('TAX INVOICE')).toBeInTheDocument();
    });

    // Actionable compliance alert is shown
    expect(screen.getByText(/Tax Compliance Configuration Required/i)).toBeInTheDocument();
    expect(screen.getByText(/Organization GSTIN is missing/i)).toBeInTheDocument();

    // Header displays "Not Configured" badge
    expect(screen.getByText('Not Configured')).toBeInTheDocument();
    // Confirms NO hardcoded fallback was printed
    expect(screen.queryByText('29ABCDE1234F1Z5')).not.toBeInTheDocument();
  });

  it('handles unregistered customers and resolves place of supply safely from address', async () => {
    const unregisteredCustomerInvoice: Invoice = {
      ...sampleInvoice,
      customer: {
        ...interStateCustomer,
        gstin: undefined,
        billingAddress: '42 MG Road, Panaji, Goa 403001',
      },
    };
    setupOrg();
    vi.mocked(invoicesService.getInvoices).mockResolvedValue([unregisteredCustomerInvoice]);

    render(
      <MemoryRouter>
        <InvoicesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('INV-2026-0001')).toBeInTheDocument();
    });

    const viewBtn = screen.getByRole('button', { name: /View Invoice/i });
    fireEvent.click(viewBtn);

    await waitFor(() => {
      expect(screen.getByText('TAX INVOICE')).toBeInTheDocument();
    });

    // Recipient is marked Unregistered
    expect(screen.getByText(/GSTIN: Unregistered/i)).toBeInTheDocument();
    // Place of Supply resolved from verified address state
    expect(screen.getByText('30 - Goa')).toBeInTheDocument();
  });
});
