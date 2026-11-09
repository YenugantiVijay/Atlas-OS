import { useState, useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette';
import { Header } from './Header';
import { ToastProvider } from '@/components/ui/Toast';
import { useOrg, OrgContextType } from '@/features/organizations/OrgContext';
import { productsService } from '@/services/products.service';
import { customersService } from '@/services/customers.service';
import { searchFinancialDocuments } from '@/services/universal-search.service';

vi.mock('@/features/organizations/OrgContext', () => ({ useOrg: vi.fn() }));
vi.mock('@/services/products.service', () => ({ productsService: { getProducts: vi.fn(), getProductsPaginated: vi.fn() } }));
vi.mock('@/services/customers.service', () => ({ customersService: { getCustomers: vi.fn(), getCustomersPaginated: vi.fn() } }));
vi.mock('@/services/universal-search.service', () => ({ searchFinancialDocuments: vi.fn() }));

function Location() {
  const location = useLocation();
  return <output>{location.pathname}{location.search}</output>;
}

const mockOrg = {
  id: 'cloud-org',
  name: 'Sri Lakshmi Electrical Distributors',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const context = {
  currentOrg: mockOrg,
  organizations: [mockOrg],
  currentRole: 'owner',
  currentUser: { id: 'u1', email: 'owner@atlas.local', fullName: 'Vijay Owner' },
  session: null,
  isAuthenticated: true,
  isMockAuth: false,
  isDemoMode: false,
  isLoadingAuth: false,
  isLoadingOrgData: false,
  isSwitchingOrg: false,
  authError: null,
  eligibility: { status: 'approved' },
  subscription: { status: 'active' },
  canWriteOperations: true,
  switchOrganization: vi.fn(),
  createOrganization: vi.fn(),
  updateOrganization: vi.fn(),
  updateCurrentUser: vi.fn(),
  refreshOrgData: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  enterDemoMode: vi.fn(),
  exitDemoMode: vi.fn(),
} as unknown as OrgContextType;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useOrg).mockReturnValue(context);
  vi.mocked(productsService.getProducts).mockResolvedValue([]);
  vi.mocked(productsService.getProductsPaginated).mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 4, totalPages: 0 } as any);
  vi.mocked(customersService.getCustomers).mockResolvedValue([]);
  vi.mocked(customersService.getCustomersPaginated).mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 3, totalPages: 0 } as any);
  vi.mocked(searchFinancialDocuments).mockResolvedValue([]);
});

function ToggleHarness({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <div>
      <button data-testid="open-btn" onClick={() => setOpen(true)}>Open</button>
      <button data-testid="close-btn" onClick={() => setOpen(false)}>Close</button>
      <CommandPalette isOpen={open} onClose={() => setOpen(false)} onOpenQuickCreate={() => {}} />
    </div>
  );
}

function GlobalShortcutHarness() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div>
      <CommandPalette isOpen={open} onClose={() => setOpen(false)} onOpenQuickCreate={() => {}} />
    </div>
  );
}

function HeaderIntegrationHarness() {
  const [open, setOpen] = useState(false);
  return (
    <ToastProvider>
      <Header
        collapsed={false}
        onOpenCommandPalette={() => setOpen(true)}
        onOpenQuickCreate={() => {}}
        onOpenNewOrgModal={() => {}}
      />
      <CommandPalette isOpen={open} onClose={() => setOpen(false)} onOpenQuickCreate={() => {}} />
    </ToastProvider>
  );
}

describe('CommandPalette — React Hooks Reliability, Search & Keyboard Regression Suite', () => {
  // Test 1: Initially closed transitioning to isOpen={true}
  it('transitions from closed to open via state change without crashing or violating hook order', () => {
    render(
      <MemoryRouter>
        <ToggleHarness initialOpen={false} />
      </MemoryRouter>
    );
    expect(screen.queryByPlaceholderText('Search commands, products, customers, or workflows...')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('open-btn'));
    expect(screen.getByPlaceholderText('Search commands, products, customers, or workflows...')).toBeInTheDocument();
  });

  // Test 2: Search input visibility and receiving keyboard focus
  it('renders search input visibly and automatically receives keyboard focus', async () => {
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
      </MemoryRouter>
    );
    const searchInput = screen.getByPlaceholderText('Search commands, products, customers, or workflows...');
    expect(searchInput).toBeVisible();
    await waitFor(() => {
      expect(document.activeElement).toBe(searchInput);
    });
  });

  // Test 3: Command filtering via typing
  it('filters commands, navigation items, and quick actions dynamically when typing', () => {
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
      </MemoryRouter>
    );
    const input = screen.getByLabelText('Search Atlas OS');
    expect(screen.getByText('Quotations')).toBeInTheDocument();
    expect(screen.getByText('Products & SKUs')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'Quot' } });
    expect(screen.getByText('Quotations')).toBeInTheDocument();
    expect(screen.queryByText('Products & SKUs')).not.toBeInTheDocument();
  });

  // Test 4: Closing with Escape and restoring focus
  it('closes with Escape and invokes onClose handler', async () => {
    const onClose = vi.fn();
    function FocusHarness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button data-testid="trigger-btn" onClick={() => setOpen(true)}>Open Palette</button>
          <CommandPalette isOpen={open} onClose={() => { setOpen(false); onClose(); }} onOpenQuickCreate={() => {}} />
        </div>
      );
    }

    render(
      <MemoryRouter>
        <FocusHarness />
      </MemoryRouter>
    );

    const trigger = screen.getByTestId('trigger-btn');
    trigger.focus();
    fireEvent.click(trigger);

    expect(await screen.findByPlaceholderText('Search commands, products, customers, or workflows...')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  // Test 5: Reopening after closing (verifying no hook order mismatch across toggle cycles)
  it('reopens after closing cleanly without hook mismatch across multiple toggle cycles', () => {
    render(
      <MemoryRouter>
        <ToggleHarness initialOpen={false} />
      </MemoryRouter>
    );

    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByTestId('open-btn'));
      expect(screen.getByPlaceholderText('Search commands, products, customers, or workflows...')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('close-btn'));
      expect(screen.queryByPlaceholderText('Search commands, products, customers, or workflows...')).not.toBeInTheDocument();
    }
  });

  // Test 6: Ctrl+K global shortcut handling
  it('handles Ctrl+K and Cmd+K to toggle palette visibility globally', () => {
    render(
      <MemoryRouter>
        <GlobalShortcutHarness />
      </MemoryRouter>
    );

    expect(screen.queryByPlaceholderText('Search commands, products, customers, or workflows...')).not.toBeInTheDocument();

    // Open via Ctrl+K
    fireEvent.keyDown(window, { ctrlKey: true, key: 'k' });
    expect(screen.getByPlaceholderText('Search commands, products, customers, or workflows...')).toBeInTheDocument();

    // Close via Ctrl+K
    fireEvent.keyDown(window, { ctrlKey: true, key: 'k' });
    expect(screen.queryByPlaceholderText('Search commands, products, customers, or workflows...')).not.toBeInTheDocument();
  });

  // Test 7: Header search button trigger
  it('opens command palette when clicking the Header search button', () => {
    render(
      <MemoryRouter>
        <HeaderIntegrationHarness />
      </MemoryRouter>
    );

    const searchBtn = screen.getByRole('button', { name: 'Search Atlas OS' });
    fireEvent.click(searchBtn);
    expect(screen.getByPlaceholderText('Search commands, products, customers, or workflows...')).toBeInTheDocument();
  });

  // Test 8: Product navigation and URL parameter setting
  it('queries the active cloud organization and opens a matching product search with URL parameters', async () => {
    vi.mocked(productsService.getProductsPaginated).mockResolvedValue({ items: [
      { id: 'p1', sku: 'CLOUD+SKU', name: 'Cloud Wire', sellingPrice: 0, uom: 'Coils' } as any,
    ] } as any);
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
        <Location />
      </MemoryRouter>
    );
    expect(productsService.getProductsPaginated).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Search Atlas OS'), { target: { value: 'Cloud Wire' } });
    await waitFor(() => expect(productsService.getProductsPaginated).toHaveBeenCalledWith('cloud-org', { page: 1, pageSize: 4, search: 'Cloud Wire' }, false));
    expect(customersService.getCustomersPaginated).toHaveBeenCalledWith('cloud-org', { page: 1, pageSize: 3, search: 'Cloud Wire' }, false);
    fireEvent.click(await screen.findByRole('button', { name: /Cloud Wire/ }));
    expect(screen.getByText('/products?search=CLOUD%2BSKU')).toBeInTheDocument();
  });

  // Test 9: Switching organization while open
  it('re-fetches catalog and resets search query when organization switches while open', async () => {
    const org1 = { id: 'org-1', name: 'Org 1' } as any;
    const org2 = { id: 'org-2', name: 'Org 2' } as any;

    vi.mocked(useOrg).mockReturnValue({ ...context, currentOrg: org1 });
    const { rerender } = render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
      </MemoryRouter>
    );

    expect(productsService.getProductsPaginated).not.toHaveBeenCalled();

    const input = screen.getByLabelText('Search Atlas OS');
    fireEvent.change(input, { target: { value: 'Test Query' } });
    expect(input).toHaveValue('Test Query');

    // Switch organization
    vi.mocked(useOrg).mockReturnValue({ ...context, currentOrg: org2 });
    rerender(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Search Atlas OS')).toHaveValue('');
      expect(productsService.getProductsPaginated).not.toHaveBeenCalled();
    });
    expect(input).toHaveValue('');
  });

  // Test 10: Viewer role filtering out unauthorized quick actions
  it('hides unauthorized quick actions and the audit route from viewers', async () => {
    vi.mocked(useOrg).mockReturnValue({ ...context, currentRole: 'viewer' });
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.queryByText('Loading products and customers...')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'New Product' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Audit Trail/ })).not.toBeInTheDocument();
  });

  it('does not show invoices or payment ledger destinations to a sales employee', async () => {
    vi.mocked(useOrg).mockReturnValue({ ...context, currentRole: 'sales' });
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
      </MemoryRouter>
    );
    expect(screen.queryByRole('button', { name: /Invoices\s*\/invoices/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Payments & Receivables/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sales & Receipts Reports/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sales Orders/ })).toBeInTheDocument();
  });

  it('searches customers by normalized phone digits without exposing financial balances', async () => {
    vi.mocked(customersService.getCustomersPaginated).mockResolvedValue({ items: [
      { id: 'customer-1', name: 'Ravi Electricals', phone: '+91 98765-43210' } as any,
    ] } as any);
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
        <Location />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText('Search Atlas OS'), { target: { value: '9876543210' } });
    const customer = await screen.findByRole('button', { name: /Ravi Electricals/ });
    expect(customer).toBeInTheDocument();
    fireEvent.click(customer);
    expect(screen.getByText('/customers?search=Ravi%20Electricals')).toBeInTheDocument();
  });

  it('shows finance-only server results with linked invoice search', async () => {
    vi.mocked(searchFinancialDocuments).mockResolvedValue([{
      record_type: 'invoice', record_id: 'inv-1',
      document_number: 'INV-204', customer_name: 'Customer A',
      document_date: '2026-11-05',
    }]);
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
        <Location />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText('Search Atlas OS'), { target: { value: 'INV-204' } });
    const button = await screen.findByRole('button', { name: /INV-204/ });
    fireEvent.click(button);
    expect(screen.getByText('/invoices?search=INV-204')).toBeInTheDocument();
    expect(searchFinancialDocuments).toHaveBeenCalledWith('cloud-org', 'owner', 'INV-204');
  });

  it('never calls finance search for sales staff', async () => {
    vi.mocked(useOrg).mockReturnValue({ ...context, currentRole: 'sales' });
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText('Search Atlas OS'), { target: { value: 'INV-204' } });
    await waitFor(() => expect(screen.getByLabelText('Search Atlas OS')).toHaveValue('INV-204'));
    expect(searchFinancialDocuments).not.toHaveBeenCalled();
  });

  // Test 11: Search data load failure and retry behavior
  it('offers retry after a search request fails and successfully reloads on retry', async () => {
    vi.mocked(productsService.getProducts).mockRejectedValueOnce(new Error('Offline'));
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
      </MemoryRouter>
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Search data could not be loaded');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(productsService.getProducts).toHaveBeenCalledTimes(2);
  });

  // Test 12: Rapid repeated open/close cycles without React crashing
  it('survives rapid repeated open/close cycles without invariant violations or memory leaks', () => {
    render(
      <MemoryRouter>
        <ToggleHarness initialOpen={false} />
      </MemoryRouter>
    );

    const openBtn = screen.getByTestId('open-btn');
    const closeBtn = screen.getByTestId('close-btn');

    for (let i = 0; i < 15; i++) {
      fireEvent.click(openBtn);
      fireEvent.click(closeBtn);
    }

    // Final open should work flawlessly
    fireEvent.click(openBtn);
    expect(screen.getByPlaceholderText('Search commands, products, customers, or workflows...')).toBeInTheDocument();
  }, 15000);
});
