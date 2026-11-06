import React from 'react';
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

describe('Sidebar Essentials and All Tools navigation', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetAllMocks();
  });

  it('defaults to Essentials while retaining core business navigation', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Essentials' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('link', { name: /Dashboard/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Sales Orders/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Products & SKUs/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Tax Invoices/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Payments & Ledger/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Quotations/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /ATLAS AI Assistant/ })).toBeNull();
  });

  it('shows all permission-allowed navigation when selected and saves the choice', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'All Tools' }));
    expect(screen.getByRole('link', { name: /Quotations/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /ATLAS AI Assistant/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All Tools' }).getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem('atlas_workspace_view_v1:cloud:user-a:org-a')).toBe('all');
    fireEvent.click(screen.getByRole('button', { name: 'Essentials' }));
    expect(screen.queryByRole('link', { name: /ATLAS AI Assistant/ })).toBeNull();
  });

  it('does not reveal unauthorized functionality through All Tools', () => {
    setup('viewer');
    fireEvent.click(screen.getByRole('button', { name: 'All Tools' }));
    expect(screen.queryByRole('link', { name: /Sales & Receipts/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Team & Access/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Org Settings/ })).toBeNull();
  });

  it('shows the right saved preference when the active organization changes', () => {
    const view = setup();
    fireEvent.click(screen.getByRole('button', { name: 'All Tools' }));
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
    expect(screen.getByRole('button', { name: 'Essentials' }).getAttribute('aria-pressed')).toBe('true');
  });
});
