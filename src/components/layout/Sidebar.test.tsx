import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

function setup(role: 'owner' | 'admin' | 'sales' | 'inventory' | 'accounts' | 'viewer' = 'owner', collapsed = false, expand = true) {
  vi.mocked(useOrg).mockReturnValue({
    currentOrg,
    currentUser,
    currentRole: role,
    isDemoMode: false,
  } as any);
  const view = render(
    <MemoryRouter>
      <Sidebar collapsed={collapsed} onToggle={() => {}} />
    </MemoryRouter>
  );
  if(expand&&!collapsed) for(const name of ['Sales','Inventory','Finance','People','Administration']) {const button=screen.queryByRole('button',{name});if(button)fireEvent.click(button);}
  return view;
}

describe('Sidebar Navigation Cleanup & Role-Based Access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts with a short menu and finds modules without revealing forbidden links',()=>{
    setup('sales',false,false);expect(screen.getByRole('button',{name:'Sales'})).toHaveAttribute('aria-expanded','false');expect(screen.queryByRole('link',{name:'Sales Orders'})).toBeNull();
    fireEvent.change(screen.getByRole('searchbox',{name:'Find a module'}),{target:{value:'quotation'}});expect(screen.getByRole('link',{name:'Quotations'})).toBeVisible();expect(screen.queryByRole('link',{name:'Customers'})).toBeNull();
    fireEvent.change(screen.getByRole('searchbox',{name:'Find a module'}),{target:{value:'Tax Invoices'}});expect(screen.getByText('No matching modules.')).toBeVisible();expect(screen.queryByRole('link',{name:'Tax Invoices'})).toBeNull();
  });
  it('does not render any view selector or layout dropdown control', () => {
    setup('owner');
    expect(screen.queryByRole('combobox', { name: /navigation layout/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Simple View/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Full Navigation/i)).not.toBeInTheDocument();
  });

  it('opens grouped navigation with authorized links for owner', () => {
    setup('owner');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Sales')).toBeInTheDocument();
    expect(screen.getByText('Inventory')).toBeInTheDocument();
    expect(screen.getByText('Finance')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ATLAS AI Assistant' })).toBeInTheDocument();
    expect(screen.getByText('Administration')).toBeInTheDocument();

    // Authorized sections open on demand.
    expect(screen.getByRole('button', { name: 'Sales' })).toHaveAttribute('aria-expanded','true');
    expect(screen.getByRole('button', { name: 'Inventory' })).toHaveAttribute('aria-expanded','true');
    expect(screen.getByRole('button', { name: 'Finance' })).toHaveAttribute('aria-expanded','true');
    expect(screen.getByRole('button', { name: 'Administration' })).toHaveAttribute('aria-expanded','true');

    // Expanded sections expose their authorized links.
    expect(screen.getByRole('link', { name: 'Retail Counter' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sales Orders' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quotations' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tax Invoices' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Customers' })).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Products & SKUs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Stock Movements' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Suppliers & Vendors' })).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Payments & Ledger' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sales & Receipts' })).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Team & Access' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Audit Trail' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Org Settings' })).toBeInTheDocument();
  });

  it('hides all financial and administrative links from sales role', () => {
    setup('sales');
    // Financial and admin sections must NOT be rendered
    expect(screen.queryByText('Finance')).not.toBeInTheDocument();
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tax Invoices' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Payments & Ledger' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sales & Receipts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Team & Access' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit Trail' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Org Settings' })).not.toBeInTheDocument();

    // Sales and inventory links are directly visible
    expect(screen.getByText('Sales')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sales Orders' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quotations' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Customers' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tax Invoices' })).not.toBeInTheDocument();
  });

  it('hides order creation, financial documents, and admin from viewer role', () => {
    setup('viewer');
    expect(screen.queryByText('Finance')).not.toBeInTheDocument();
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();

    expect(screen.getByText('Sales')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Retail Counter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Tax Invoices' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sales Orders' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quotations' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Customers' })).toBeInTheDocument();
  });

  it('renders authorized financial reports for accounts role without administration access', () => {
    setup('accounts');
    expect(screen.getByText('Finance')).toBeInTheDocument();
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Payments & Ledger' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sales & Receipts' })).toBeInTheDocument();
  });

  it('renders collapsed sidebar with icon titles and hides text labels', () => {
    setup('owner', true);
    // In collapsed mode, text labels in spans and section headings are not rendered
    expect(screen.queryByText('Sample Electricals')).not.toBeInTheDocument();
    expect(screen.queryByText('Sales')).not.toBeInTheDocument();

    // Links exist with title attribute for tooltip accessibility
    const dashboardLink = screen.getByRole('link', { name: 'Dashboard' });
    expect(dashboardLink).toBeInTheDocument();
    expect(dashboardLink).toHaveAttribute('title', 'Dashboard');
  });
});
