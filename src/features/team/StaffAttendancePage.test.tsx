import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBusinessDate, getBusinessDateOffset } from '@/lib/dates';
import { staffAttendanceService, type AttendanceEntry } from '@/services/staff-attendance.service';
import { staffPayService } from '@/services/staff-pay.service';
import { StaffAttendancePage } from './StaffAttendancePage';

const session = vi.hoisted(() => ({
  currentOrg: { id: 'org-one' }, currentUser: { id: 'user-one' }, currentRole: 'viewer',
  isAuthenticated: true, isDemoMode: false, canWriteOperations: true,
}));
vi.mock('@/features/organizations/OrgContext', () => ({ useOrg: () => session }));

const employee = { id: 'employee', display_name: 'Asha', joining_on: '2020-01-01' };
const locations = [{ id: 'studio', name: 'Print studio' }, { id: 'stall', name: 'Ice-cream stall' }];

function open() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>
    <MemoryRouter><StaffAttendancePage /></MemoryRouter>
  </QueryClientProvider>);
}

describe('Staff attendance', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    session.currentRole = 'viewer';
    vi.spyOn(staffPayService, 'listLocations').mockResolvedValue(locations);
  });

  it('lets a delegated manager save and change the location for a selected date', async () => {
    vi.spyOn(staffAttendanceService, 'canManage').mockResolvedValue(true);
    let entries: AttendanceEntry[] = [];
    vi.spyOn(staffAttendanceService, 'listDay').mockImplementation(async () => ({ staff: [employee], entries, count: 1 }));
    const save = vi.spyOn(staffAttendanceService, 'save').mockImplementation(async (_org, _staff, _date, entry) => {
      entries = [{
        staff_id: employee.id, location_id: entry.location, status: entry.status,
        revision: entry.revision, recorded_at: new Date().toISOString(),
      }];
    });
    const user = userEvent.setup();
    open();
    const row = async () => within(await screen.findByRole('region', { name: 'Attendance for Asha' }));
    expect(screen.queryByRole('button', { name: 'Manage access' })).toBeNull();
    expect((await row()).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.selectOptions((await row()).getByRole('combobox', { name: 'Work location' }), 'studio');
    await user.click((await row()).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Present · Print studio')).toBeVisible();
    await user.selectOptions((await row()).getByRole('combobox', { name: 'Work location' }), 'stall');
    await user.click((await row()).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Present · Ice-cream stall')).toBeVisible();
    expect(save).toHaveBeenLastCalledWith(session.currentOrg.id, employee, getBusinessDate(), {
      revision: 2, location: 'stall', status: 'present',
    });
  });

  it('schedules future dates and lets an owner grant attendance access', async () => {
    session.currentRole = 'owner';
    vi.spyOn(staffAttendanceService, 'canManage').mockResolvedValue(true);
    vi.spyOn(staffAttendanceService, 'listDay').mockResolvedValue({ staff: [employee], entries: [], count: 1 });
    vi.spyOn(staffAttendanceService, 'listManagerCandidates').mockResolvedValue([
      { user_id: 'member-two', email: 'manager@example.com', is_active: true, is_granted: false },
    ]);
    const grant = vi.spyOn(staffAttendanceService, 'setManager').mockResolvedValue();
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('button', { name: 'Manage access' }));
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Team member' }), 'member-two');
    await user.click(screen.getByRole('button', { name: 'Grant access' }));
    await waitFor(() => expect(grant).toHaveBeenCalledWith(session.currentOrg.id, 'member-two', true));
    fireEvent.change(screen.getByLabelText(/Attendance date/), { target: { value: getBusinessDateOffset(1) } });
    const roster = await screen.findByRole('region', { name: 'Attendance for Asha' });
    expect(within(roster).getByRole('combobox', { name: 'Status' })).toHaveValue('scheduled');
    expect(within(roster).queryByRole('option', { name: 'Present' })).toBeNull();
  });

  it('does not fetch the roster for an ordinary team member', async () => {
    vi.spyOn(staffAttendanceService, 'canManage').mockResolvedValue(false);
    const roster = vi.spyOn(staffAttendanceService, 'listDay');
    open();
    expect(await screen.findByText('Ask the workspace owner for attendance access.')).toBeVisible();
    expect(roster).not.toHaveBeenCalled();
  });
});
