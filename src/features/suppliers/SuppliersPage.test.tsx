import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SuppliersPage } from './SuppliersPage';
import * as OrgContextModule from '@/features/organizations/OrgContext';
import { suppliersService } from '@/services/suppliers.service';
import { Supplier, Organization } from '@/types';

// Mock Toast
const mockShowToast = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('SuppliersPage — Operational Write Restrictions & Read-Only Access', () => {
  const mockOrg: Organization = {
    id: 'org-test-supp-1',
    name: 'Polycab Distributors',
    currency: 'INR',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const sampleSuppliers: Supplier[] = [
    {
      id: 'supp-1',
      organizationId: 'org-test-supp-1',
      name: 'Havells India Regional Depot',
      companyName: 'Havells India Ltd',
      contactPerson: 'Suresh Kumar',
      phone: '+91 9876543210',
      email: 'depot@havells.com',
      address: 'Industrial Area, Phase 1',
      gstin: '29AAACH1234F1Z1',
      paymentTerms: '30 Days Net',
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'supp-2',
      organizationId: 'org-test-supp-1',
      name: 'Polycab Super Stockist',
      companyName: 'Polycab Wires Ltd',
      contactPerson: 'Ramesh Patel',
      phone: '+91 9876543211',
      email: 'stockist@polycab.com',
      address: 'Warehouse Complex',
      gstin: '29AAACP1234D1Z2',
      paymentTerms: '45 Days Net',
      isActive: true,
      createdAt: '2026-01-02T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
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
    return defaultCtx;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(suppliersService, 'getSuppliers').mockResolvedValue(sampleSuppliers);
    vi.spyOn(suppliersService, 'createSupplier').mockResolvedValue({
      id: 'supp-new',
      organizationId: mockOrg.id,
      name: 'Finolex Regional Depot',
      isActive: true,
      createdAt: '2026-01-03T00:00:00Z',
      updatedAt: '2026-01-03T00:00:00Z',
    });
  });

  // =========================================================================
  // 1. READ-ONLY BROWSING & SEARCHING
  // =========================================================================
  it('renders suppliers table and allows searching in read-only mode', async () => {
    setupOrgMock({ canWriteOperations: false });

    render(<SuppliersPage />);

    await waitFor(() => {
      expect(screen.getByText('Havells India Regional Depot')).toBeInTheDocument();
      expect(screen.getByText('Polycab Super Stockist')).toBeInTheDocument();
    });

    // Search query filters table items
    const searchInput = screen.getByLabelText('Search suppliers');
    fireEvent.change(searchInput, { target: { value: 'Havells' } });

    expect(screen.getByText('Havells India Regional Depot')).toBeInTheDocument();
    expect(screen.queryByText('Polycab Super Stockist')).not.toBeInTheDocument();
  });

  // =========================================================================
  // 2. OPERATIONAL WRITE RESTRICTIONS (canWriteOperations: false)
  // =========================================================================
  describe('When operational write access is disabled (canWriteOperations: false, live cloud)', () => {
    it('disables the Add Supplier header button with descriptive title tooltip', async () => {
      setupOrgMock({ canWriteOperations: false });

      render(<SuppliersPage />);

      await waitFor(() => {
        expect(screen.getByText('Havells India Regional Depot')).toBeInTheDocument();
      });

      const addBtn = screen.getByRole('button', { name: /add supplier/i });
      expect(addBtn).toBeDisabled();
      expect(addBtn).toHaveAttribute(
        'title',
        'Write operations are disabled for your account'
      );
    });

    it('hides the Add Supplier action in EmptyState when no suppliers exist', async () => {
      setupOrgMock({ canWriteOperations: false });
      vi.spyOn(suppliersService, 'getSuppliers').mockResolvedValue([]);

      render(<SuppliersPage />);

      await waitFor(() => {
        expect(screen.getByText('No suppliers found')).toBeInTheDocument();
      });

      // Header button is disabled
      const headerAddBtn = screen.getByRole('button', { name: /add supplier/i });
      expect(headerAddBtn).toBeDisabled();

      // EmptyState does not render an active action button
      const emptyStateContainer = screen.getByText('No suppliers found').closest('div');
      const emptyStateAddBtns = emptyStateContainer?.querySelectorAll('button');
      expect(emptyStateAddBtns?.length || 0).toBe(0);
    });

    it('disables the Add Supplier header button and prevents opening modal', async () => {
      setupOrgMock({ canWriteOperations: false });

      render(<SuppliersPage />);

      await waitFor(() => {
        expect(screen.getByText('Havells India Regional Depot')).toBeInTheDocument();
      });

      const addBtn = screen.getByRole('button', { name: /add supplier/i });
      expect(addBtn).toBeDisabled();

      fireEvent.click(addBtn);
      expect(screen.queryByText('Add Authorized Supplier')).not.toBeInTheDocument();
    });

    it('rejects form submission if write access is revoked while modal is open', async () => {
      // Start with write operations allowed
      setupOrgMock({ canWriteOperations: true });

      const { rerender } = render(<SuppliersPage />);

      await waitFor(() => {
        expect(screen.getByText('Havells India Regional Depot')).toBeInTheDocument();
      });

      // Open the modal
      fireEvent.click(screen.getByRole('button', { name: /add supplier/i }));
      expect(screen.getByText('Add Authorized Supplier')).toBeInTheDocument();

      // Revoke write access while modal is open
      setupOrgMock({ canWriteOperations: false });
      rerender(<SuppliersPage />);

      // Fill in details and attempt to submit form
      fireEvent.change(screen.getByLabelText(/Supplier Name \/ Depot/i), {
        target: { value: 'Blocked Supplier' },
      });

      const form = screen.getByRole('button', { name: /Save Supplier/i }).closest('form')!;
      fireEvent.submit(form);

      expect(mockShowToast).toHaveBeenCalledWith(
        'error',
        'Operation Restricted',
        expect.stringContaining('Write operations are disabled')
      );
      expect(suppliersService.createSupplier).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. ALLOWED WRITES (canWriteOperations: true)
  // =========================================================================
  describe('When operational write access is enabled (canWriteOperations: true)', () => {
    it('enables the Add Supplier button, opens modal, and saves new supplier', async () => {
      setupOrgMock({ canWriteOperations: true });

      render(<SuppliersPage />);

      await waitFor(() => {
        expect(screen.getByText('Havells India Regional Depot')).toBeInTheDocument();
      });

      const addBtn = screen.getByRole('button', { name: /add supplier/i });
      expect(addBtn).not.toBeDisabled();
      fireEvent.click(addBtn);

      expect(screen.getByText('Add Authorized Supplier')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/Supplier Name \/ Depot/i), {
        target: { value: 'Finolex Regional Depot' },
      });
      fireEvent.change(screen.getByLabelText(/Phone Number/i), {
        target: { value: '+91 9999988888' },
      });

      const submitBtn = screen.getByRole('button', { name: /Save Supplier/i });
      expect(submitBtn).not.toBeDisabled();
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(suppliersService.createSupplier).toHaveBeenCalledWith(
          mockOrg.id,
          expect.objectContaining({
            name: 'Finolex Regional Depot',
          }),
          false
        );
        expect(mockShowToast).toHaveBeenCalledWith(
          'success',
          'Supplier Registered',
          expect.stringContaining('Finolex Regional Depot')
        );
      });
    });
  });

  // =========================================================================
  // 4. DEMO / MOCK AUTH BYPASS
  // =========================================================================
  describe('When in Demo / Mock Auth mode', () => {
    it('permits write operations even if canWriteOperations is false', async () => {
      setupOrgMock({
        isMockAuth: true,
        isDemoMode: true,
        canWriteOperations: false,
      });

      render(<SuppliersPage />);

      await waitFor(() => {
        expect(screen.getByText('Havells India Regional Depot')).toBeInTheDocument();
      });

      const addBtn = screen.getByRole('button', { name: /add supplier/i });
      expect(addBtn).not.toBeDisabled();
      fireEvent.click(addBtn);

      expect(screen.getByText('Add Authorized Supplier')).toBeInTheDocument();
    });
  });
});
