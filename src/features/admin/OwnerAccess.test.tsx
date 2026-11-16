import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { OwnerAccess } from './OwnerAccess';

vi.mock('@/lib/owner-supabase', () => ({
  ownerSupabase: {
    auth: {
      onAuthStateChange: (listener: (event: string, session: null) => void) => {
        listener('INITIAL_SESSION', null);
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
