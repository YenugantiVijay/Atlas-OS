import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { OwnerAccess } from './OwnerAccess';

const auth = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  listener: (_event: string, _session: unknown) => {},
  assurance: vi.fn(),
  getSession: vi.fn(),
  gate: vi.fn(),
}));

vi.mock('@/features/auth/AuthenticatorChallenge', () => ({
  AuthenticatorChallenge: () => <p>Authenticator challenge</p>,
}));
vi.mock('./OwnerConsole', () => ({ OwnerConsole: () => <p>Owner workspace</p> }));

vi.mock('@/lib/owner-supabase', () => ({
  ownerSupabase: {
    rpc: auth.gate,
    auth: {
      getSession: auth.getSession,
      mfa: { getAuthenticatorAssuranceLevel: auth.assurance },
      onAuthStateChange: (listener: typeof auth.listener) => {
        auth.listener = listener;
        listener('INITIAL_SESSION', auth.session);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  },
}));

it('shows the Atlas brand and only reveals the owner password when requested', async () => {
  const { container } = render(<QueryClientProvider client={new QueryClient()}><OwnerAccess /></QueryClientProvider>);
  const password = await screen.findByLabelText(/Password/);
  expect(screen.getByText('Atlas OS')).toBeVisible();
  expect(container.querySelector('img[src="/favicon.svg"]')).toBeVisible();
  expect(password).toHaveAttribute('type', 'password');
  fireEvent.change(password, { target: { value: 'fixture password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
  expect(password).toHaveAttribute('type', 'text');
  expect(password).toHaveValue('fixture password');
  fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
  expect(password).toHaveAttribute('type', 'password');
  fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
  fireEvent.click(screen.getByRole('button', { name: 'Use email code' }));
  expect(screen.queryByLabelText(/Password/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Use password' }));
  expect(screen.getByLabelText(/Password/)).toHaveAttribute('type', 'password');
});


it('requires MFA before calling the protected owner gate', async () => {
  auth.session = { user: { id: 'owner' } };
  auth.gate.mockClear().mockResolvedValue({ data: true });
  auth.assurance.mockResolvedValue({ data: { currentLevel: 'aal1' } });
  render(<QueryClientProvider client={new QueryClient()}><OwnerAccess /></QueryClientProvider>);
  expect(await screen.findByText('Authenticator challenge')).toBeVisible();
  expect(auth.gate).not.toHaveBeenCalled();
  auth.assurance.mockResolvedValue({ data: { currentLevel: 'aal2' } });
  act(() => auth.listener('MFA_CHALLENGE_VERIFIED', auth.session));
  expect(await screen.findByText('Owner workspace')).toBeVisible();
  expect(auth.gate).toHaveBeenCalledWith('owner_console_gate');
});

it('can retry a failed gate and still denies an unauthorized account', async () => {
  auth.session = { user: { id: 'other' } };
  auth.assurance.mockResolvedValue({ data: { currentLevel: 'aal2' } });
  auth.getSession.mockResolvedValue({ data: { session: auth.session } });
  auth.gate.mockReset().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue({ data: false });
  render(<QueryClientProvider client={new QueryClient()}><OwnerAccess /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This account is not authorized');
  expect(screen.queryByText('Owner workspace')).not.toBeInTheDocument();
});
