import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeAccountLinks } from './StaffEmployeeAccounts';
import { staffPayService } from '@/services/staff-pay.service';
import { staffAttendanceService } from '@/services/staff-attendance.service';
import { staffClockService } from '@/services/staff-clock.service';

describe('Employee sign-in links', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(staffPayService, 'listStaff').mockResolvedValue({ rows: [{ id: 'staff-a', display_name: 'Asha', joining_on: '2020-01-01', staff_location_assignments: [] }], count: 1 });
    vi.spyOn(staffAttendanceService, 'listManagerCandidates').mockResolvedValue([
      { user_id: 'user-a', email: 'asha@example.test', is_active: true, is_granted: false },
      { user_id: 'disabled-user', email: 'disabled@example.test', is_active: false, is_granted: false },
    ]);
    vi.spyOn(staffClockService, 'accounts').mockResolvedValue([]);
  });
  function open(editable: boolean) {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EmployeeAccountLinks orgId="org-a" userId="owner-a" editable={editable} />
    </QueryClientProvider>);
  }
  it('links an active sign-in to the selected employee after server acknowledgement', async () => {
    const link = vi.spyOn(staffClockService, 'link').mockResolvedValue();
    const user = userEvent.setup(); open(true);
    await user.click(screen.getByRole('button', { name: 'Link employee accounts' }));
    await screen.findByRole('option', { name: 'Asha' });
    expect(screen.queryByRole('option', { name: 'disabled@example.test' })).toBeNull();
    await user.selectOptions(screen.getByLabelText('Employee profile'), 'staff-a');
    await user.selectOptions(screen.getByLabelText('Employee sign-in'), 'user-a');
    await user.click(screen.getByRole('button', { name: 'Save employee link' }));
    await waitFor(() => expect(link).toHaveBeenCalledWith('org-a', 'staff-a', 'user-a', true));
    expect(await screen.findByRole('status')).toHaveTextContent('Employee link saved.');
  });
  it('keeps owner account linking disabled while workspace writes are unavailable', async () => {
    const user = userEvent.setup(); open(false);
    await user.click(screen.getByRole('button', { name: 'Link employee accounts' }));
    await screen.findByRole('option', { name: 'Asha' });
    expect(screen.getByRole('button', { name: 'Save employee link' })).toBeDisabled();
    expect(screen.getByLabelText('Employee sign-in')).toBeDisabled();
  });
});
