import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformAdminPage } from './PlatformAdminPage';
import { platformAdminService, type PlatformWorkspace } from '@/services/platform-admin.service';

const auth = vi.hoisted(() => ({ reviewer: false }));
vi.mock('@/features/organizations/OrgContext', () => ({
  useOrg: () => ({ currentUser: { id: 'reviewer-user' }, isAuthenticated: true, isDemoMode: false }),
}));
vi.mock('@/features/auth/AuthModal', () => ({ AuthModal: () => null }));
vi.mock('@/hooks/usePlatformReviewer', () => ({
  usePlatformReviewer: () => ({ data: auth.reviewer, isLoading: false, isError: false }),
}));
vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: () => true }));
vi.mock('@/services/platform-admin.service', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/platform-admin.service')>(),
  platformAdminService: { list: vi.fn(), review: vi.fn() },
}));

const workspace: PlatformWorkspace = {
  id: 'shop', name: 'Example Online Store', business_category: 'ecommerce',
  eligibility_status: 'review_required', declaration_updated_at: '2026-11-16T06:00:00Z',
  product_lines: ['Home accessories'], identity_present: true, sells_electrical: false,
  plan_tier: null, subscription_status: null, access_expires_at: null,
};

function renderPortal() {
  return render(<QueryClientProvider client={new QueryClient()}>
    <MemoryRouter><PlatformAdminPage /></MemoryRouter>
  </QueryClientProvider>);
}

describe('Platform Admin', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auth.reviewer = false;
  });

  it('clears the directory for a signed-in account without platform access', () => {
    renderPortal();
    expect(screen.getByRole('alert')).toHaveTextContent('does not have platform reviewer access');
    expect(platformAdminService.list).not.toHaveBeenCalled();
  });

  it('requires a decision and reason before recording an audited review', async () => {
    auth.reviewer = true;
    vi.mocked(platformAdminService.list).mockResolvedValueOnce({ workspaces: [workspace], hasNext: false })
      .mockResolvedValue({ workspaces: [], hasNext: false });
    vi.mocked(platformAdminService.review).mockResolvedValue(undefined);
    renderPortal();
    fireEvent.click(await screen.findByRole('button', { name: 'Review declaration' }));
    const form = within(screen.getByRole('dialog'));
    const submit = form.getByRole('button', { name: 'Record decision' });
    expect(submit).toBeDisabled();
    fireEvent.change(form.getByRole('combobox', { name: 'Decision' }), { target: { value: 'approved' } });
    expect(submit).toBeDisabled();
    fireEvent.change(form.getByRole('textbox', { name: 'Decision reason' }), { target: { value: 'Reviewed registration' } });
    fireEvent.click(submit);
    expect(await screen.findByText('Decision recorded in the workspace audit history.')).toBeVisible();
    expect(platformAdminService.review).toHaveBeenCalledWith(workspace, 'approved', 'Reviewed registration');
  });
});
