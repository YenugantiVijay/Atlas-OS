import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseStaffPayAmount, staffPayService } from '@/services/staff-pay.service';
import { StaffPaySetupPage } from './StaffPaySetupPage';

const fixture = vi.hoisted(() => ({
  org: { id: 'workspace-one', currency: 'INR' },
  user: { id: 'owner' },
  demo: false,
}));
vi.mock('@/features/organizations/OrgContext', () => ({
  useOrg: () => ({
    currentOrg: fixture.org, currentUser: fixture.user, isDemoMode: fixture.demo, isAuthenticated: !fixture.demo,
  }),
}));
vi.mock('@/hooks/useActionPermission', () => ({ useActionPermission: () => ({ can: () => true }) }));

function open() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><StaffPaySetupPage /></MemoryRouter>
  </QueryClientProvider>);
}

describe('Staff and pay setup', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fixture.demo = false;
  });

  it('sets up a studio employee and records exact paise on the effective date', async () => {
    const studio = { id: 'studio', name: 'Print studio' };
    const person = {
      id: 'employee', display_name: 'Asha', joining_on: '2026-11-15',
      staff_location_assignments: [{ location_id: studio.id }],
    };
    vi.spyOn(staffPayService, 'listLocations').mockResolvedValue([studio]);
    vi.spyOn(staffPayService, 'listStaff').mockResolvedValueOnce({ rows: [], count: 0 })
      .mockResolvedValue({ rows: [person], count: 1 });
    const addStaff = vi.spyOn(staffPayService, 'addStaff').mockResolvedValue();
    vi.spyOn(staffPayService, 'listRates').mockResolvedValue({ rows: [], count: 0, current: null });
    const addRate = vi.spyOn(staffPayService, 'addRate').mockResolvedValue();
    const user = userEvent.setup();

    open();
    await user.type(screen.getByRole('textbox', { name: 'Employee name' }), 'Asha');
    fireEvent.change(screen.getByLabelText(/Joining date/), { target: { value: person.joining_on } });
    await user.click(await screen.findByRole('checkbox', { name: studio.name }));
    await user.click(screen.getByRole('button', { name: 'Add employee' }));
    await waitFor(() => expect(addStaff).toHaveBeenCalledWith(
      fixture.org.id, expect.any(String), 'Asha', person.joining_on, [studio.id],
    ));
    await user.click(await screen.findByRole('button', { name: 'Manage pay for Asha' }));
    await user.selectOptions(screen.getByLabelText('Pay basis'), 'daily');
    await user.type(screen.getByRole('textbox', { name: 'Rate (INR)' }), '500.25');
    fireEvent.change(screen.getByLabelText(/Effective date/), { target: { value: '2026-11-17' } });
    await user.click(screen.getByRole('button', { name: 'Save pay rate' }));
    await waitFor(() => expect(addRate).toHaveBeenCalledWith(fixture.org.id, person, '2026-11-17', 'daily', 50025));
    expect(await screen.findByText('Pay rate saved.')).toBeVisible();
  });

  it('keeps the staff workspace out of Demo Mode', () => {
    fixture.demo = true;
    const staff = vi.spyOn(staffPayService, 'listStaff');
    open();
    expect(screen.getByText('Sign in to a cloud workspace to use staff and pay setup.')).toBeVisible();
    expect(staff).not.toHaveBeenCalled();
  });

  it('validates currency amounts before writing', () => {
    expect(parseStaffPayAmount(' 15000.01 ')).toBe(1500001);
    for (const invalid of ['0', '-300', '', '1e3', '10.001', '1000000000']) {
      expect(() => parseStaffPayAmount(invalid)).toThrow();
    }
  });
});
