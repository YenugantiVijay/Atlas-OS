import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { teamInvitationService } from '@/services/team-invitation.service';
import { TeamInvitationPage } from './TeamInvitationPage';

const refreshOrgData = vi.fn().mockResolvedValue(undefined);
vi.mock('@/features/organizations/OrgContext', () => ({
  useOrg: () => ({
    currentUser: { email: 'manager@example.com' }, isAuthenticated: true,
    isLoadingAuth: false, isLoadingOrgData: false, refreshOrgData, signOut: vi.fn(),
  }),
}));
vi.mock('@/features/auth/AuthModal', () => ({ AuthModal: () => null }));

describe('Team invitation link', () => {
  it('selects the invited workspace when acceptance succeeds', async () => {
    const inviteId = 'e62a469b-58a5-4329-90af-a4f028439982';
    const orgId = 'fc9fce1c-8416-4fed-a43e-f822bd3a9c27';
    const accept = vi.spyOn(teamInvitationService, 'accept').mockResolvedValue(orgId);
    render(<MemoryRouter initialEntries={['/invite/' + inviteId]}><Routes>
      <Route path="/invite/:inviteId" element={<TeamInvitationPage />} />
      <Route path="/" element={<h1>Workspace dashboard</h1>} />
    </Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('heading', { name: 'Workspace dashboard' })).toBeVisible();
    await waitFor(() => expect(refreshOrgData).toHaveBeenCalledWith(orgId));
    expect(accept).toHaveBeenCalledWith(inviteId);
  });
});
