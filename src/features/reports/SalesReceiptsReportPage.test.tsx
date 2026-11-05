import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SalesReceiptsReportPage } from './SalesReceiptsReportPage';
import * as OrgContextModule from '@/features/organizations/OrgContext';
import { customersService } from '@/services/customers.service';
import { reportsService } from '@/services/reports.service';
import * as ExcelModule from '@/lib/excel';
import { Organization, Customer } from '@/types';

// Mock dependencies
vi.mock('@/services/customers.service', () => ({
  customersService: {
    getCustomers: vi.fn(),
    getCustomersPaginated: vi.fn(),
    getCustomerById: vi.fn(),
  },
}));

vi.mock('@/services/reports.service', () => ({
  reportsService: {
    getMatchingCounts: vi.fn(),
    exportReport: vi.fn(),
  },
  MAX_SAFE_EXPORT_INVOICES: 10000,
  ExportIntegrityError: class ExportIntegrityError extends Error {},
}));

vi.mock('@/lib/excel', async (importOriginal) => {
  const actual = await importOriginal<typeof ExcelModule>();
  return {
    ...actual,
    triggerExcelDownload: vi.fn(),
  };
});

describe('SalesReceiptsReportPage — UI & Interaction Test Suite', () => {
  const mockOrg: Organization = {
    id: 'org-test-uuid',
    name: 'Sri Devi Electricals',
    legalName: 'Sri Devi Electricals Pvt Ltd',
    gstin: '37AAAAA1234A1Z5',
    pan: 'AAAAA1234A',
    state: 'Andhra Pradesh',
    currency: 'INR',
    createdAt: '2025-04-01T00:00:00Z',
    updatedAt: '2025-04-01T00:00:00Z',
  };

  const sampleCustomers: Customer[] = [
    {
      id: 'cust-1',
      organizationId: mockOrg.id,
      name: 'Gayatri Electricals',
      companyName: 'Gayatri Electricals & Hardware',
      creditLimit: 100000,
      creditDays: 30,
      isActive: true,
      createdAt: '2025-04-01T00:00:00Z',
      updatedAt: '2025-04-01T00:00:00Z',
    },
    {
      id: 'cust-2',
      organizationId: mockOrg.id,
      name: 'Kavitha Controls',
      creditLimit: 500000,
      creditDays: 45,
      isActive: true,
      createdAt: '2025-04-01T00:00:00Z',
      updatedAt: '2025-04-01T00:00:00Z',
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
        trialEndsAt: '2026-01-15T00:00:00Z',
        gracePeriodEndsAt: '2026-01-22T00:00:00Z',
        currentPeriodEndsAt: '2027-01-01T00:00:00Z',
        paymentMethodEntered: false,
      },
      canWriteOperations: true,
      memberships: [],
      switchOrganization: vi.fn(),
      createOrganization: vi.fn(),
      updateOrganization: vi.fn(),
      updateCurrentUser: vi.fn(),
      refreshOrgData: vi.fn(),
      signOut: vi.fn(),
      signIn: vi.fn(),
      signUp: vi.fn(),
      enterDemoMode: vi.fn(),
      exitDemoMode: vi.fn(),
      declareEligibility: vi.fn(),
      ...overrides,
    };

    vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue(defaultCtx);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setupOrgMock();
    vi.mocked(customersService.getCustomers).mockResolvedValue(sampleCustomers);
    vi.mocked(customersService.getCustomersPaginated).mockResolvedValue({
      data: sampleCustomers,
      total: sampleCustomers.length,
      totalCount: sampleCustomers.length,
      page: 1,
      pageSize: 25,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false,
    });
    vi.mocked(customersService.getCustomerById).mockImplementation((_orgId, id) => {
      return Promise.resolve(sampleCustomers.find((c) => c.id === id) || null);
    });
    vi.mocked(reportsService.getMatchingCounts).mockResolvedValue({
      invoiceCount: 42,
      paymentCount: 18,
    });
  });

  it('renders the report page heading, presets, customer filter and preview cards', async () => {
    render(<SalesReceiptsReportPage />);

    expect(screen.getByRole('heading', { name: /sales & receipts reports/i })).toBeInTheDocument();
    expect(screen.getByText(/one-click audit-ready Microsoft Excel/i)).toBeInTheDocument();

    // Check quick presets
    expect(screen.getByRole('button', { name: /current fy/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previous fy/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /current month/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /today/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /custom date range/i })).toBeInTheDocument();

    // Check action card
    expect(screen.getByRole('button', { name: /export excel \(\.xlsx\)/i })).toBeInTheDocument();

    // Wait for customer and counts to load
    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
      expect(screen.getByText('18')).toBeInTheDocument();
    });
  });

  it('displays Demo Mode badge when running in demo mode', async () => {
    setupOrgMock({ isDemoMode: true });
    render(<SalesReceiptsReportPage />);

    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    expect(screen.getByText(/demo mode \(local storage data\)/i)).toBeInTheDocument();
  });

  it('switches between presets (Month, Today, Custom) and updates inputs', async () => {
    render(<SalesReceiptsReportPage />);

    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    // Click "Current Month"
    fireEvent.click(screen.getByRole('button', { name: /current month/i }));
    expect(screen.getByLabelText(/select calendar month/i)).toBeInTheDocument();

    // Click "Today"
    fireEvent.click(screen.getByRole('button', { name: /today/i }));
    expect(screen.getByLabelText(/select specific day/i)).toBeInTheDocument();

    // Click "Custom Date Range"
    fireEvent.click(screen.getByRole('button', { name: /custom date range/i }));
    expect(screen.getByLabelText(/start date \(inclusive\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/end date \(inclusive\)/i)).toBeInTheDocument();
  });

  it('filters by customer and re-fetches counts', async () => {
    render(<SalesReceiptsReportPage />);

    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
      expect(screen.getByLabelText(/customer account/i)).toBeInTheDocument();
    });

    // Wait for debounced customer search to populate options
    const option = await screen.findByRole('option', { name: /Gayatri Electricals/i });
    expect(option).toBeInTheDocument();

    // Select Gayatri Electricals
    fireEvent.change(screen.getByLabelText(/customer account/i), {
      target: { value: 'cust-1' },
    });

    await waitFor(() => {
      expect(reportsService.getMatchingCounts).toHaveBeenCalledWith(
        mockOrg.id,
        expect.objectContaining({ customerId: 'cust-1' }),
        false
      );
    });
  });

  it('resets all filters when clicking "Reset Filters"', async () => {
    render(<SalesReceiptsReportPage />);

    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    // Wait for debounced customer search to populate options
    await screen.findByRole('option', { name: /Gayatri Electricals/i });

    // Switch to month and choose a customer
    fireEvent.click(screen.getByRole('button', { name: /current month/i }));
    fireEvent.change(screen.getByLabelText(/customer account/i), {
      target: { value: 'cust-1' },
    });

    // Click Reset
    fireEvent.click(screen.getByRole('button', { name: /reset filters/i }));

    // Should return to FY preset and empty customer
    expect(screen.getByLabelText(/indian financial year/i)).toBeInTheDocument();
    expect((screen.getByLabelText(/customer account/i) as HTMLSelectElement).value).toBe('');
  });

  it('searches customers via bounded server query and preserves selection', async () => {
    render(<SalesReceiptsReportPage />);

    await screen.findByRole('option', { name: /Gayatri Electricals/i });

    // Select Gayatri Electricals
    fireEvent.change(screen.getByLabelText(/customer account/i), {
      target: { value: 'cust-1' },
    });

    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();

    // Mock search returning only Kavitha Controls
    vi.mocked(customersService.getCustomersPaginated).mockResolvedValueOnce({
      data: [sampleCustomers[1]],
      total: 1,
      totalCount: 1,
      page: 1,
      pageSize: 25,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false,
    });

    // Search for another customer "Kavitha"
    const searchInput = screen.getByPlaceholderText(/search by name, company, phone/i);
    fireEvent.change(searchInput, { target: { value: 'Kavitha' } });

    await waitFor(() => {
      expect(customersService.getCustomersPaginated).toHaveBeenCalledWith(
        mockOrg.id,
        expect.objectContaining({ search: 'Kavitha' }),
        false
      );
    });

    // Selected customer remains preserved in dropdown despite new search query results
    expect(await screen.findByRole('option', { name: /Gayatri Electricals.*\[Selected\]/i })).toBeInTheDocument();
    expect((screen.getByLabelText(/customer account/i) as HTMLSelectElement).value).toBe('cust-1');
  });

  it('toggles between 5 and 15 financial years in the dropdown', async () => {
    render(<SalesReceiptsReportPage />);

    const toggleBtn = screen.getByRole('button', { name: /show 15 years/i });
    expect(toggleBtn).toBeInTheDocument();

    // Initial FY select should have 5 options
    const fySelect = screen.getByLabelText(/indian financial year/i);
    expect(fySelect.children.length).toBe(5);

    // Click toggle
    fireEvent.click(toggleBtn);
    expect(screen.getByRole('button', { name: /show 5 years/i })).toBeInTheDocument();
    expect(fySelect.children.length).toBe(15);
  });

  it('displays large export warning banner when invoice count exceeds threshold', async () => {
    vi.mocked(reportsService.getMatchingCounts).mockResolvedValue({
      invoiceCount: 12500,
      paymentCount: 8000,
    });

    render(<SalesReceiptsReportPage />);

    expect(await screen.findByText('12500')).toBeInTheDocument();
    expect(screen.getByText(/Large Export Safety Limit/i)).toBeInTheDocument();
    expect(screen.getByText(/12,500 invoices/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export excel \\(\\.xlsx\\)/i })).toBeDisabled();
  });

  it('triggers exportReport and initiates download on button click', async () => {
    const fakeBuffer = new ArrayBuffer(5000);
    vi.mocked(reportsService.exportReport).mockResolvedValue({
      buffer: fakeBuffer,
      filename: 'AtlasOS_Sales_Receipts_FY2025-26.xlsx',
    });

    render(<SalesReceiptsReportPage />);

    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    const exportBtn = screen.getByRole('button', { name: /export excel \(\.xlsx\)/i });
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(reportsService.exportReport).toHaveBeenCalledTimes(1);
      expect(ExcelModule.triggerExcelDownload).toHaveBeenCalledWith(
        fakeBuffer,
        'AtlasOS_Sales_Receipts_FY2025-26.xlsx'
      );
    });

    // Success banner
    expect(screen.getByText(/successfully exported atlasos_sales_receipts_fy2025-26\.xlsx/i)).toBeInTheDocument();
  });

  it('shows error banner when export fails and recovers gracefully', async () => {
    vi.mocked(reportsService.exportReport).mockRejectedValue(new Error('Network timeout fetching invoices'));

    render(<SalesReceiptsReportPage />);

    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    const exportBtn = screen.getByRole('button', { name: /export excel \(\.xlsx\)/i });
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(screen.getByText(/network timeout fetching invoices/i)).toBeInTheDocument();
    });

    // Button should be re-enabled after failure
    expect(screen.getByRole('button', { name: /export excel \(\.xlsx\)/i })).not.toBeDisabled();
  });
});
