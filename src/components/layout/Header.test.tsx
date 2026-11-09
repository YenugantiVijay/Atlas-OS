import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Header } from './Header';
import { useOrg, OrgContextType } from '@/features/organizations/OrgContext';
import { ToastProvider } from '@/components/ui/Toast';

vi.mock('@/features/organizations/OrgContext', () => ({
  useOrg: vi.fn(),
}));

describe('Header Premium UI Redesign & Live Cloud Indicator', () => {
  const currentOrg = {
    id: 'org-1',
    name: 'Sri Krishna Electricals & Hardware Supplies',
    city: 'Vijayawada',
    state: 'Andhra Pradesh',
  };

  const currentUser = {
    id: 'u-1',
    fullName: 'Anand Varma',
    email: 'anand@krishnaelectricals.com',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Live Cloud status with animated signal elements when authenticated', () => {
    vi.mocked(useOrg).mockReturnValue({
      currentOrg,
      organizations: [currentOrg],
      currentRole: 'owner',
      currentUser,
      isAuthenticated: true,
      isLoadingAuth: false,
      signOut: vi.fn(),
    } as unknown as OrgContextType);

    render(
      <MemoryRouter>
        <ToastProvider>
          <Header
            collapsed={false}
            onOpenCommandPalette={() => {}}
            onOpenQuickCreate={() => {}}
            onOpenNewOrgModal={() => {}}
          />
        </ToastProvider>
      </MemoryRouter>
    );

    const cloudStatusBtn = screen.getByTitle('Authenticated Cloud Workspace (Supabase Configured)');
    expect(cloudStatusBtn).toBeInTheDocument();
    expect(cloudStatusBtn).toHaveTextContent('Live Cloud');

    // Signal pulse indicator is present
    const rippleDot = cloudStatusBtn.querySelector('.cloud-live-signal-ripple');
    const coreDot = cloudStatusBtn.querySelector('.cloud-live-signal-core');
    expect(rippleDot).toBeInTheDocument();
    expect(coreDot).toBeInTheDocument();
  });

  it('renders Demo Mode pill clearly distinct from cloud mode when unauthenticated', () => {
    vi.mocked(useOrg).mockReturnValue({
      currentOrg,
      organizations: [currentOrg],
      currentRole: 'owner',
      currentUser,
      isAuthenticated: false,
      isLoadingAuth: false,
      signOut: vi.fn(),
    } as unknown as OrgContextType);

    render(
      <MemoryRouter>
        <ToastProvider>
          <Header
            collapsed={false}
            onOpenCommandPalette={() => {}}
            onOpenQuickCreate={() => {}}
            onOpenNewOrgModal={() => {}}
          />
        </ToastProvider>
      </MemoryRouter>
    );

    const demoBtn = screen.getByTitle('Operating in local demo mode. Click to sign in to Supabase.');
    expect(demoBtn).toBeInTheDocument();
    expect(demoBtn).toHaveTextContent('Demo Mode · Sign In');
    expect(demoBtn.querySelector('.cloud-live-signal')).toBeNull();
  });

  it('handles organization selector dropdown toggling and selection', () => {
    const switchOrganization = vi.fn();
    const otherOrg = { id: 'org-2', name: 'Metro Electric Co', city: 'Guntur', state: 'AP' };

    vi.mocked(useOrg).mockReturnValue({
      currentOrg,
      organizations: [currentOrg, otherOrg],
      currentRole: 'owner',
      currentUser,
      isAuthenticated: true,
      isLoadingAuth: false,
      switchOrganization,
      signOut: vi.fn(),
    } as unknown as OrgContextType);

    render(
      <MemoryRouter>
        <ToastProvider>
          <Header
            collapsed={false}
            onOpenCommandPalette={() => {}}
            onOpenQuickCreate={() => {}}
            onOpenNewOrgModal={() => {}}
          />
        </ToastProvider>
      </MemoryRouter>
    );

    const orgBtn = screen.getByRole('button', { name: /Switch organization/i });
    expect(orgBtn).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(orgBtn);
    expect(orgBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Metro Electric Co')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Metro Electric Co'));
    expect(switchOrganization).toHaveBeenCalledWith('org-2');
  });

  it('closes open dropdowns on Escape key press', () => {
    vi.mocked(useOrg).mockReturnValue({
      currentOrg,
      organizations: [currentOrg],
      currentRole: 'owner',
      currentUser,
      isAuthenticated: true,
      isLoadingAuth: false,
      signOut: vi.fn(),
    } as unknown as OrgContextType);

    render(
      <MemoryRouter>
        <ToastProvider>
          <Header
            collapsed={false}
            onOpenCommandPalette={() => {}}
            onOpenQuickCreate={() => {}}
            onOpenNewOrgModal={() => {}}
          />
        </ToastProvider>
      </MemoryRouter>
    );

    const orgBtn = screen.getByRole('button', { name: /Switch organization/i });
    fireEvent.click(orgBtn);
    expect(orgBtn).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(orgBtn).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders role-aware quick actions for owner and triggers handler', () => {
    const onOpenQuickCreate = vi.fn();

    vi.mocked(useOrg).mockReturnValue({
      currentOrg,
      organizations: [currentOrg],
      currentRole: 'owner',
      currentUser,
      isAuthenticated: true,
      isLoadingAuth: false,
      signOut: vi.fn(),
    } as unknown as OrgContextType);

    render(
      <MemoryRouter>
        <ToastProvider>
          <Header
            collapsed={false}
            onOpenCommandPalette={() => {}}
            onOpenQuickCreate={onOpenQuickCreate}
            onOpenNewOrgModal={() => {}}
          />
        </ToastProvider>
      </MemoryRouter>
    );

    const quickCreateBtn = screen.getByRole('button', { name: 'Quick Create' });
    fireEvent.click(quickCreateBtn);

    expect(screen.getByText('New Product')).toBeInTheDocument();
    expect(screen.getByText('New Sales Order')).toBeInTheDocument();
    expect(screen.getByText('Record Payment')).toBeInTheDocument();

    fireEvent.click(screen.getByText('New Sales Order'));
    expect(onOpenQuickCreate).toHaveBeenCalledWith('order');
  });

  it('hides unauthorized quick actions for viewer role', () => {
    vi.mocked(useOrg).mockReturnValue({
      currentOrg,
      organizations: [currentOrg],
      currentRole: 'viewer',
      currentUser,
      isAuthenticated: true,
      isLoadingAuth: false,
      signOut: vi.fn(),
    } as unknown as OrgContextType);

    render(
      <MemoryRouter>
        <ToastProvider>
          <Header
            collapsed={false}
            onOpenCommandPalette={() => {}}
            onOpenQuickCreate={() => {}}
            onOpenNewOrgModal={() => {}}
          />
        </ToastProvider>
      </MemoryRouter>
    );

    // Viewer has no create permissions, so Quick Create button must not appear
    expect(screen.queryByRole('button', { name: 'Quick Create' })).not.toBeInTheDocument();
  });
});
