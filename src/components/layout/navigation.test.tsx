import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { RequirePermission } from '@/app/router';
import { ToastProvider } from '@/components/ui/Toast';
import * as OrgContextModule from '@/features/organizations/OrgContext';
import { Role, Organization, User } from '@/types';
import { hasPermission } from '@/lib/permissions';

const renderWithProviders = (ui: React.ReactElement, initialEntries: string[] = ['/']) => {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={initialEntries}>
        {ui}
      </MemoryRouter>
    </ToastProvider>
  );
};

// Mock Lucide icons for fast, clean DOM assertions
vi.mock('lucide-react', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    ShieldCheck: (props: any) => <span data-testid="icon-shield-check" {...props} />,
    History: (props: any) => <span data-testid="icon-history" {...props} />,
    LayoutDashboard: (props: any) => <span data-testid="icon-dashboard" {...props} />,
  };
});

describe('Atlas OS Navigation, Identity Fallbacks & Role-Based Access', () => {
  const mockOrgWithLocation: Organization = {
    id: 'org-karnataka-01',
    name: 'Bangalore Electrical Supply',
    city: 'Bengaluru',
    state: 'Karnataka',
    currency: 'INR',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const mockOrgNoLocation: Organization = {
    id: 'org-no-loc-02',
    name: 'Global Tech Distributors',
    city: undefined,
    state: undefined,
    currency: 'INR',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const mockOrgCityOnly: Organization = {
    id: 'org-city-03',
    name: 'Mumbai Central Stores',
    city: 'Mumbai',
    state: undefined,
    currency: 'INR',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const mockOrgStateOnly: Organization = {
    id: 'org-state-04',
    name: 'Goa Coastal Supplies',
    city: undefined,
    state: 'Goa',
    currency: 'INR',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const mockUser: User = {
    id: 'u-123',
    email: 'priya.sharma@enterprise.in',
    fullName: 'Priya Sharma',
  };

  const baseOrgContext: OrgContextModule.OrgContextType = {
    currentOrg: mockOrgWithLocation,
    organizations: [mockOrgWithLocation, mockOrgNoLocation],
    currentRole: 'owner',
    currentUser: mockUser,
    session: null,
    isAuthenticated: false,
    isMockAuth: true,
    isDemoMode: true,
    isLoadingAuth: false,
    authError: null,
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
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. DUPLICATE AUDIT / ACTIVITY FEED CONSOLIDATION & ACTIVE STATES
  // =========================================================================
  describe('Audit Navigation Consolidation & Route Consistency', () => {
    it('consolidates navigation into exactly ONE "/audit" entry titled "Audit Trail" with ShieldCheck icon', () => {
      vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
        ...baseOrgContext,
        currentRole: 'owner',
      });

      render(
        <MemoryRouter initialEntries={['/']}>
          <Sidebar collapsed={false} onToggle={() => {}} />
        </MemoryRouter>
      );

      // Verify "Activity Feed" is completely removed
      expect(screen.queryByText('Activity Feed')).toBeNull();

      // Verify "Audit Trail" is present
      const auditTrailLinks = screen.getAllByRole('link', { name: /audit trail/i });
      expect(auditTrailLinks).toHaveLength(1);
      expect(auditTrailLinks[0]).toHaveAttribute('href', '/audit');

      // Verify ShieldCheck icon is used for Audit Trail
      expect(screen.getByTestId('icon-shield-check')).toBeInTheDocument();
    });

    it('ensures Dashboard NavLink uses exact matching so it does not stay active on other routes', () => {
      vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
        ...baseOrgContext,
        currentRole: 'owner',
      });

      render(
        <MemoryRouter initialEntries={['/audit']}>
          <Sidebar collapsed={false} onToggle={() => {}} />
        </MemoryRouter>
      );

      const dashboardLink = screen.getByRole('link', { name: /dashboard/i });
      const auditLink = screen.getByRole('link', { name: /audit trail/i });

      // Dashboard should NOT have the active class on /audit
      expect(dashboardLink.className).not.toContain('bg-atlas-50');
      // Audit Trail should have active styling
      expect(auditLink.className).toContain('bg-atlas-50');
    });
  });

  // =========================================================================
  // 2. MISSING PROFILES & NEUTRAL IDENTITY FALLBACKS
  // =========================================================================
  describe('User Identity & Missing Profile Fallbacks', () => {
    it('displays the authenticated user real profile information when present', () => {
      vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
        ...baseOrgContext,
        currentUser: mockUser,
      });

      renderWithProviders(
        <Header
          collapsed={false}
          onOpenCommandPalette={() => {}}
          onOpenQuickCreate={() => {}}
          onOpenNewOrgModal={() => {}}
        />
      );

      // Header capsule displays user name
      expect(screen.getAllByText(/Priya Sharma/i).length).toBeGreaterThan(0);
      // Initials "PS" derived from "Priya Sharma"
      expect(screen.getByText('PS')).toBeInTheDocument();
      // Must NOT contain hard-coded Vijay Kumar
      expect(screen.queryByText('Vijay Kumar')).toBeNull();
      expect(screen.queryByText('VK')).toBeNull();
    });

    it('displays neutral fallbacks ("User", "U") when currentUser is missing/null, never sample names', () => {
      vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
        ...baseOrgContext,
        currentUser: null,
      });

      renderWithProviders(
        <Header
          collapsed={false}
          onOpenCommandPalette={() => {}}
          onOpenQuickCreate={() => {}}
          onOpenNewOrgModal={() => {}}
        />
      );

      // Must display neutral "User"
      expect(screen.getAllByText(/User/i).length).toBeGreaterThan(0);
      // Initials fallback must be "U", never "VK"
      expect(screen.getByText('U')).toBeInTheDocument();
      // Hardcoded sample credentials must be completely absent
      expect(screen.queryByText('Vijay Kumar')).toBeNull();
      expect(screen.queryByText('vijay@srilakshmielectricals.in')).toBeNull();
      expect(screen.queryByText('VK')).toBeNull();
    });

    it('derives initials and name from email prefix when fullName is missing', () => {
      vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
        ...baseOrgContext,
        currentUser: {
          id: 'u-anon',
          email: 'alex.taylor@enterprise.com',
          fullName: '',
        },
      });

      renderWithProviders(
        <Header
          collapsed={false}
          onOpenCommandPalette={() => {}}
          onOpenQuickCreate={() => {}}
          onOpenNewOrgModal={() => {}}
        />
      );

      // Displays email prefix or email cleanly
      expect(screen.getAllByText(/alex\.taylor/i).length).toBeGreaterThan(0);
      expect(screen.queryByText('Vijay Kumar')).toBeNull();
      expect(screen.queryByText('VK')).toBeNull();
    });

    it('opens Edit Profile modal with empty defaults if profile is missing, never sample identity', () => {
      vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
        ...baseOrgContext,
        currentUser: null,
      });

      renderWithProviders(
        <Header
          collapsed={false}
          onOpenCommandPalette={() => {}}
          onOpenQuickCreate={() => {}}
          onOpenNewOrgModal={() => {}}
        />
      );

      // Open user dropdown
      const userButton = screen.getByTitle('User Profile & Shop Menu');
      fireEvent.click(userButton);

      // Click Edit Profile & Photo button
      const editButton = screen.getByText('Edit Profile & Photo');
      fireEvent.click(editButton);

      // Inputs should have empty values and neutral placeholders, not "Vijay Kumar"
      const nameInput = screen.getByLabelText(/Full Name/i) as HTMLInputElement;
      const emailInput = screen.getByLabelText(/Email Address/i) as HTMLInputElement;

      expect(nameInput.value).toBe('');
      expect(emailInput.value).toBe('');
      expect(nameInput.placeholder).toBe('Enter your full name');
      expect(emailInput.placeholder).toBe('Enter your email address');
    });
  });

  // =========================================================================
  // 3. ORGANIZATION LOCATION & NEUTRAL FALLBACKS
  // =========================================================================
  describe('Organization Location Presentation & Neutral Fallbacks', () => {
    it('displays organization city and state when both are available', () => {
      vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
        ...baseOrgContext,
        currentOrg: mockOrgWithLocation,
      });

      render(
        <MemoryRouter initialEntries={['/']}>
          <Sidebar collapsed={false} onToggle={() => {}} />
        </MemoryRouter>
      );

      expect(screen.getByText('Bengaluru, Karnataka')).toBeInTheDocument();
    });

    it('displays only city when state is missing', () => {
      vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
        ...baseOrgContext,
        currentOrg: mockOrgCityOnly,
      });

      render(
        <MemoryRouter initialEntries={['/']}>
          <Sidebar collapsed={false} onToggle={() => {}} />
        </MemoryRouter>
      );

      expect(screen.getByText('Mumbai')).toBeInTheDocument();
      expect(screen.queryByText(/Karnataka/i)).toBeNull();
    });

    it('displays only state when city is missing', () => {
      vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
        ...baseOrgContext,
        currentOrg: mockOrgStateOnly,
      });

      render(
        <MemoryRouter initialEntries={['/']}>
          <Sidebar collapsed={false} onToggle={() => {}} />
        </MemoryRouter>
      );

      expect(screen.getByText('Goa')).toBeInTheDocument();
      expect(screen.queryByText(/Karnataka/i)).toBeNull();
    });

    it('displays neutral "Location not set" when city and state are missing, never hardcoded Karnataka', () => {
      vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
        ...baseOrgContext,
        currentOrg: mockOrgNoLocation,
      });

      render(
        <MemoryRouter initialEntries={['/']}>
          <Sidebar collapsed={false} onToggle={() => {}} />
        </MemoryRouter>
      );

      // Must display "Location not set"
      expect(screen.getByText('Location not set')).toBeInTheDocument();
      // Must NOT leak hardcoded "Karnataka, India"
      expect(screen.queryByText('Karnataka, India')).toBeNull();
    });

    it('displays neutral "Location not set" in Header organization dropdown when org location is missing', () => {
      vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
        ...baseOrgContext,
        currentOrg: mockOrgNoLocation,
        organizations: [mockOrgNoLocation],
      });

      renderWithProviders(
        <Header
          collapsed={false}
          onOpenCommandPalette={() => {}}
          onOpenQuickCreate={() => {}}
          onOpenNewOrgModal={() => {}}
        />
      );

      // Open org dropdown
      const orgDropdownBtn = screen.getAllByRole('button', { name: /Global Tech Distributors/i })[0];
      fireEvent.click(orgDropdownBtn);

      expect(screen.getByText('Location not set')).toBeInTheDocument();
      expect(screen.queryByText('India')).toBeNull();
    });
  });

  // =========================================================================
  // 4. ORGANIZATION SWITCHING
  // =========================================================================
  describe('Organization Switching', () => {
    it('triggers switchOrganization with target org ID when selecting another organization', () => {
      const switchOrgMock = vi.fn();
      vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
        ...baseOrgContext,
        currentOrg: mockOrgWithLocation,
        organizations: [mockOrgWithLocation, mockOrgNoLocation],
        switchOrganization: switchOrgMock,
      });

      renderWithProviders(
        <Header
          collapsed={false}
          onOpenCommandPalette={() => {}}
          onOpenQuickCreate={() => {}}
          onOpenNewOrgModal={() => {}}
        />
      );

      // Open organization menu
      const orgButton = screen.getAllByRole('button', { name: /Bangalore Electrical Supply/i })[0];
      fireEvent.click(orgButton);

      // Select second organization from the opened dropdown
      const targetOrgBtn = screen.getByRole('button', { name: /Global Tech Distributors/i });
      fireEvent.click(targetOrgBtn);

      expect(switchOrgMock).toHaveBeenCalledWith('org-no-loc-02');
    });
  });

  // =========================================================================
  // 5. NAVIGATION VISIBILITY BY ROLE & ROUTE GUARDS
  // =========================================================================
  describe('Role-Based Navigation Visibility & Route Guards', () => {
    it('shows full Administration section (Team, Audit, Org Settings) for owner role', () => {
      vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
        ...baseOrgContext,
        currentRole: 'owner',
      });

      render(
        <MemoryRouter initialEntries={['/']}>
          <Sidebar collapsed={false} onToggle={() => {}} />
        </MemoryRouter>
      );

      expect(screen.getByText('Administration')).toBeInTheDocument();
      expect(screen.getByText('Team & Access')).toBeInTheDocument();
      expect(screen.getByText('Audit Trail')).toBeInTheDocument();
      expect(screen.getByText('Org Settings')).toBeInTheDocument();
    });

    it('shows Team & Access and Audit Trail for admin, but hides Org Settings', () => {
      vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
        ...baseOrgContext,
        currentRole: 'admin',
      });

      render(
        <MemoryRouter initialEntries={['/']}>
          <Sidebar collapsed={false} onToggle={() => {}} />
        </MemoryRouter>
      );

      expect(screen.getByText('Administration')).toBeInTheDocument();
      expect(screen.getByText('Team & Access')).toBeInTheDocument();
      expect(screen.getByText('Audit Trail')).toBeInTheDocument();
      // Admin lacks 'org:manage'
      expect(screen.queryByText('Org Settings')).toBeNull();
    });

    it('completely hides Administration section for sales, inventory, accounts, and viewer roles', () => {
      const nonAdminRoles: Role[] = ['sales', 'inventory', 'accounts', 'viewer'];

      for (const role of nonAdminRoles) {
        vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
          ...baseOrgContext,
          currentRole: role,
        });

        const { unmount } = render(
          <MemoryRouter initialEntries={['/']}>
            <Sidebar collapsed={false} onToggle={() => {}} />
          </MemoryRouter>
        );

        expect(screen.queryByText('Administration')).toBeNull();
        expect(screen.queryByText('Team & Access')).toBeNull();
        expect(screen.queryByText('Audit Trail')).toBeNull();
        expect(screen.queryByText('Org Settings')).toBeNull();

        unmount();
      }
    });

    it('completely hides action-guarded items when currentRole is null (deny-by-default)', () => {
      vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
        ...baseOrgContext,
        currentRole: null,
      });

      render(
        <MemoryRouter initialEntries={['/']}>
          <Sidebar collapsed={false} onToggle={() => {}} />
        </MemoryRouter>
      );

      // Only items without required actions (Dashboard) are shown
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.queryByText('Sales Orders')).toBeNull();
      expect(screen.queryByText('Administration')).toBeNull();
    });

    it('RequirePermission route guard redirects unauthorized roles to "/"', () => {
      // Viewer attempting to access /settings
      vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
        ...baseOrgContext,
        currentRole: 'viewer',
      });

      render(
        <MemoryRouter initialEntries={['/settings']}>
          <Routes>
            <Route path="/" element={<div data-testid="home-page">Home Page</div>} />
            <Route
              path="/settings"
              element={
                <RequirePermission action="org:manage">
                  <div data-testid="settings-page">Protected Settings</div>
                </RequirePermission>
              }
            />
          </Routes>
        </MemoryRouter>
      );

      // Should be redirected to home page
      expect(screen.getByTestId('home-page')).toBeInTheDocument();
      expect(screen.queryByTestId('settings-page')).toBeNull();
    });

    it('RequirePermission route guard allows authorized owner role to access /settings', () => {
      vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
        ...baseOrgContext,
        currentRole: 'owner',
      });

      render(
        <MemoryRouter initialEntries={['/settings']}>
          <Routes>
            <Route path="/" element={<div data-testid="home-page">Home Page</div>} />
            <Route
              path="/settings"
              element={
                <RequirePermission action="org:manage">
                  <div data-testid="settings-page">Protected Settings</div>
                </RequirePermission>
              }
            />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByTestId('settings-page')).toBeInTheDocument();
    });

    it('RequirePermission route guard redirects admin away from /settings because admin lacks org:manage', () => {
      vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
        ...baseOrgContext,
        currentRole: 'admin',
      });

      render(
        <MemoryRouter initialEntries={['/settings']}>
          <Routes>
            <Route path="/" element={<div data-testid="home-page">Home Page</div>} />
            <Route
              path="/settings"
              element={
                <RequirePermission action="org:manage">
                  <div data-testid="settings-page">Protected Settings</div>
                </RequirePermission>
              }
            />
          </Routes>
        </MemoryRouter>
      );

      // Admin has no org:manage, must redirect to home
      expect(screen.getByTestId('home-page')).toBeInTheDocument();
      expect(screen.queryByTestId('settings-page')).toBeNull();
    });

    it('verifies permissions integrity: ROLE_PERMISSIONS are not modified just to make menu items visible', () => {
      // Prompt requirement: "Do not alter permissions just to make a menu item visible."
      expect(hasPermission('admin', 'org:manage')).toBe(false);
      expect(hasPermission('sales', 'audit:read')).toBe(false);
      expect(hasPermission('viewer', 'audit:read')).toBe(false);
      expect(hasPermission('viewer', 'members:manage')).toBe(false);
      expect(hasPermission('viewer', 'org:manage')).toBe(false);
      expect(hasPermission(null, 'data:read')).toBe(false);
    });

    it('filters Quick Create dropdown options by role permissions', () => {
      // Sales role can create customers, quotations, orders, but NOT products or payments
      vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
        ...baseOrgContext,
        currentRole: 'sales',
      });

      renderWithProviders(
        <Header
          collapsed={false}
          onOpenCommandPalette={() => {}}
          onOpenQuickCreate={() => {}}
          onOpenNewOrgModal={() => {}}
        />
      );

      const quickCreateBtn = screen.getByRole('button', { name: /Quick Create/i });
      fireEvent.click(quickCreateBtn);

      expect(screen.getByText('New Customer')).toBeInTheDocument();
      expect(screen.getByText('New Quotation')).toBeInTheDocument();
      expect(screen.getByText('New Sales Order')).toBeInTheDocument();

      // Sales lacks products:create and payments:record
      expect(screen.queryByText('New Product')).toBeNull();
      expect(screen.queryByText('Record Payment')).toBeNull();
    });

    it('hides Quick Create button completely for viewer role (no create permissions)', () => {
      vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
        ...baseOrgContext,
        currentRole: 'viewer',
      });

      renderWithProviders(
        <Header
          collapsed={false}
          onOpenCommandPalette={() => {}}
          onOpenQuickCreate={() => {}}
          onOpenNewOrgModal={() => {}}
        />
      );

      expect(screen.queryByRole('button', { name: /Quick Create/i })).toBeNull();
    });
  });

  // =========================================================================
  // 6. BREADCRUMBS AGREEMENT
  // =========================================================================
  describe('Breadcrumb & Route Agreement in Header', () => {
    it('renders exact breadcrumb for /audit agreeing with section and page title', () => {
      vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
        ...baseOrgContext,
        currentRole: 'owner',
      });

      renderWithProviders(
        <Header
          collapsed={false}
          onOpenCommandPalette={() => {}}
          onOpenQuickCreate={() => {}}
          onOpenNewOrgModal={() => {}}
        />,
        ['/audit']
      );

      const breadcrumbNav = screen.getByLabelText(/breadcrumb/i);
      expect(breadcrumbNav).toHaveTextContent('Administration');
      expect(breadcrumbNav).toHaveTextContent('Audit Trail');
    });

    it('renders exact breadcrumb for /orders agreeing with section and page title', () => {
      vi.spyOn(OrgContextModule, 'useOrg').mockReturnValue({
        ...baseOrgContext,
        currentRole: 'owner',
      });

      renderWithProviders(
        <Header
          collapsed={false}
          onOpenCommandPalette={() => {}}
          onOpenQuickCreate={() => {}}
          onOpenNewOrgModal={() => {}}
        />,
        ['/orders']
      );

      const breadcrumbNav = screen.getByLabelText(/breadcrumb/i);
      expect(breadcrumbNav).toHaveTextContent('Sales Operations');
      expect(breadcrumbNav).toHaveTextContent('Sales Orders');
    });
  });
});
