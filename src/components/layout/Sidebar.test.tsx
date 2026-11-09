import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useOrg } from '@/features/organizations/OrgContext';

vi.mock('@/features/organizations/OrgContext', () => ({
  useOrg: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({
  getSupabaseStatus: () => ({ configured: false }),
}));

const currentOrg = { id: 'org-a', name: 'Sample Electricals', city: 'Tirupati' };
const currentUser = { id: 'user-a' };

function setup(role: 'owner' | 'admin' | 'sales' | 'inventory' | 'accounts' | 'viewer' = 'owner', collapsed = false) {
  vi.mocked(useOrg).mockReturnValue({
    currentOrg,
    currentUser,
    currentRole: role,
    isDemoMode: false,
  } as any);
  return render(
    <MemoryRouter>
      <Sidebar collapsed={collapsed} onToggle={() => {}} />
    </MemoryRouter>
  );
}

describe('Sidebar Navigation Cleanup & Role-Based Access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render any view selector or layout dropdown control', () => {
    setup('owner');
    expect(screen.queryByRole('combobox', { name: /navigation layout/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Simple View/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Full Navigation/i)).not.toBeInTheDocument();
  });

  it('renders default grouped navigation with collapsible sections for owner', () => {
    setup('owner');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sales' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inventory' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finance' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ATLAS AI Assistant' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Administration' })).toBeInTheDocument();

    // Verify collapsible interactions
    const salesBtn = screen.getByRole('button', { name: 'Sales' });
    expect(salesBtn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(salesBtn);
    expect(salesBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Retail Counter' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sales Orders' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quotations' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tax Invoices' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Customers' })).toBeInTheDocument();

    // Verify Inventory collapsible
    const inventoryBtn = screen.getByRole('button', { name: 'Inventory' });
    fireEvent.click(inventoryBtn);
    expect(screen.getByRole('link', { name: 'Products & SKUs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Stock Movements' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Suppliers & Vendors' })).toBeInTheDocument();

    // Verify Finance collapsible
    const financeBtn = screen.getByRole('button', { name: 'Finance' });
    fireEvent.click(financeBtn);
    expect(screen.getByRole('link', { name: 'Payments & Ledger' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sales & Receipts' })).toBeInTheDocument();

    // Verify Administration collapsible
    const adminBtn = screen.getByRole('button', { name: 'Administration' });
    fireEvent.click(adminBtn);
    expect(screen.getByRole('link', { name: 'Team & Access' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Audit Trail' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Org Settings' })).toBeInTheDocument();
  });

  it('hides all financial and administrative links from sales role', () => {
    setup('sales');
    // Financial and admin sections must NOT be rendered
    expect(screen.queryByRole('button', { name: 'Finance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Administration' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tax Invoices' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Payments & Ledger' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sales & Receipts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Team & Access' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit Trail' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Org Settings' })).not.toBeInTheDocument();

    // Sales and inventory sections remain accessible
    const salesBtn = screen.getByRole('button', { name: 'Sales' });
    fireEvent.click(salesBtn);
    expect(screen.getByRole('link', { name: 'Sales Orders' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quotations' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Customers' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tax Invoices' })).not.toBeInTheDocument();
  });

  it('hides order creation, financial documents, and admin from viewer role', () => {
    setup('viewer');
    expect(screen.queryByRole('button', { name: 'Finance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Administration' })).not.toBeInTheDocument();

    const salesBtn = screen.getByRole('button', { name: 'Sales' });
    fireEvent.click(salesBtn);
    expect(screen.queryByRole('link', { name: 'Retail Counter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tax Invoices' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sales Orders' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quotations' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Customers' })).toBeInTheDocument();
  });

  it('renders authorized financial reports for accounts role without administration access', () => {
    setup('accounts');
    expect(screen.getByRole('button', { name: 'Finance' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Administration' })).not.toBeInTheDocument();

    const financeBtn = screen.getByRole('button', { name: 'Finance' });
    fireEvent.click(financeBtn);
    expect(screen.getByRole('link', { name: 'Payments & Ledger' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sales & Receipts' })).toBeInTheDocument();
  });

  it('renders collapsed sidebar with icon titles and hides text labels', () => {
    setup('owner', true);
    // In collapsed mode, text labels in spans are not rendered
    expect(screen.queryByText('Sample Electricals')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sales' })).not.toBeInTheDocument();

    // Links exist with title attribute for tooltip accessibility
    const dashboardLink = screen.getByRole('link', { name: 'Dashboard' });
    expect(dashboardLink).toBeInTheDocument();
    expect(dashboardLink).toHaveAttribute('title', 'Dashboard');
  });
});
