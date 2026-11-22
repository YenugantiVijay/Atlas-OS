import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getBusinessDate } from '@/lib/dates';
import { staffAdvanceService } from '@/services/staff-advances.service';
import { ReversePaydayForm } from './StaffAdvanceForms';
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
    expect(screen.getByText('Wage basis')).toBeInTheDocument();
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

  it('accurately respects capacity across multiple advance lines when using Include missed', async () => {
    const scope = { orgId: 'studio', userId: 'owner', staffId: 'employee' };
    vi.spyOn(staffAdvanceService, 'previewPayday').mockResolvedValue({
      snapshot: 'multiline-checked', latest_period: null,
      rate: { basis: 'monthly', amount_paise: 2000000, effective_on: '2026-01-01' },
      lines: [
        { id: 'adv-1', note: 'Advance 1', balance_paise: 1000000, scheduled_paise: 200000, catchup_paise: 400000 },
        { id: 'adv-2', note: 'Advance 2', balance_paise: 1000000, scheduled_paise: 200000, catchup_paise: 400000 },
      ],
    });
    render(<QueryClientProvider client={new QueryClient()}>
      <StaffPaydayReview scope={scope} joiningOn="2026-01-01" currency="INR" onSaved={vi.fn()} />
    </QueryClientProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'Use rate for gross pay' }));
    // Wage basis = 10,000 -> capacity = 5,000
    fireEvent.change(screen.getByRole('textbox', { name: 'Wage basis for deduction limit (INR)' }), { target: { value: '10000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview payday' }));

    const inputs = await screen.findAllByRole('textbox', { name: 'Deduct (INR)' });
    expect(inputs).toHaveLength(2);
    // Initially each scheduled is 2,000 -> total 4,000 <= 5,000 capacity.
    const includeButtons = screen.getAllByRole('button', { name: 'Include missed' });
    expect(includeButtons).toHaveLength(2);

    // Line 1 include missed -> with Line 2 scheduled at 2,000 and total capacity 5,000,
    // Line 1 can claim at most 5,000 - 2,000 = 3,000.00
    fireEvent.click(includeButtons[0]);
    expect(inputs[0]).toHaveValue('3000.00');

    // Click include missed on Line 2 -> with Line 1 at 3,000, Line 2 gets remaining 5,000 - 3,000 = 2,000.00
    fireEvent.click(includeButtons[1]);
    expect(inputs[1]).toHaveValue('2000.00');
  });

  it('shows the amount that returns to advances and requires a reason before reversing', async () => {
    const scope = { orgId: 'studio', userId: 'owner', staffId: 'employee' };
    const reverse = vi.spyOn(staffAdvanceService, 'reversePayday').mockResolvedValue();
    const saved = vi.fn().mockResolvedValue(undefined);
    render(<ReversePaydayForm scope={scope} currency="INR" month="March 2026" onClose={vi.fn()} onSaved={saved}
      payday={{
        id: 'march-payday', period: '2026-03-01', gross_paise: 1500000, net_paise: 950000,
        advance_deductions_paise: 450000, other_deductions_paise: 100000, method: 'bank',
        reversed_at: null, reversal_reason: null,
      }} />);
    expect(screen.getByRole('dialog', { name: 'Reverse March 2026 payday' })).toHaveAccessibleDescription(/restores ₹4,500\.00/);
    const submit = screen.getByRole('button', { name: 'Reverse payday' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason for reversal' }), { target: { value: 'Wrong deduction' } });
    fireEvent.click(submit);
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(reverse).toHaveBeenCalledExactlyOnceWith(scope, 'march-payday', 'Wrong deduction');
  });
});
