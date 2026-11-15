import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getBusinessDate } from '@/lib/dates';
import { staffAdvanceService } from '@/services/staff-advances.service';
import { StaffPaydayReview } from './StaffPaydayReview';

describe('Staff payday review', () => {
  it('defaults to one installment, supports skipping it or catching up, and checks the approved total', async () => {
    const scope = { orgId: 'studio', userId: 'owner', staffId: 'employee' };
    vi.spyOn(staffAdvanceService, 'previewPayday').mockResolvedValue({
      snapshot: 'balances-checked', latest_period: null,
      rate: { basis: 'monthly', amount_paise: 1500000, effective_on: '2026-01-01' },
      lines: [{ id: 'advance', note: 'Agreed advance', balance_paise: 1000000, scheduled_paise: 250000, catchup_paise: 500000 }],
    });
    const post = vi.spyOn(staffAdvanceService, 'postPayday').mockResolvedValue();
    const saved = vi.fn().mockResolvedValue(undefined);
    render(<QueryClientProvider client={new QueryClient()}>
      <StaffPaydayReview scope={scope} joiningOn="2026-01-01" currency="INR" onSaved={saved} />
    </QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Use rate for gross pay' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Wage basis for deduction limit (INR)' }), { target: { value: '15000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview payday' }));
    expect(await screen.findByRole('button', { name: 'Record ₹12,500.00 as paid' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Skip all advance deductions' }));
    expect(screen.getByRole('button', { name: 'Record ₹15,000.00 as paid' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Include missed' }));
    expect(screen.getByRole('textbox', { name: 'Deduct (INR)' })).toHaveValue('5000.00');
    fireEvent.change(screen.getByRole('textbox', { name: 'Deduct (INR)' }), { target: { value: '5000.01' } });
    expect(screen.getByRole('button', { name: 'Record pay' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Include missed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record ₹10,000.00 as paid' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      scope, getBusinessDate().slice(0, 7) + '-01',
      { gross: 1500000, wageBasis: 1500000, other: 0, limit: null },
      'bank', 'balances-checked', [{ id: 'advance', amount_paise: 500000 }],
    ));
    expect(saved).toHaveBeenCalled();
  });
});
