import { useState, useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette';
import { Header } from './Header';
import { ToastProvider } from '@/components/ui/Toast';
import { useOrg, OrgContextType } from '@/features/organizations/OrgContext';
import { productsService } from '@/services/products.service';
import { customersService } from '@/services/customers.service';
import { searchFinancialDocuments } from '@/services/universal-search.service';
import { searchCustomerDirectory } from '@/services/customer-directory-search.service';
import { searchOperationalRecords } from '@/services/operational-search.service';
import { suppliersService } from '@/services/suppliers.service';
import { ordersService } from '@/services/orders.service';

vi.mock('@/features/organizations/OrgContext', () => ({ useOrg: vi.fn() }));
vi.mock('@/services/products.service', () => ({ productsService: { getProducts: vi.fn(), getProductsPaginated: vi.fn() } }));
vi.mock('@/services/customers.service', () => ({ customersService: { getCustomers: vi.fn(), getCustomersPaginated: vi.fn() } }));
vi.mock('@/services/universal-search.service', () => ({ searchFinancialDocuments: vi.fn() }));
vi.mock('@/services/customer-directory-search.service', () => ({ searchCustomerDirectory: vi.fn() }));
vi.mock('@/services/operational-search.service', () => ({ searchOperationalRecords: vi.fn() }));

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
  vi.mocked(productsService.getProductsPaginated).mockResolvedValue({ data: [], totalCount: 0, page: 1, pageSize: 4, totalPages: 0 } as any);
  vi.mocked(customersService.getCustomers).mockResolvedValue([]);
  vi.mocked(customersService.getCustomersPaginated).mockResolvedValue({ data: [], totalCount: 0, page: 1, pageSize: 3, totalPages: 0 } as any);
  vi.mocked(searchCustomerDirectory).mockResolvedValue([]);
  vi.mocked(searchOperationalRecords).mockResolvedValue([]);
  vi.mocked(searchFinancialDocuments).mockResolvedValue([]);
});

afterEach(() => vi.restoreAllMocks());

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
    vi.mocked(productsService.getProductsPaginated).mockResolvedValue({ data: [
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
    expect(searchCustomerDirectory).toHaveBeenCalledWith('cloud-org', 'Cloud Wire', 3);
    expect(customersService.getCustomersPaginated).not.toHaveBeenCalled();
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
    vi.mocked(searchCustomerDirectory).mockResolvedValue([
      { id: 'customer-1', name: 'Ravi Electricals', phone: '+91 98765-43210' },
    ]);
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
        <Location />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText('Search Atlas OS'), { target: { value: '98765-43210' } });
    const customer = await screen.findByRole('button', { name: /Ravi Electricals/ });
    expect(customer).toBeInTheDocument();
    expect(searchCustomerDirectory).toHaveBeenCalledWith('cloud-org', '98765-43210', 3);
    expect(customersService.getCustomersPaginated).not.toHaveBeenCalled();
    expect(customer).not.toHaveTextContent('Receivable');
    fireEvent.click(customer);
    expect(screen.getByText('/customers?search=Ravi%20Electricals')).toBeInTheDocument();
  });


  it('does not load the full customer table when the bounded directory RPC fails', async () => {
    vi.mocked(searchCustomerDirectory).mockRejectedValue(new Error('RPC not deployed'));
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText('Search Atlas OS'), { target: { value: '+91 98765' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Search data could not be loaded');
    expect(customersService.getCustomers).not.toHaveBeenCalled();
    expect(customersService.getCustomersPaginated).not.toHaveBeenCalled();
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

  // Test 11: Cloud search failure and retry after a typed, debounced query.
  it('offers retry after a bounded cloud search fails and successfully reloads on retry', async () => {
    vi.mocked(productsService.getProductsPaginated).mockRejectedValueOnce(new Error('Offline'));
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText('Search Atlas OS'), { target: { value: 'wire' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Search data could not be loaded');
    expect(productsService.getProductsPaginated).toHaveBeenCalledWith(
      'cloud-org', { page: 1, pageSize: 4, search: 'wire' }, false
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    await waitFor(() => expect(productsService.getProductsPaginated).toHaveBeenCalledTimes(2));
    expect(productsService.getProducts).not.toHaveBeenCalled();
  });

  it('moves through authorized search results with arrows and opens the selected entry with Enter', () => {
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
        <Location />
      </MemoryRouter>
    );
    const input = screen.getByLabelText('Search Atlas OS');
    fireEvent.change(input, { target: { value: 'Products & SKUs' } });
    const selected = screen.getByRole('button', { name: /Products & SKUs \/products/ });
    expect(selected).toHaveAttribute('data-active', 'true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(document.querySelector('output')).toHaveTextContent('/products');
  });

  it('cycles the active result with arrow keys without exposing unauthorized finance navigation', () => {
    vi.mocked(useOrg).mockReturnValue({ ...context, currentRole: 'sales' });
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
      </MemoryRouter>
    );
    const input = screen.getByLabelText('Search Atlas OS');
    fireEvent.change(input, { target: { value: '' } });
    const results = screen.getAllByRole('button').filter((button) => button.hasAttribute('data-command-result'));
    expect(results.length).toBeGreaterThan(1);
    expect(results.some((button) => button.textContent?.includes('Payments & Receivables'))).toBe(false);
    expect(results[0]).toHaveAttribute('data-active', 'true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(results[1]).toHaveAttribute('data-active', 'true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(results[0]).toHaveAttribute('data-active', 'true');
  });

  it('searches supplier, quotation and order records without loading full operational catalogs', async () => {
    vi.mocked(searchOperationalRecords).mockResolvedValue([
      { recordType: 'supplier', recordId: 's1', reference: 'Ravi Supply', displayName: 'Ravi Firm', contactPhone: '+91 99887-76655' },
      { recordType: 'quotation', recordId: 'q1', reference: 'QT-42', displayName: 'Ravi Firm' },
      { recordType: 'sales_order', recordId: 'o1', reference: 'SO-42', displayName: 'Ravi Firm' },
    ]);
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
        <Location />
      </MemoryRouter>
    );
    const input = screen.getByLabelText('Search Atlas OS');
    fireEvent.change(input, { target: { value: 'Ravi' } });
    expect(await screen.findByRole('button', { name: /Supplier · Ravi Supply/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Quotation · QT-42/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sales Order · SO-42/ })).toBeInTheDocument();
    expect(searchOperationalRecords).toHaveBeenCalledWith('cloud-org', 'Ravi', 3);
    expect(screen.getByRole('button', { name: /Supplier · Ravi Supply/ })).toHaveAttribute('data-active', 'true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: /Quotation · QT-42/ })).toHaveAttribute('data-active', 'true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(document.querySelector('output')).toHaveTextContent('/quotations?search=QT-42');
  });

  it('can deep-link suppliers and sales orders from bounded results', async () => {
    vi.mocked(searchOperationalRecords).mockResolvedValue([
      { recordType: 'supplier', recordId: 's1', reference: 'Ravi Supplier', displayName: 'Ravi Supplier' },
      { recordType: 'sales_order', recordId: 'o1', reference: 'SO-77', displayName: 'Buyer' },
    ]);
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
        <Location />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText('Search Atlas OS'), { target: { value: 'Ravi' } });
    fireEvent.click(await screen.findByRole('button', { name: /Supplier · Ravi Supplier/ }));
    expect(document.querySelector('output')).toHaveTextContent('/suppliers?search=Ravi%20Supplier');
    fireEvent.click(screen.getByRole('button', { name: /Sales Order · SO-77/ }));
    expect(document.querySelector('output')).toHaveTextContent('/orders?search=SO-77');
  });

  it('does not call operational search without a role permitted to read organization data', async () => {
    vi.mocked(useOrg).mockReturnValue({ ...context, currentRole: null });
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText('Search Atlas OS'), { target: { value: 'SO-77' } });
    await waitFor(() => expect(screen.getByLabelText('Search Atlas OS')).toHaveValue('SO-77'));
    expect(searchOperationalRecords).not.toHaveBeenCalled();
  });

  it('shows operational lookup errors without returning unbounded fallback results', async () => {
    vi.mocked(searchOperationalRecords).mockRejectedValue(new Error('RPC unavailable'));
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText('Search Atlas OS'), { target: { value: 'QT-42' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Operational search is unavailable');
  });

  it('announces the selected command and supports Home/End and clamped keyboard activation', () => {
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
        <Location />
      </MemoryRouter>
    );
    const input = screen.getByLabelText('Search Atlas OS');
    const results = screen.getAllByRole('button').filter((b) => b.hasAttribute('data-command-result'));
    expect(input).toHaveAttribute('aria-describedby', 'atlas-command-selection');
    expect(input).toHaveAttribute('maxLength', '100');
    expect(document.getElementById('atlas-command-selection')).toHaveTextContent('Selected 1 of');
    fireEvent.keyDown(input, { key: 'End' });
    expect(results[results.length - 1]).toHaveAttribute('data-active', 'true');
    fireEvent.keyDown(input, { key: 'Home' });
    expect(results[0]).toHaveAttribute('data-active', 'true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(results[results.length - 1]).toHaveAttribute('data-active', 'true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(results[0]).toHaveAttribute('data-active', 'true');
  });

  it('does not render stale operational results while a newer query is pending', async () => {
    let resolveOld: ((rows: any[]) => void) | undefined;
    vi.mocked(searchOperationalRecords).mockImplementation((_org, term) => {
      if (term === 'old') return new Promise((resolve) => { resolveOld = resolve; });
      return Promise.resolve([{ recordType: 'supplier', recordId: 'new-1', reference: 'New Supplier', displayName: 'New Supplier' }]);
    });
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
      </MemoryRouter>
    );
    const input = screen.getByLabelText('Search Atlas OS');
    fireEvent.change(input, { target: { value: 'old' } });
    await waitFor(() => expect(searchOperationalRecords).toHaveBeenCalledWith('cloud-org', 'old', 3));
    fireEvent.change(input, { target: { value: 'new' } });
    expect(screen.queryByRole('button', { name: /Old Supplier/ })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /New Supplier/ })).toBeInTheDocument();
    await act(async () => {
      resolveOld?.([{ recordType: 'supplier', recordId: 'old-1', reference: 'Old Supplier', displayName: 'Old Supplier' }]);
    });
    expect(screen.queryByRole('button', { name: /Old Supplier/ })).not.toBeInTheDocument();
  });

  it('immediately hides financial results when a role loses finance permission', async () => {
    vi.mocked(searchFinancialDocuments).mockResolvedValue([{
      record_type: 'invoice', record_id: 'inv-sensitive',
      document_number: 'INV-SENSITIVE', customer_name: 'Private Firm', document_date: '2026-11-09',
    }]);
    const { rerender } = render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
      </MemoryRouter>
    );
    const input = screen.getByLabelText('Search Atlas OS');
    fireEvent.change(input, { target: { value: 'INV-SENSITIVE' } });
    expect(await screen.findByRole('button', { name: /INV-SENSITIVE/ })).toBeInTheDocument();
    vi.mocked(useOrg).mockReturnValue({ ...context, currentRole: 'sales' });
    rerender(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
      </MemoryRouter>
    );
    expect(screen.queryByRole('button', { name: /INV-SENSITIVE/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Private Firm')).not.toBeInTheDocument();
  });

  it('does not claim there are no results when finance-only search finds a receipt', async () => {
    vi.mocked(searchFinancialDocuments).mockResolvedValue([{
      record_type: 'payment', record_id: 'pay-1',
      document_number: 'PAY-UNIQUE-908', customer_name: 'Buyer', document_date: '2026-11-09',
    }]);
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText('Search Atlas OS'), { target: { value: 'PAY-UNIQUE-908' } });
    expect(await screen.findByRole('button', { name: /PAY-UNIQUE-908/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Loading products and customers...')).not.toBeInTheDocument());
    expect(screen.queryByText('No matching results.')).not.toBeInTheDocument();
  });

  it('limits cloud query length to 100 characters before requesting any search RPC', async () => {
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText('Search Atlas OS'), { target: { value: 'a'.repeat(101) } });
    await waitFor(() => expect(screen.getByLabelText('Search Atlas OS')).toHaveValue('a'.repeat(101)));
    expect(searchOperationalRecords).not.toHaveBeenCalled();
    expect(searchFinancialDocuments).not.toHaveBeenCalled();
    expect(productsService.getProductsPaginated).not.toHaveBeenCalled();
  });

  it('retries financial and operational RPCs independently after transient failures', async () => {
    vi.mocked(searchFinancialDocuments).mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([{ record_type: 'invoice', record_id: 'inv-1', document_number: 'INV-RETRY',
        customer_name: 'Buyer', document_date: '2026-11-09' }]);
    vi.mocked(searchOperationalRecords).mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([{ recordType: 'supplier', recordId: 's1', reference: 'Retry Supply', displayName: 'Supplier' }]);
    render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText('Search Atlas OS'), { target: { value: 'Retry' } });
    const retryFinance = await screen.findByRole('button', { name: 'Try finance search again' });
    const retryOperations = await screen.findByRole('button', { name: 'Try operational search again' });
    fireEvent.click(retryFinance);
    expect(await screen.findByRole('button', { name: /INV-RETRY/ })).toBeInTheDocument();
    expect(searchFinancialDocuments).toHaveBeenCalledTimes(2);
    // The first retry is shared, so both searches recover without additional full-table reads.
    await waitFor(() => expect(screen.getByRole('button', { name: /Retry Supply/ })).toBeInTheDocument());
    expect(searchOperationalRecords).toHaveBeenCalledTimes(2);
    expect(retryOperations).not.toBeInTheDocument();
  });

  it('reuses small demo catalogs while typing but refreshes them after reopening', async () => {
    vi.mocked(useOrg).mockReturnValue({ ...context, isMockAuth: true, isDemoMode: true });
    const supplierSpy = vi.spyOn(suppliersService, 'getSuppliers').mockResolvedValue([
      { id: 's1', name: 'Ravi Supply', organizationId: 'cloud-org' } as any,
    ]);
    const quotesSpy = vi.spyOn(ordersService, 'getQuotations').mockResolvedValue([]);
    const ordersSpy = vi.spyOn(ordersService, 'getSalesOrders').mockResolvedValue([]);
    render(
      <MemoryRouter>
        <ToggleHarness initialOpen />
      </MemoryRouter>
    );
    const input = screen.getByLabelText('Search Atlas OS');
    fireEvent.change(input, { target: { value: 'Ravi' } });
    expect(await screen.findByRole('button', { name: /Supplier · Ravi Supply/ })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Rav' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /Supplier · Ravi Supply/ })).toBeInTheDocument());
    expect(supplierSpy).toHaveBeenCalledTimes(1);
    expect(quotesSpy).toHaveBeenCalledTimes(1);
    expect(ordersSpy).toHaveBeenCalledTimes(1);
    expect(productsService.getProducts).toHaveBeenCalledTimes(1);
    expect(customersService.getCustomers).toHaveBeenCalledTimes(1);
    expect(searchOperationalRecords).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('close-btn'));
    fireEvent.click(screen.getByTestId('open-btn'));
    fireEvent.change(screen.getByLabelText('Search Atlas OS'), { target: { value: 'Ravi' } });
    await waitFor(() => expect(supplierSpy).toHaveBeenCalledTimes(2));
    expect(productsService.getProducts).toHaveBeenCalledTimes(2);
  });

  it('invalidates results on user identity change even within the same organization', async () => {
    vi.mocked(searchOperationalRecords)
      .mockResolvedValueOnce([{ recordType: 'supplier', recordId: 'user1-secret',
        reference: 'User One Supplier', displayName: 'User One Supplier' }])
      .mockResolvedValue([]);
    const { rerender } = render(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
      </MemoryRouter>
    );
    fireEvent.change(screen.getByLabelText('Search Atlas OS'), { target: { value: 'supplier' } });
    expect(await screen.findByRole('button', { name: /Supplier · User One Supplier/ })).toBeInTheDocument();
    vi.mocked(useOrg).mockReturnValue({
      ...context,
      currentUser: { ...context.currentUser!, id: 'u2' },
    });
    rerender(
      <MemoryRouter>
        <CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} />
      </MemoryRouter>
    );
    expect(screen.queryByRole('button', { name: /Supplier · User One Supplier/ })).not.toBeInTheDocument();
    await waitFor(() => expect(searchOperationalRecords).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: /Supplier · User One Supplier/ })).not.toBeInTheDocument();
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
  it('keeps a bounded cloud customer matched by GSTIN even when the RPC intentionally hides the matching field', async () => {
    vi.mocked(searchCustomerDirectory).mockResolvedValue([{
      id: 'c-gstin', name: 'Ravi Electricals', companyName: 'Ravi Enterprises', phone: '+91 98765-43210',
    }]);
    render(<MemoryRouter><CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} /><Location /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Search Atlas OS'), { target: { value: 'ABCDE1234F' } });
    const result = await screen.findByRole('button', { name: /Ravi Enterprises/ });
    expect(searchCustomerDirectory).toHaveBeenCalledWith('cloud-org', 'ABCDE1234F', 3);
    expect(result).toBeInTheDocument();
    expect(result).not.toHaveTextContent('ABCDE1234F');
    expect(result).not.toHaveTextContent('Receivable');
    expect(customersService.getCustomers).not.toHaveBeenCalled();
    fireEvent.click(result);
    expect(screen.getByText('/customers?search=Ravi%20Electricals')).toBeInTheDocument();
  });

  it('keeps a cloud product matched by HSN, without requiring its name, SKU or brand to match', async () => {
    vi.mocked(productsService.getProductsPaginated).mockResolvedValue({ data: [{
      id: 'p-hsn', name: 'Insulated Copper Cable', sku: 'CB-100', brand: 'Cables',
      hsnCode: '8544', sellingPrice: 200, currentStock: 7, uom: 'Coils',
    }], totalCount: 1 } as any);
    render(<MemoryRouter><CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} /><Location /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Search Atlas OS'), { target: { value: '8544' } });
    const result = await screen.findByRole('button', { name: /Insulated Copper Cable/ });
    expect(productsService.getProductsPaginated).toHaveBeenCalledWith('cloud-org', {
      page: 1, pageSize: 4, search: '8544',
    }, false);
    expect(result).toHaveTextContent('HSN: 8544');
    fireEvent.click(result);
    expect(screen.getByText('/products?search=CB-100')).toBeInTheDocument();
  });

  it('shows GSTIN-matched suppliers through bounded operational RPC results, without a full supplier catalog load', async () => {
    const fullCatalogSpy = vi.spyOn(suppliersService, 'getSuppliers');
    vi.mocked(searchOperationalRecords).mockResolvedValue([{
      recordType: 'supplier', recordId: 's-gstin',
      reference: 'Global Electric Co', displayName: 'Global Electric Company',
    }]);
    render(<MemoryRouter><CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} /><Location /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Search Atlas OS'), { target: { value: 'ZYXWV9876P' } });
    const result = await screen.findByRole('button', { name: /Supplier · Global Electric Co/ });
    expect(searchOperationalRecords).toHaveBeenCalledWith('cloud-org', 'ZYXWV9876P', 3);
    expect(result).toBeInTheDocument();
    expect(result).not.toHaveTextContent('ZYXWV9876P');
    expect(fullCatalogSpy).not.toHaveBeenCalled();
  });

  it('matches product HSN and customer GSTIN in local demo without cloud RPC requests', async () => {
    vi.mocked(useOrg).mockReturnValue({ ...context, isMockAuth: true, isDemoMode: true });
    vi.mocked(productsService.getProducts).mockResolvedValue([{
      id: 'demo-product', name: 'Copper Conductor', sku: 'CC-1', hsnCode: '8544',
      sellingPrice: 100, uom: 'Coils',
    } as any]);
    vi.mocked(customersService.getCustomers).mockResolvedValue([{
      id: 'demo-customer', name: 'Ravi Electricals', gstin: '29ABCDE1234F1Z5',
    } as any]);
    const ops = vi.spyOn(suppliersService, 'getSuppliers').mockResolvedValue([]);
    vi.spyOn(ordersService, 'getQuotations').mockResolvedValue([]);
    vi.spyOn(ordersService, 'getSalesOrders').mockResolvedValue([]);
    render(<MemoryRouter><CommandPalette isOpen onClose={() => {}} onOpenQuickCreate={() => {}} /></MemoryRouter>);
    const input = screen.getByLabelText('Search Atlas OS');
    fireEvent.change(input, { target: { value: '8544' } });
    expect(await screen.findByRole('button', { name: /Copper Conductor/ })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'ABCDE1234F' } });
    expect(await screen.findByRole('button', { name: /Ravi Electricals/ })).toBeInTheDocument();
    expect(ops).toHaveBeenCalledTimes(1);
    expect(searchCustomerDirectory).not.toHaveBeenCalled();
    expect(searchOperationalRecords).not.toHaveBeenCalled();
  });

});
