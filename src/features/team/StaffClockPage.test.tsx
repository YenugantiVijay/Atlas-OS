import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StaffClockPage } from './StaffClockPage';
import { attendanceMonthBounds, staffClockService, type StaffClockSession } from '@/services/staff-clock.service';
import { staffPayService } from '@/services/staff-pay.service';
import { getBusinessDate } from '@/lib/dates';

const state = vi.hoisted(() => ({ manager: false, write: true }));
vi.mock('@/features/organizations/OrgContext', () => ({ useOrg: () => ({
  currentOrg: { id: 'org-a' }, currentUser: { id: 'user-a' }, currentRole: 'viewer',
  isAuthenticated: true, isDemoMode: false, get canWriteOperations() { return state.write; },
}) }));
vi.mock('@/hooks/useAttendanceAccess', () => ({ useAttendanceAccess: () => ({ data: state.manager }) }));
const session: StaffClockSession = {
  id: 'shift-a', staff_id: 'staff-a', user_id: 'user-a', work_date: getBusinessDate(), location_id: 'shop',
  checked_in_at: '2026-11-27T04:00:00Z', checked_out_at: null, break_started_at: null,
  break_seconds: 0, work_summary: null, worked_minutes: null,
};
let active: StaffClockSession | null;
function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><StaffClockPage /></MemoryRouter></QueryClientProvider>);
}
describe('Employee attendance self-service', () => {
  beforeEach(() => {
    vi.restoreAllMocks(); state.manager = false; state.write = true; active = null;
    vi.spyOn(staffClockService, 'account').mockResolvedValue({ staff_id: 'staff-a', user_id: 'user-a', is_active: true });
    vi.spyOn(staffClockService, 'active').mockImplementation(async () => active);
    vi.spyOn(staffClockService, 'locations').mockResolvedValue([{ id: 'shop', name: 'Assigned shop' }]);
    vi.spyOn(staffClockService, 'month').mockResolvedValue({ rows: [], count: 0 });
    vi.spyOn(staffClockService, 'summary').mockResolvedValue({ recorded_shifts: 0, completed_shifts: 0, worked_minutes: 0 });
  });
  it('checks in, records breaks and requires a real daily report before checkout', async () => {
    const act = vi.spyOn(staffClockService, 'act').mockImplementation(async (_org, kind) => {
      active = kind === 'check_out' ? null : { ...session, break_started_at: kind === 'start_break' ? session.checked_in_at : null };
    });
    const user = userEvent.setup(); open();
    await screen.findByRole('option', { name: 'Assigned shop' });
    await user.selectOptions(screen.getByLabelText('Assigned work location'), 'shop');
    await user.click(screen.getByRole('button', { name: 'Check in' }));
    await user.click(await screen.findByRole('button', { name: 'Start break' }));
    await user.click(await screen.findByRole('button', { name: 'End break' }));
    const checkout = await screen.findByRole('button', { name: 'Submit report & check out' });
    expect(checkout).toBeDisabled();
    await user.type(screen.getByLabelText(/Daily work summary/), 'Received stock and completed the daily counter reconciliation.');
    await user.click(checkout);
    await waitFor(() => expect(act).toHaveBeenLastCalledWith('org-a', 'check_out', 'shift-a', 'shop', 'Received stock and completed the daily counter reconciliation.'));
    expect(screen.queryByRole('button', { name: 'Show team attendance' })).toBeNull();
    expect(staffClockService.month).toHaveBeenCalledWith('org-a', getBusinessDate().slice(0, 7), 1, 'user-a');
  });
  it('does not claim success on an uncertain write and requires a refresh', async () => {
    vi.spyOn(staffClockService, 'act').mockRejectedValue(new Error('Server confirmation unavailable'));
    const user = userEvent.setup(); open();
    await screen.findByRole('option', { name: 'Assigned shop' });
    await user.selectOptions(screen.getByLabelText('Assigned work location'), 'shop');
    await user.click(screen.getByRole('button', { name: 'Check in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Server confirmation unavailable');
    expect(screen.getByRole('button', { name: 'Check in' })).toBeDisabled();
    expect(screen.queryByText('Attendance action confirmed by the server.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Refresh attendance' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check in' })).toBeEnabled());
  });
  it('shows unlinked employees setup guidance without a check-in button', async () => {
    vi.spyOn(staffClockService, 'account').mockResolvedValue(null); open();
    expect(await screen.findByText('Ask the owner to link your sign-in to an existing staff profile.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Check in' })).toBeNull();
  });
  it('allows an authorized attendance manager to request team monthly totals', async () => {
    state.manager = true;
    vi.spyOn(staffPayService, 'listStaff').mockResolvedValue({ rows: [], count: 0 });
    const user = userEvent.setup(); open();
    await user.click(await screen.findByRole('button', { name: 'Show team attendance' }));
    await waitFor(() => expect(staffClockService.summary).toHaveBeenCalledWith('org-a', getBusinessDate().slice(0, 7), undefined));
    expect(screen.getByRole('heading', { name: 'Team attendance & daily reports' })).toBeVisible();
  });
  it('keeps check-in disabled when workspace writes are unavailable', async () => {
    state.write = false; const user = userEvent.setup(); open();
    await screen.findByRole('option', { name: 'Assigned shop' });
    await user.selectOptions(screen.getByLabelText('Assigned work location'), 'shop');
    expect(screen.getByRole('button', { name: 'Check in' })).toBeDisabled();
  });
});
describe('Attendance month boundaries', () => {
  it('handles December rollover and leap-year month boundaries', () => {
    expect(attendanceMonthBounds('2026-12')).toEqual({ start: '2026-12-01', end: '2027-01-01' });
    expect(attendanceMonthBounds('2028-02')).toEqual({ start: '2028-02-01', end: '2028-03-01' });
    for (const month of ['', '2026-13', '2026-2', '1800-01']) expect(() => attendanceMonthBounds(month)).toThrow();
  });
});
