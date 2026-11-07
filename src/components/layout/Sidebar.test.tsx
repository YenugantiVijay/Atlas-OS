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

function setup(role: 'owner' | 'viewer' | 'sales' = 'owner') {
  vi.mocked(useOrg).mockReturnValue({
    currentOrg,
    currentUser,
    currentRole: role,
    isDemoMode: false,
  } as any);
  return render(
    <MemoryRouter>
      <Sidebar collapsed={false} onToggle={() => {}} />
    </MemoryRouter>
  );
}

describe('Sidebar Simple View and Full Navigation', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetAllMocks();
  });

  it('defaults to a compact five-section navigation without changing access', () => {
    setup();
    const picker = screen.getByRole('combobox', { name: 'Navigation layout' }) as HTMLSelectElement;
    expect(picker.value).toBe('essentials');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sales' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Inventory' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Finance' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('link', { name: 'Org Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Quotations' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'ATLAS AI Assistant' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sales' }));
    expect(screen.getByRole('link', { name: 'Sales Orders' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tax Invoices' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inventory' }));
    expect(screen.getByRole('link', { name: 'Products & SKUs' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finance' }));
    expect(screen.getByRole('link', { name: 'Payments & Ledger' })).toBeInTheDocument();
  });

  it('shows only permission-allowed tools in Full Navigation and saves layout choice', () => {
    setup();
    fireEvent.change(screen.getByRole('combobox', { name: 'Navigation layout' }), { target: { value: 'all' } });
    expect(screen.getByRole('link', { name: 'Quotations' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ATLAS AI Assistant' })).toBeInTheDocument();
    expect((screen.getByRole('combobox', { name: 'Navigation layout' }) as HTMLSelectElement).value).toBe('all');
    expect(window.localStorage.getItem('atlas_workspace_view_v1:cloud:user-a:org-a')).toBe('all');
    fireEvent.change(screen.getByRole('combobox', { name: 'Navigation layout' }), { target: { value: 'essentials' } });
    expect(screen.queryByRole('link', { name: 'ATLAS AI Assistant' })).not.toBeInTheDocument();
  });

  it('does not grant an unauthorized role more access through Full Navigation', () => {
    setup('viewer');
    fireEvent.change(screen.getByRole('combobox', { name: 'Navigation layout' }), { target: { value: 'all' } });
    expect(screen.queryByRole('link', { name: 'Sales & Receipts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Team & Access' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Org Settings' })).not.toBeInTheDocument();
  });

  it('does not carry navigation preferences across organizations', () => {
    const view = setup();
    fireEvent.change(screen.getByRole('combobox', { name: 'Navigation layout' }), { target: { value: 'all' } });
    vi.mocked(useOrg).mockReturnValue({
      currentOrg: { ...currentOrg, id: 'org-b' },
      currentUser,
      currentRole: 'owner',
      isDemoMode: false,
    } as any);
    view.rerender(
      <MemoryRouter>
        <Sidebar collapsed={false} onToggle={() => {}} />
      </MemoryRouter>
    );
    expect((screen.getByRole('combobox', { name: 'Navigation layout' }) as HTMLSelectElement).value).toBe('essentials');
  });
  it('hides raw financial invoices and payment ledgers from sales and viewer roles', () => {
    for (const role of ['sales', 'viewer'] as const) {
      const view = setup(role);
      fireEvent.change(screen.getByRole('combobox', { name: 'Navigation layout' }), {
        target: { value: 'all' },
      });
      expect(screen.queryByRole('link', { name: 'Tax Invoices' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Payments & Ledger' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Sales & Receipts' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
      view.unmount();
      window.localStorage.clear();
    }
  });

});
