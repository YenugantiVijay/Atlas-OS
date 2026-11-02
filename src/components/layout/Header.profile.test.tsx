import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { Header } from './Header';
import { useOrg, OrgContextType } from '@/features/organizations/OrgContext';
import { ToastProvider } from '@/components/ui/Toast';

vi.mock('@/features/organizations/OrgContext', () => ({ useOrg: vi.fn() }));

it('keeps the profile form open and reports an asynchronous save failure', async () => {
  const updateCurrentUser = vi.fn().mockRejectedValue(new Error('Server unavailable'));
  vi.mocked(useOrg).mockReturnValue({
    currentOrg: { id: 'org-1', name: 'Test business' }, organizations: [], currentRole: 'owner',
    currentUser: { id: 'user-1', fullName: 'Test User', email: 'user@example.com' },
    isAuthenticated: true, isMockAuth: false, updateCurrentUser,
  } as unknown as OrgContextType);
  render(<MemoryRouter><ToastProvider><Header collapsed={false} onOpenCommandPalette={() => {}}
    onOpenQuickCreate={() => {}} onOpenNewOrgModal={() => {}} /></ToastProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'User Profile & Shop Menu' }));
  fireEvent.click(screen.getByText('Edit Profile & Photo'));
  expect(screen.getByRole('textbox', { name: 'Email Address' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save Profile' }));
  await waitFor(() => expect(screen.getByText('Failed to update profile')).toBeInTheDocument());
  expect(screen.getByRole('dialog', { name: 'Edit Profile & Avatar' })).toBeInTheDocument();
  expect(screen.queryByText('Profile Updated')).not.toBeInTheDocument();
  expect(screen.getByText('Server unavailable')).toBeInTheDocument();
});
