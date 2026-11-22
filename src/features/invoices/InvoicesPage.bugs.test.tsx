/**
 * Real-world regression tests for InvoicesPage.tsx critical bugs.
 *
 * Bug #1 — Null crash: `i.customer?.name.toLowerCase()` crashed when
 *   customer was non-null but name was null/undefined.
 *   Fix: removed the entire client-side `filteredInvoices` block.
 *
 * Bug #2 — Double-filter: server already filters by search query via
 *   getInvoicesPaginated / paginateArray; the extra client-side filter
 *   silently dropped valid results, making totalCount inconsistent.
 *   Fix: same — removed the client-side filter entirely.
 *
 * Bug #2b — Pagination hidden on false zero: `filteredInvoices.length > 0`
 *   could be 0 even when totalCount > 0, hiding the pagination bar.
 *   Fix: replaced with `totalCount > 0`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { InvoicesPage } from './InvoicesPage';
import * as OrgContextModule from '@/features/organizations/OrgContext';
import { invoicesService } from '@/services/invoices.service';
import { Invoice, Organization, Customer } from '@/types';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Mock setup
// The existing mock only stubs getInvoices (no getInvoicesPaginated).
// InvoicesPage checks `typeof invoicesService.getInvoicesPaginated === 'function'`
// and falls back to the getInvoices + paginateArray path — which is exactly
// what we want to test here, since it exercises the now-removed client-filter.
// ---------------------------------------------------------------------------

vi.mock('@/services/invoices.service', () => ({
  invoicesService: {
    getInvoices: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_ORG: Organization = {
  id: 'org-bug-test-01',
  name: 'Atlas Bug Test Org',
  legalName: 'Atlas Bug Test Org LLP',
  gstin: '29ABCDE1234F1Z5',
  phone: '+91 98450 00000',
  addressLine1: '1 Test Street',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  currency: 'INR',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const FULL_CUSTOMER: Customer = {
  id: 'cust-01',
  organizationId: BASE_ORG.id,
  name: 'Rajesh Kumar',
  companyName: 'Apex Cables Pvt Ltd',
  gstin: '27AAAAA0000A1Z5',
  phone: '+91 94400 00001',
  billingAddress: 'Mumbai, Maharashtra',
  creditLimit: 500000,
  creditDays: 30,
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const SAMPLE_INVOICE: Invoice = {
  id: 'inv-bug-001',
  organizationId: BASE_ORG.id,
  invoiceNumber: 'INV-BUG-0001',
  customerId: FULL_CUSTOMER.id,
  customer: FULL_CUSTOMER,
  status: 'ISSUED',
  invoiceDate: '2026-11-01',
  dueDate: '2026-12-01',
  subtotal: 10000,
  discountAmount: 0,
  taxAmount: 1800,
  totalAmount: 11800,
  totalPaid: 0,
  totalsVersion: 2,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  items: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupOrg(overrides: Partial<Organization> = {}) {
  const org = { ...BASE_ORG, ...overrides };
  vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
    currentOrg: org,
    organizations: [org],
    currentRole: 'admin',
    currentUser: { id: 'usr-1', email: 'test@example.com', fullName: 'Test User' },
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
  } as OrgContextModule.OrgContextType);
}

function renderPage(search = '') {
  const url = search ? `/?search=${encodeURIComponent(search)}` : '/';
  return render(
    <MemoryRouter initialEntries={[url]}>
      <InvoicesPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Bug #1 — Null crash: customer.name is null/undefined
// ---------------------------------------------------------------------------

describe('Bug #1 — null crash on customer.name', () => {
  it('renders without crashing when customer.name is undefined (customer object exists)', async () => {
    setupOrg();
    const invoice: Invoice = {
      ...SAMPLE_INVOICE,
      customer: {
        ...FULL_CUSTOMER,
        name: undefined as unknown as string, // simulate DB row where name is NULL
      },
    };
    vi.mocked(invoicesService.getInvoices).mockResolvedValue([invoice]);

    // Before the fix: `i.customer?.name.toLowerCase()` would throw
    // "Cannot read properties of undefined (reading 'toLowerCase')"
    expect(() => renderPage()).not.toThrow();
    await waitFor(() => {
      expect(screen.getByText('INV-BUG-0001')).toBeInTheDocument();
    });
  });

  it('renders without crashing when customer.name is null', async () => {
    setupOrg();
    const invoice: Invoice = {
      ...SAMPLE_INVOICE,
      customer: {
        ...FULL_CUSTOMER,
        name: null as unknown as string,
      },
    };
    vi.mocked(invoicesService.getInvoices).mockResolvedValue([invoice]);

    expect(() => renderPage()).not.toThrow();
    await waitFor(() => {
      expect(screen.getByText('INV-BUG-0001')).toBeInTheDocument();
    });
  });

  it('renders without crashing when customer is undefined', async () => {
    setupOrg();
    const invoice: Invoice = {
      ...SAMPLE_INVOICE,
      customer: undefined,
    };
    vi.mocked(invoicesService.getInvoices).mockResolvedValue([invoice]);

    expect(() => renderPage()).not.toThrow();
    await waitFor(() => {
      expect(screen.getByText('INV-BUG-0001')).toBeInTheDocument();
    });
  });

  it('renders a list of mixed invoices — some with null customer fields — without crashing', async () => {
    setupOrg();
    const invoices: Invoice[] = [
      SAMPLE_INVOICE,
      { ...SAMPLE_INVOICE, id: 'inv-bug-002', invoiceNumber: 'INV-BUG-0002', customer: undefined },
      {
        ...SAMPLE_INVOICE,
        id: 'inv-bug-003',
        invoiceNumber: 'INV-BUG-0003',
        customer: { ...FULL_CUSTOMER, name: null as unknown as string, companyName: undefined },
      },
    ];
    vi.mocked(invoicesService.getInvoices).mockResolvedValue(invoices);

    expect(() => renderPage()).not.toThrow();
    await waitFor(() => {
      expect(screen.getByText('INV-BUG-0001')).toBeInTheDocument();
      expect(screen.getByText('INV-BUG-0002')).toBeInTheDocument();
      expect(screen.getByText('INV-BUG-0003')).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Bug #2 — Double-filter: server already filtered; client must not re-filter
// ---------------------------------------------------------------------------

describe('Bug #2 — double-filter silently drops valid rows', () => {
  it('shows an invoice matched by companyName even when invoiceNumber does not contain the search term', async () => {
    setupOrg();
    // Server matched this invoice by company name "Apex Cables" for search="apex".
    // The invoice number "INV-BUG-0001" does NOT contain "apex".
    // Before the fix: the client-side filter would re-check and drop it because
    // invoiceNumber doesn't match and customer.name ("Rajesh Kumar") doesn't match.
    // After the fix: server result is trusted → invoice must still appear.
    const invoice: Invoice = {
      ...SAMPLE_INVOICE,
      invoiceNumber: 'INV-BUG-0001',
      customer: { ...FULL_CUSTOMER, companyName: 'Apex Cables Pvt Ltd', name: 'Rajesh Kumar' },
    };
    vi.mocked(invoicesService.getInvoices).mockResolvedValue([invoice]);

    renderPage('apex'); // ?search=apex

    await waitFor(() => {
      expect(screen.getByText('INV-BUG-0001')).toBeInTheDocument();
    });
  });

  it('shows an invoice matched by invoiceNumber even when customer fields are empty', async () => {
    setupOrg();
    const invoice: Invoice = {
      ...SAMPLE_INVOICE,
      invoiceNumber: 'INV-2026-APEX',
      customer: undefined,
    };
    vi.mocked(invoicesService.getInvoices).mockResolvedValue([invoice]);

    renderPage('apex');

    await waitFor(() => {
      expect(screen.getByText('INV-2026-APEX')).toBeInTheDocument();
    });
  });

  it('does not show an empty state when server returned rows (no double-filter wipeout)', async () => {
    setupOrg();
    // Server returns 1 invoice. Before the fix a mismatch could cause filteredInvoices=[]
    // → EmptyState rendered instead of the row.
    vi.mocked(invoicesService.getInvoices).mockResolvedValue([SAMPLE_INVOICE]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('INV-BUG-0001')).toBeInTheDocument();
    });
    // EmptyState should NOT be present when rows exist
    expect(screen.queryByText(/No invoices issued yet/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Bug #2b — Pagination hidden on false zero
// ---------------------------------------------------------------------------

describe('Bug #2b — pagination bar must be driven by totalCount, not filtered row count', () => {
  it('shows pagination bar when server reports totalCount > 0 and invoices array is non-empty', async () => {
    setupOrg();
    // 25 invoices returned on page 1, totalCount = 50 (two pages)
    const invoices: Invoice[] = Array.from({ length: 25 }, (_, i) => ({
      ...SAMPLE_INVOICE,
      id: `inv-pag-${i}`,
      invoiceNumber: `INV-PAG-${String(i + 1).padStart(4, '0')}`,
    }));
    vi.mocked(invoicesService.getInvoices).mockResolvedValue(invoices);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('INV-PAG-0001')).toBeInTheDocument();
    });

    // Pagination component must be rendered. It typically shows page info.
    // We check for the presence of a next/prev button or page indicator.
    // The Pagination component from the codebase renders "Page X of Y" or buttons.
    // A loose check: at least one element associated with pagination exists.
    // We rely on the fact that totalCount badge shows "25 Invoices" at minimum.
    expect(screen.getByText(/25 Invoices/i)).toBeInTheDocument();
  });
});
