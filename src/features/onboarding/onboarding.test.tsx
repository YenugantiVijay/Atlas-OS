import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { OnboardingPage } from './OnboardingPage';
import { AppLayout } from '@/components/layout/AppLayout';
import { AuthModal } from '@/features/auth/AuthModal';
import * as OrgContextModule from '@/features/organizations/OrgContext';
import { Organization, User } from '@/types';

// Mock Lucide icons
vi.mock('lucide-react', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    Building2: (props: any) => <span data-testid="icon-building" {...props} />,
    ArrowRight: (props: any) => <span data-testid="icon-arrow-right" {...props} />,
    AlertCircle: (props: any) => <span data-testid="icon-alert-circle" {...props} />,
    LogOut: (props: any) => <span data-testid="icon-logout" {...props} />,
    ShieldCheck: (props: any) => <span data-testid="icon-shield-check" {...props} />,
    Sparkles: (props: any) => <span data-testid="icon-sparkles" {...props} />,
    Lock: (props: any) => <span data-testid="icon-lock" {...props} />,
    Loader2: (props: any) => <span data-testid="icon-loader" {...props} />,
  };
});

// Mock Toast
const mockShowToast = vi.fn();
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('ATLAS OS Organization Onboarding Flow & Routing Gating Suite', () => {
  const mockUser: User = {
    id: 'user-new-001',
    email: 'newowner@electricals.in',
    fullName: 'Rajesh Sharma',
  };

  const sampleOrg1: Organization = {
    id: 'org-test-001',
    name: 'Sharma Electrical Distributors',
    legalName: 'Sharma Electricals Pvt Ltd',
    gstin: '29ABCDE1234F1Z5',
    pan: 'ABCDE1234F',
    currency: 'INR',
    createdAt: '2026-10-31T10:00:00Z',
    updatedAt: '2026-10-31T10:00:00Z',
  };

  const sampleOrg2: Organization = {
    id: 'org-test-002',
    name: 'Balaji Power Cables',
    currency: 'INR',
    createdAt: '2026-10-31T10:00:00Z',
    updatedAt: '2026-10-31T10:00:00Z',
  };

  const mockCreateOrganization = vi.fn();
  const mockSignIn = vi.fn();
  const mockSignUp = vi.fn();
  const mockSignOut = vi.fn();
  const mockSwitchOrganization = vi.fn();
  const mockEnterDemoMode = vi.fn();
  const mockExitDemoMode = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const setupOrgContextMock = (overrides: Partial<OrgContextModule.OrgContextType> = {}) => {
    const defaultContext: OrgContextModule.OrgContextType = {
      currentOrg: null,
      organizations: [],
      currentRole: null,
      currentUser: mockUser,
      session: { user: { id: mockUser.id, email: mockUser.email } } as any,
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
      switchOrganization: mockSwitchOrganization,
      createOrganization: mockCreateOrganization,
      updateOrganization: vi.fn(),
      updateCurrentUser: vi.fn(),
      refreshOrgData: vi.fn(),
      memberships: [],
      signIn: mockSignIn,
      signUp: mockSignUp,
      signOut: mockSignOut,
      enterDemoMode: mockEnterDemoMode,
      exitDemoMode: mockExitDemoMode,
      ...overrides,
    };

    vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue(defaultContext);
    return defaultContext;
  };

  describe('Requirement 1 & 2: Signup Lifecycle & Email Verification', () => {
    it('1. New signup with an active session leads directly to organization onboarding', async () => {
      setupOrgContextMock({ isAuthenticated: false });
      mockSignUp.mockResolvedValueOnce({ sessionPresent: true });

      const onClose = vi.fn();
      render(
        <MemoryRouter initialEntries={['/']}>
          <AuthModal isOpen={true} onClose={onClose} initialMode="signup" />
        </MemoryRouter>
      );

      fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: 'Rajesh Sharma' } });
      fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'rajesh@sharma.in' } });
      fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'securePass123' } });

      const submitBtn = screen.getByRole('button', { name: /Create Verified Account/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockSignUp).toHaveBeenCalledWith('rajesh@sharma.in', 'securePass123', 'Rajesh Sharma');
        expect(onClose).toHaveBeenCalled();
        expect(mockShowToast).toHaveBeenCalledWith('success', 'Account Created', expect.stringContaining('Rajesh Sharma'));
      });
    });

    it('2. Signup requiring email verification does not attempt organization creation prematurely', async () => {
      setupOrgContextMock({ isAuthenticated: false });
      mockSignUp.mockResolvedValueOnce({ sessionPresent: false }); // No active session yet

      const onClose = vi.fn();
      render(
        <MemoryRouter initialEntries={['/']}>
          <AuthModal isOpen={true} onClose={onClose} initialMode="signup" />
        </MemoryRouter>
      );

      fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: 'Rajesh Sharma' } });
      fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'rajesh@sharma.in' } });
      fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'securePass123' } });

      fireEvent.click(screen.getByRole('button', { name: /Create Verified Account/i }));

      await waitFor(() => {
        expect(mockSignUp).toHaveBeenCalled();
        // Modal must NOT close and must display the verification message
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByText(/Confirmation link sent to your email/i)).toBeInTheDocument();
        // Zero organization creation attempted
        expect(mockCreateOrganization).not.toHaveBeenCalled();
      });
    });
  });

  describe('Requirement 3, 4, 5, 9 & 10: Routing Gating & Existing-User Behavior', () => {
    it('3 & 9. Verified authenticated user with no organization is redirected to /onboarding and dashboard is inaccessible', () => {
      setupOrgContextMock({
        isAuthenticated: true,
        currentOrg: null,
        organizations: [],
      });

      render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/onboarding" element={<div data-testid="onboarding-page">Onboarding Screen</div>} />
            <Route path="/" element={<AppLayout />}>
              <Route index element={<div data-testid="dashboard-content">Dashboard Content</div>} />
              <Route path="products" element={<div data-testid="products-content">Products Content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );

      // Must be redirected to /onboarding
      expect(screen.getByTestId('onboarding-page')).toBeInTheDocument();
      // Zero dashboard content must be accessible
      expect(screen.queryByTestId('dashboard-content')).not.toBeInTheDocument();
    });

    it('4. Existing user with one organization goes directly to the dashboard without showing onboarding', () => {
      setupOrgContextMock({
        isAuthenticated: true,
        currentOrg: sampleOrg1,
        organizations: [sampleOrg1],
        currentRole: 'owner',
      });

      render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/onboarding" element={<div data-testid="onboarding-page">Onboarding Screen</div>} />
            <Route path="/" element={<AppLayout />}>
              <Route index element={<div data-testid="dashboard-content">Dashboard Content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByTestId('dashboard-content')).toBeInTheDocument();
      expect(screen.queryByTestId('onboarding-page')).not.toBeInTheDocument();
    });

    it('5. Existing user with multiple organizations retains organization switching without onboarding interruption', async () => {
      setupOrgContextMock({
        isAuthenticated: true,
        currentOrg: sampleOrg1,
        organizations: [sampleOrg1, sampleOrg2],
        currentRole: 'owner',
      });

      render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/onboarding" element={<div data-testid="onboarding-page">Onboarding Screen</div>} />
            <Route path="/" element={<AppLayout />}>
              <Route index element={<div data-testid="dashboard-content">Dashboard Content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByTestId('dashboard-content')).toBeInTheDocument();

      // Open organization switcher in Header and select sampleOrg2
      const orgTriggers = screen.getAllByRole('button', { name: new RegExp(sampleOrg1.name, 'i') });
      fireEvent.click(orgTriggers[0]);

      const org2Option = screen.getByText(sampleOrg2.name);
      fireEvent.click(org2Option);

      expect(mockSwitchOrganization).toHaveBeenCalledWith(sampleOrg2.id);
      expect(screen.queryByTestId('onboarding-page')).not.toBeInTheDocument();
    });

    it('10. Demo mode retains the existing sample organization and does not enter cloud onboarding', () => {
      setupOrgContextMock({
        isAuthenticated: false,
        isDemoMode: true,
        isMockAuth: true,
        currentOrg: sampleOrg1,
        organizations: [sampleOrg1],
        currentRole: 'owner',
      });

      render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/onboarding" element={<div data-testid="onboarding-page">Onboarding Screen</div>} />
            <Route path="/" element={<AppLayout />}>
              <Route index element={<div data-testid="dashboard-content">Dashboard Content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );

      // Must display demo dashboard banner and content
      expect(screen.getByText(/Demo Sandbox:/i)).toBeInTheDocument();
      expect(screen.getByTestId('dashboard-content')).toBeInTheDocument();
      expect(screen.queryByTestId('onboarding-page')).not.toBeInTheDocument();
    });
  });

  describe('Requirement 6, 7 & 8: Onboarding Form, Idempotency & Failure Recovery', () => {
    it('6. Successful organization creation activates the new organization and owner role', async () => {
      setupOrgContextMock({
        isAuthenticated: true,
        currentOrg: null,
        organizations: [],
      });

      mockCreateOrganization.mockResolvedValueOnce({
        id: 'org-created-001',
        name: 'Sri Krishna Electricals',
        currency: 'INR',
      });

      render(
        <MemoryRouter initialEntries={['/onboarding']}>
          <Routes>
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/" element={<div data-testid="dashboard-destination">Main Dashboard</div>} />
          </Routes>
        </MemoryRouter>
      );

      // Verify form elements rendered
      expect(screen.getByText(/Set Up Your Distributor Organization/i)).toBeInTheDocument();

      // Enter organization details
      fireEvent.change(screen.getByLabelText(/Distributor Business Name/i), {
        target: { value: 'Sri Krishna Electricals' },
      });
      fireEvent.change(screen.getByLabelText(/GSTIN/i), {
        target: { value: '29ABCDE1234F1Z5' },
      });

      // Assert PAN was auto-derived from GSTIN
      expect((screen.getByLabelText(/PAN/i) as HTMLInputElement).value).toBe('ABCDE1234F');

      fireEvent.change(screen.getByLabelText(/Primary Phone Number/i), {
        target: { value: '+91 9876543210' },
      });
      fireEvent.change(screen.getByLabelText(/City/i), {
        target: { value: 'Bengaluru' },
      });

      const submitBtn = screen.getByRole('button', { name: /Create My Organization/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockCreateOrganization).toHaveBeenCalledTimes(1);
        const passedPayload = mockCreateOrganization.mock.calls[0][0];
        expect(passedPayload.name).toBe('Sri Krishna Electricals');
        expect(passedPayload.gstin).toBe('29ABCDE1234F1Z5');
        expect(passedPayload.pan).toBe('ABCDE1234F');
        expect(passedPayload.currency).toBe('INR');
        expect(passedPayload.idempotencyKey).toBeDefined();

        // Navigates to dashboard
        expect(screen.getByTestId('dashboard-destination')).toBeInTheDocument();
      });
    });

    it('7. Failed organization creation preserves form inputs and allows safe retry with the same idempotency key', async () => {
      setupOrgContextMock({
        isAuthenticated: true,
        currentOrg: null,
        organizations: [],
      });

      // First attempt fails with transient network error
      mockCreateOrganization.mockRejectedValueOnce(new Error('Connection timeout to Supabase RPC'));

      render(
        <MemoryRouter initialEntries={['/onboarding']}>
          <Routes>
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/" element={<div data-testid="dashboard-destination">Main Dashboard</div>} />
          </Routes>
        </MemoryRouter>
      );

      fireEvent.change(screen.getByLabelText(/Distributor Business Name/i), {
        target: { value: 'Nandi Electrical Agency' },
      });
      fireEvent.change(screen.getByLabelText(/Street \/ Shop \/ Warehouse Address/i), {
        target: { value: '12 Industrial Area' },
      });

      const submitBtn = screen.getByRole('button', { name: /Create My Organization/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockCreateOrganization).toHaveBeenCalledTimes(1);
        expect(screen.getByText(/Connection timeout to Supabase RPC/i)).toBeInTheDocument();
      });

      // Inputs MUST be preserved
      expect((screen.getByLabelText(/Distributor Business Name/i) as HTMLInputElement).value).toBe(
        'Nandi Electrical Agency'
      );
      expect((screen.getByLabelText(/Street \/ Shop \/ Warehouse Address/i) as HTMLInputElement).value).toBe(
        '12 Industrial Area'
      );

      const firstKeyUsed = mockCreateOrganization.mock.calls[0][0].idempotencyKey;

      // Second attempt succeeds
      mockCreateOrganization.mockResolvedValueOnce({
        id: 'org-nandi-001',
        name: 'Nandi Electrical Agency',
      });

      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockCreateOrganization).toHaveBeenCalledTimes(2);
        const secondKeyUsed = mockCreateOrganization.mock.calls[1][0].idempotencyKey;
        // Same logical attempt MUST reuse the same idempotency key for server-side deduplication
        expect(secondKeyUsed).toBe(firstKeyUsed);
        expect(screen.getByTestId('dashboard-destination')).toBeInTheDocument();
      });
    });

    it('8. Idempotency Conflict: Changed persisted details with same key displays conflict error and reset button', async () => {
      setupOrgContextMock({
        isAuthenticated: true,
        currentOrg: null,
        organizations: [],
      });

      mockCreateOrganization.mockRejectedValueOnce(
        new Error('ERR_IDEMPOTENCY_CONFLICT: Idempotency key reused with different request payload')
      );

      render(
        <MemoryRouter initialEntries={['/onboarding']}>
          <Routes>
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/" element={<div data-testid="dashboard-destination">Main Dashboard</div>} />
          </Routes>
        </MemoryRouter>
      );

      fireEvent.change(screen.getByLabelText(/Distributor Business Name/i), {
        target: { value: 'Apex Electricals' },
      });

      const submitBtn = screen.getByRole('button', { name: /Create My Organization/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText(/submission conflict occurred/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Reset Submission Key/i })).toBeInTheDocument();
      });

      // Clicking Reset Submission Key resets the conflict and allows retry
      fireEvent.click(screen.getByRole('button', { name: /Reset Submission Key/i }));
      expect(screen.queryByText(/submission conflict occurred/i)).not.toBeInTheDocument();
    });

    it('9. Organization-loading network failure does not redirect to onboarding and renders recoverable error state in AppLayout', () => {
      const mockRefresh = vi.fn();
      setupOrgContextMock({
        isAuthenticated: true,
        currentOrg: null,
        organizations: [],
        authError: 'Failed to load organizations: network timeout',
        refreshOrgData: mockRefresh,
      });

      render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/onboarding" element={<div data-testid="onboarding-page">Onboarding Screen</div>} />
            <Route path="/" element={<AppLayout />}>
              <Route index element={<div data-testid="dashboard-content">Dashboard Content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );

      // Must NOT redirect to /onboarding
      expect(screen.queryByTestId('onboarding-page')).not.toBeInTheDocument();
      // Must NOT show dashboard content
      expect(screen.queryByTestId('dashboard-content')).not.toBeInTheDocument();
      // Must render recoverable error UI
      expect(screen.getByRole('heading', { name: /Failed to Load Organizations/i })).toBeInTheDocument();
      expect(screen.getByText(/Failed to load organizations: network timeout/i)).toBeInTheDocument();

      // Retry connection triggers refreshOrgData
      const retryBtn = screen.getByRole('button', { name: /Retry Connection/i });
      fireEvent.click(retryBtn);
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });

    it('10. Visiting /onboarding directly when user already has existing organizations redirects to dashboard', () => {
      setupOrgContextMock({
        isAuthenticated: true,
        currentOrg: sampleOrg1,
        organizations: [sampleOrg1],
        currentRole: 'owner',
      });

      render(
        <MemoryRouter initialEntries={['/onboarding']}>
          <Routes>
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/" element={<div data-testid="dashboard-content">Dashboard Screen</div>} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByTestId('dashboard-content')).toBeInTheDocument();
      expect(screen.queryByText(/Set Up Your Distributor Organization/i)).not.toBeInTheDocument();
    });

    it('11. Visiting /onboarding when authError is present renders recoverable error state and prevents duplicate org creation', () => {
      const mockRefresh = vi.fn();
      setupOrgContextMock({
        isAuthenticated: true,
        currentOrg: null,
        organizations: [],
        authError: 'Failed to verify organization status: 503 Service Unavailable',
        refreshOrgData: mockRefresh,
      });

      render(
        <MemoryRouter initialEntries={['/onboarding']}>
          <Routes>
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/" element={<div data-testid="dashboard-content">Dashboard Screen</div>} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText(/Unable to Verify Organizations/i)).toBeInTheDocument();
      expect(screen.getByText(/Failed to verify organization status: 503 Service Unavailable/i)).toBeInTheDocument();
      expect(screen.queryByText(/Set Up Your Distributor Organization/i)).not.toBeInTheDocument();

      const retryBtn = screen.getByRole('button', { name: /Retry Connection/i });
      fireEvent.click(retryBtn);
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });
  });

  describe('Part A: Auth Race Condition & isLoadingOrgData Gating', () => {
    it('13. isLoadingOrgData shows full-screen initialization loader and prevents premature onboarding redirect while queries are in-flight', () => {
      setupOrgContextMock({
        isAuthenticated: true,
        isLoadingAuth: false,
        isLoadingOrgData: true, // Data still querying from Supabase
        currentOrg: null,
        organizations: [], // Empty array during load must NOT trigger redirect!
      });

      render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/onboarding" element={<div data-testid="onboarding-page">Onboarding Screen</div>} />
            <Route path="/" element={<AppLayout />}>
              <Route index element={<div data-testid="dashboard-content">Dashboard Content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );

      // Full screen loader is shown
      expect(screen.getByText(/Initializing Atlas OS\.\.\./i)).toBeInTheDocument();
      // MUST NOT be redirected to /onboarding while isLoadingOrgData is true
      expect(screen.queryByTestId('onboarding-page')).not.toBeInTheDocument();
      expect(screen.queryByTestId('dashboard-content')).not.toBeInTheDocument();
    });
  });

  describe('Part B & C: Business Eligibility Integration in Onboarding', () => {
    it('14. Onboarding form captures business category, sells electrical products declaration, and product lines', async () => {
      setupOrgContextMock({
        isAuthenticated: true,
        currentOrg: null,
        organizations: [],
      });

      mockCreateOrganization.mockResolvedValueOnce({
        id: 'org-created-002',
        name: 'Venkata Power Distributors',
        currency: 'INR',
      });

      render(
        <MemoryRouter initialEntries={['/onboarding']}>
          <Routes>
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/" element={<div data-testid="dashboard-destination">Main Dashboard</div>} />
          </Routes>
        </MemoryRouter>
      );

      // Business name
      fireEvent.change(screen.getByLabelText(/Distributor Business Name/i), {
        target: { value: 'Venkata Power Distributors' },
      });

      // Select Business Category: Electrical Retail Shop
      const retailBtn = screen.getByRole('button', { name: /Electrical Retail Shop/i });
      fireEvent.click(retailBtn);

      // Add a custom product line
      const customInput = screen.getByPlaceholderText(/Add another product line/i);
      fireEvent.change(customInput, { target: { value: 'Industrial Control Panels' } });
      const addBtn = screen.getByRole('button', { name: /^Add$/i });
      fireEvent.click(addBtn);

      // Submit form
      const submitBtn = screen.getByRole('button', { name: /Create My Organization/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockCreateOrganization).toHaveBeenCalledTimes(1);
        const payload = mockCreateOrganization.mock.calls[0][0];
        expect(payload.name).toBe('Venkata Power Distributors');
        expect(payload.businessCategory).toBe('electrical_retail');
        expect(payload.sellsElectricalProducts).toBe(true);
        expect(payload.productLines).toContain('Industrial Control Panels');
      });
    });
  });

  describe('Part D: Operational Access Model & Banners in AppLayout', () => {
    it('15. AppLayout displays Eligibility Rejected banner when eligibility.status is rejected', () => {
      setupOrgContextMock({
        isAuthenticated: true,
        currentOrg: sampleOrg1,
        organizations: [sampleOrg1],
        currentRole: 'owner',
        canWriteOperations: false,
        eligibility: {
          organizationId: sampleOrg1.id,
          businessCategory: 'other_unsupported',
          sellsElectricalProducts: false,
          productLines: [],
          status: 'rejected',
          rejectionReason: 'Business model outside authorized electrical trade scope.',
          declaredAt: '2026-10-31T10:00:00Z',
          declaredBy: mockUser.id,
        },
      });

      render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<AppLayout />}>
              <Route index element={<div data-testid="dashboard-content">Dashboard Content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByTestId('eligibility-rejected-banner')).toBeInTheDocument();
      expect(screen.getByText(/Business Eligibility Rejected/i)).toBeInTheDocument();
      expect(
        screen.getByText(/Business model outside authorized electrical trade scope\./i)
      ).toBeInTheDocument();
    });

    it('16. AppLayout displays Review Required banner when eligibility.status is review_required', () => {
      setupOrgContextMock({
        isAuthenticated: true,
        currentOrg: sampleOrg1,
        organizations: [sampleOrg1],
        currentRole: 'owner',
        canWriteOperations: false,
        eligibility: {
          organizationId: sampleOrg1.id,
          businessCategory: 'hardware_electrical',
          sellsElectricalProducts: true,
          productLines: [],
          status: 'review_required',
          declaredAt: '2026-10-31T10:00:00Z',
          declaredBy: mockUser.id,
        },
      });

      render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<AppLayout />}>
              <Route index element={<div data-testid="dashboard-content">Dashboard Content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByTestId('eligibility-review-banner')).toBeInTheDocument();
      expect(
        screen.getByText(/Eligibility Declaration Pending Manual Review/i)
      ).toBeInTheDocument();
    });

    it('17. AppLayout displays Trial Expired banner when 7-day trial has elapsed and writes are denied', () => {
      setupOrgContextMock({
        isAuthenticated: true,
        currentOrg: sampleOrg1,
        organizations: [sampleOrg1],
        currentRole: 'owner',
        canWriteOperations: false,
        eligibility: {
          organizationId: sampleOrg1.id,
          businessCategory: 'electrical_retail',
          sellsElectricalProducts: true,
          productLines: ['Wires & Cables'],
          status: 'approved',
          declaredAt: '2026-10-20T10:00:00Z',
          declaredBy: mockUser.id,
        },
        subscription: {
          organizationId: sampleOrg1.id,
          status: 'trialing',
          planTier: 'trial',
          trialStartedAt: '2026-10-20T10:00:00Z',
          trialEndsAt: '2026-10-27T10:00:00Z', // Expired
          paymentMethodEntered: false,
        },
      });

      render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<AppLayout />}>
              <Route index element={<div data-testid="dashboard-content">Dashboard Content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByTestId('subscription-expired-banner')).toBeInTheDocument();
      expect(screen.getByText(/7-Day Trial Expired/i)).toBeInTheDocument();
    });

    it('18. Quick Create displays warning toast and restricts navigation when canWriteOperations is false', () => {
      setupOrgContextMock({
        isAuthenticated: true,
        currentOrg: sampleOrg1,
        organizations: [sampleOrg1],
        currentRole: 'owner',
        canWriteOperations: false,
      });

      render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<AppLayout />}>
              <Route index element={<div data-testid="dashboard-content">Dashboard Content</div>} />
            </Route>
            <Route path="/orders" element={<div data-testid="orders-page">Orders Page</div>} />
          </Routes>
        </MemoryRouter>
      );

      // Open Quick Create menu from Header and click Sales Order
      const quickCreateTrigger = screen.getByRole('button', { name: /Quick Create/i });
      fireEvent.click(quickCreateTrigger);

      const salesOrderOption = screen.getByRole('button', { name: /New Sales Order/i });
      fireEvent.click(salesOrderOption);

      expect(mockShowToast).toHaveBeenCalledWith(
        'warning',
        'Action Restricted',
        expect.stringContaining('Operational write access is disabled')
      );
      expect(screen.queryByTestId('orders-page')).not.toBeInTheDocument();
    });
  });
});
