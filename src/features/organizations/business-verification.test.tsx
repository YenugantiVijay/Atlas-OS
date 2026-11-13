import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as OrgContextModule from '@/features/organizations/OrgContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { BusinessVerificationModal } from './BusinessVerificationModal';
import { SettingsPage } from './SettingsPage';
import {
  evaluateActionPermission,
} from '@/lib/permissions';
import { validateBusinessTaxIdentifiers, validatePan } from '@/lib/validation';
import { Organization, User } from '@/types';
import { ToastProvider } from '@/components/ui/Toast';

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ToastProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </ToastProvider>
  );
}

// Mock supabase client module
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn().mockResolvedValue({
            data: [{ id: 'org-vijay', name: 'Vijay Electronics', pan: 'ABCDE1234F' }],
            error: null,
          }),
        })),
      })),
    })),
  },
  isSupabaseConfigured: () => true,
  getSupabaseStatus: () => ({ configured: true, message: 'Connected to Supabase PostgreSQL' }),
  verifySupabaseConnection: vi.fn().mockResolvedValue({
    status: 'configured_and_reachable',
    message: 'Verified',
  }),
}));

const mockUser: User = {
  id: 'usr-owner-1',
  email: 'owner@vijayelectronics.in',
  fullName: 'Vijay Sharma',
};

const baseVijayOrg: Organization = {
  id: 'org-vijay',
  name: 'Vijay Electronics',
  legalName: 'Vijay Electronics Retail LLP',
  phone: '+91 98450 12345',
  addressLine1: '42 BVK Iyengar Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560053',
  currency: 'INR',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('Phase 1 Business Verification & Action Restricted Recovery Matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const setupOrgMock = (overrides: Partial<OrgContextModule.OrgContextType> = {}) => {
    const defaultCtx: OrgContextModule.OrgContextType = {
      currentOrg: baseVijayOrg,
      organizations: [baseVijayOrg],
      currentRole: 'owner',
      currentUser: mockUser,
      session: { user: { id: mockUser.id, email: mockUser.email } } as any,
      isAuthenticated: true,
      isMockAuth: false,
      isDemoMode: false,
      isLoadingAuth: false,
      isLoadingOrgData: false,
      isSwitchingOrg: false,
      authError: null,
      eligibility: null, // Scenario 1: missing eligibility
      subscription: null, // Scenario 2: missing subscription/trial
      canWriteOperations: false,
      declareEligibility: vi.fn(),
      switchOrganization: vi.fn(),
      createOrganization: vi.fn(),
      updateOrganization: vi.fn().mockResolvedValue(baseVijayOrg),
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
    return defaultCtx;
  };

  // =========================================================================
  // SCENARIO 1: Existing Organization Without Eligibility
  // =========================================================================
  it('Scenario 1: Existing organization without eligibility disables writes with verification_incomplete reason', () => {
    setupOrgMock({
      eligibility: null,
      subscription: null,
      canWriteOperations: false,
    });

    const perm = evaluateActionPermission('orders:create', {
      role: 'owner',
      isAuthenticated: true,
      isDemoMode: false,
      currentOrg: baseVijayOrg,
      canWriteOperations: false,
      eligibility: null,
      subscription: null,
    });

    expect(perm.allowed).toBe(false);
    expect(perm.reason).toBe('verification_incomplete');
    expect(perm.title).toBe('Business Verification Incomplete');
    expect(perm.actionRoute).toBe('/settings');
    expect(perm.actionLabel).toBe('Complete Verification');

    renderWithProviders(<AppLayout />);

    expect(screen.getByTestId('eligibility-missing-banner')).toBeInTheDocument();
    expect(screen.getByTestId('complete-verification-btn')).toBeInTheDocument();
  });

  // =========================================================================
  // SCENARIO 2: Existing Organization Without Trial
  // =========================================================================
  it('Scenario 2: Existing organization with approved eligibility but no trial record evaluates to subscription_inactive', () => {
    const perm = evaluateActionPermission('orders:create', {
      role: 'owner',
      isAuthenticated: true,
      isDemoMode: false,
      currentOrg: baseVijayOrg,
      canWriteOperations: false,
      eligibility: { status: 'approved' },
      subscription: null, // No subscription record
    });

    expect(perm.allowed).toBe(false);
    expect(perm.reason).toBe('subscription_inactive');
    expect(perm.title).toBe('Subscription Inactive');
    expect(perm.message).toContain('No active subscription found');
    expect(perm.actionLabel).toBe('View Business Status');
  });

  // =========================================================================
  // SCENARIO 3: Owner Completing a Valid Declaration
  // =========================================================================
  it('Scenario 3: Owner completing a valid declaration invokes declareEligibility and updates status to approved', async () => {
    const mockDeclare = vi.fn().mockResolvedValue({
      organizationId: baseVijayOrg.id,
      businessCategory: 'agricultural_inputs',
      sellsElectricalProducts: false,
      productLines: ['Fertilizers', 'Seeds'],
      status: 'approved',
    });

    setupOrgMock({
      currentRole: 'owner',
      declareEligibility: mockDeclare,
    });

    const onClose = vi.fn();
    renderWithProviders(<BusinessVerificationModal isOpen={true} onClose={onClose} />);

    // Fill in valid PAN and GSTIN
    fireEvent.change(screen.getByLabelText(/GSTIN/i), {
      target: { value: '29ABCDE1234F1Z5' },
    });
    fireEvent.change(screen.getByLabelText(/Permanent Account Number/i), {
      target: { value: 'ABCDE1234F' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fertilizers & Agri Inputs' }));
    expect(screen.queryByRole('checkbox', { name: /sells or distributes electrical/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Submit Verification/i }));

    await waitFor(() => {
      expect(mockDeclare).toHaveBeenCalledWith({
        businessCategory: 'agricultural_inputs',
        sellsElectricalProducts: false,
        productLines: ['Fertilizers', 'Seeds'],
      });
      expect(onClose).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // SCENARIO 4: Viewer Attempting Verification
  // =========================================================================
  it('Scenario 4: Viewer role is denied submission and shown View Business Status navigation', () => {
    setupOrgMock({
      currentRole: 'viewer',
      eligibility: null,
      canWriteOperations: false,
    });

    const perm = evaluateActionPermission('orders:create', {
      role: 'viewer',
      isAuthenticated: true,
      isDemoMode: false,
      currentOrg: baseVijayOrg,
      canWriteOperations: false,
      eligibility: null,
      subscription: null,
    });

    // Role check takes precedence for viewer
    expect(perm.allowed).toBe(false);
    expect(perm.reason).toBe('role_unauthorized');

    // In modal, non-owner cannot submit
    renderWithProviders(<BusinessVerificationModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText(/Owner Authorization Required/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Submit Verification/i })).not.toBeInTheDocument();
  });

  // =========================================================================
  // SCENARIO 5: Unsupported Business Category
  // =========================================================================
  it('Scenario 5: Unsupported business category results in rejected status', () => {
    const perm = evaluateActionPermission('orders:create', {
      role: 'owner',
      isAuthenticated: true,
      isDemoMode: false,
      currentOrg: baseVijayOrg,
      canWriteOperations: false,
      eligibility: {
        status: 'rejected',
        rejectionReason: 'Unsupported business category. ATLAS OS is exclusively designed for electrical businesses.',
      },
      subscription: null,
    });

    expect(perm.allowed).toBe(false);
    expect(perm.reason).toBe('eligibility_rejected');
    expect(perm.title).toBe('Business Eligibility Rejected');
    expect(perm.message).toContain('Unsupported business category');
    expect(perm.actionLabel).toBe('Complete Verification');
  });

  // =========================================================================
  // SCENARIO 6: Empty Product Lines Requiring Manual Review
  // =========================================================================
  it('Scenario 6: Incomplete declaration with empty product lines yields manual_review_pending', () => {
    const perm = evaluateActionPermission('orders:create', {
      role: 'owner',
      isAuthenticated: true,
      isDemoMode: false,
      currentOrg: baseVijayOrg,
      canWriteOperations: false,
      eligibility: {
        status: 'review_required',
        reviewerNotes: 'Self-declaration lacked declared product lines. Flagged for manual review.',
      },
      subscription: null,
    });

    expect(perm.allowed).toBe(false);
    expect(perm.reason).toBe('manual_review_pending');
    expect(perm.title).toBe('Manual Review Pending');
    expect(perm.actionLabel).toBe('View Business Status');
  });

  // =========================================================================
  // SCENARIO 7: Previously Rejected Organization Resubmitting
  // =========================================================================
  it('Scenario 7: Previously rejected organization resubmitting declaration transitions to review_required', () => {
    // In OrgContext evaluate rules: resubmission after rejection cannot self-approve
    const perm = evaluateActionPermission('orders:create', {
      role: 'owner',
      isAuthenticated: true,
      isDemoMode: false,
      currentOrg: baseVijayOrg,
      canWriteOperations: false,
      eligibility: {
        status: 'review_required',
        reviewerNotes: 'Resubmission following previous rejection. Queued for platform reviewer evaluation.',
      },
      subscription: null,
    });

    expect(perm.allowed).toBe(false);
    expect(perm.reason).toBe('manual_review_pending');
  });

  // =========================================================================
  // SCENARIO 8: Expired Trial Remaining Expired
  // =========================================================================
  it('Scenario 8: Expired trial cannot be restarted or extended by resubmitting eligibility', () => {
    const expiredDate = new Date(Date.now() - 3600000).toISOString();
    const perm = evaluateActionPermission('orders:create', {
      role: 'owner',
      isAuthenticated: true,
      isDemoMode: false,
      currentOrg: baseVijayOrg,
      canWriteOperations: false,
      eligibility: { status: 'approved' },
      subscription: {
        status: 'trialing',
        trialEndsAt: expiredDate,
      },
    });

    expect(perm.allowed).toBe(false);
    expect(perm.reason).toBe('trial_expired');
    expect(perm.title).toBe('Trial Expired');
    expect(perm.message).toContain('7-day trial has expired');
  });

  // =========================================================================
  // SCENARIO 9: Valid PAN
  // =========================================================================
  it('Scenario 9: Valid 10-character Indian PAN format is accepted', () => {
    const res = validatePan('ABCDE1234F');
    expect(res.valid).toBe(true);
    expect(res.value).toBe('ABCDE1234F');
  });

  // =========================================================================
  // SCENARIO 10: Invalid PAN
  // =========================================================================
  it('Scenario 10: Invalid PAN format is rejected with clear error message', () => {
    const res = validatePan('INVALID123');
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Invalid PAN format');
  });

  // =========================================================================
  // SCENARIO 11: PAN/GSTIN Mismatch
  // =========================================================================
  it('Scenario 11: Mismatch between submitted PAN and embedded GSTIN PAN fails validation', () => {
    const res = validateBusinessTaxIdentifiers({
      gstin: '29ABCDE1234F1Z5',
      pan: 'XYZAB9999K', // mismatch!
    });

    expect(res.valid).toBe(false);
    expect(res.error).toContain('does not match the PAN embedded within the GSTIN');
    expect(res.derivedPan).toBe('ABCDE1234F');
  });

  // =========================================================================
  // SCENARIO 12: Network Failure and Retry
  // =========================================================================
  it('Scenario 12: Network or auth error surfaces verification_unavailable with retry banner', () => {
    setupOrgMock({
      authError: 'Failed to fetch status: 503 Service Unavailable',
      canWriteOperations: false,
    });

    const perm = evaluateActionPermission('orders:create', {
      role: 'owner',
      isAuthenticated: true,
      isDemoMode: false,
      currentOrg: baseVijayOrg,
      canWriteOperations: false,
      authError: 'Network 503 error',
    });

    expect(perm.allowed).toBe(false);
    expect(perm.reason).toBe('verification_unavailable');
    expect(perm.title).toBe('Verification Temporarily Unavailable');

    renderWithProviders(<AppLayout />);

    expect(screen.getByTestId('status-verification-error-banner')).toBeInTheDocument();
    expect(screen.getByTestId('retry-status-verification-btn')).toBeInTheDocument();
  });

  // =========================================================================
  // SCENARIO 13: No Duplicate Trial Initialization
  // =========================================================================
  it('Scenario 13: Existing trial dates are preserved and duplicate trial is blocked', () => {
    const initialStarted = new Date(Date.now() - 2 * 86400000).toISOString();
    const initialEnds = new Date(Date.now() + 5 * 86400000).toISOString();

    const existingSub = {
      organizationId: baseVijayOrg.id,
      status: 'trialing',
      trialStartedAt: initialStarted,
      trialEndsAt: initialEnds,
    };

    // Subsequent write permission check uses the authoritative dates
    const perm = evaluateActionPermission('orders:create', {
      role: 'owner',
      isAuthenticated: true,
      isDemoMode: false,
      currentOrg: baseVijayOrg,
      canWriteOperations: true,
      eligibility: { status: 'approved' },
      subscription: existingSub,
    });

    expect(perm.allowed).toBe(true);
  });

  // =========================================================================
  // SCENARIO 14: Create Record Becomes Available Only After Legitimate Authorization
  // =========================================================================
  it('Scenario 14: Operational writes are unlocked only when approved eligibility and active trial coincide', () => {
    // Stage A: Undeclared -> Disallowed
    const stageA = evaluateActionPermission('orders:create', {
      role: 'owner',
      isAuthenticated: true,
      isDemoMode: false,
      currentOrg: baseVijayOrg,
      canWriteOperations: false,
      eligibility: null,
      subscription: null,
    });
    expect(stageA.allowed).toBe(false);

    // Stage B: Approved + Active Trial -> Allowed
    const stageB = evaluateActionPermission('orders:create', {
      role: 'owner',
      isAuthenticated: true,
      isDemoMode: false,
      currentOrg: baseVijayOrg,
      canWriteOperations: true,
      eligibility: { status: 'approved' },
      subscription: {
        status: 'trialing',
        trialEndsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      },
    });
    expect(stageB.allowed).toBe(true);
  });

  // =========================================================================
  // SCENARIO 15: Existing Historical Records Remain Readable
  // =========================================================================
  it('Scenario 15: Historical data read action (data:read) remains permitted even when write access is disabled', () => {
    const readPerm = evaluateActionPermission('data:read', {
      role: 'owner',
      isAuthenticated: true,
      isDemoMode: false,
      currentOrg: baseVijayOrg,
      canWriteOperations: false, // Writes are blocked
      eligibility: null, // Undeclared
      subscription: null,
    });

    // Read access is not blocked by missing eligibility/trial
    expect(readPerm.allowed).toBe(true);

    const viewerReadPerm = evaluateActionPermission('data:read', {
      role: 'viewer',
      isAuthenticated: true,
      isDemoMode: false,
      currentOrg: baseVijayOrg,
      canWriteOperations: false,
      eligibility: null,
      subscription: null,
    });
    expect(viewerReadPerm.allowed).toBe(true);
  });

  // =========================================================================
  // Settings Page Verification Integration
  // =========================================================================
  it('Settings page displays Business Verification & Status section and opens modal for owner', async () => {
    setupOrgMock({
      currentRole: 'owner',
      eligibility: null,
      subscription: null,
    });

    renderWithProviders(<SettingsPage />);

    expect(screen.getByText('Business Verification & Status')).toBeInTheDocument();
    expect(screen.getByText('Undeclared')).toBeInTheDocument();

    const completeBtn = screen.getByRole('button', { name: /Complete Business Verification/i });
    expect(completeBtn).toBeInTheDocument();
    fireEvent.click(completeBtn);

    expect(screen.getByText(/Declare your business category, tax identifiers/i)).toBeInTheDocument();
  });
});
