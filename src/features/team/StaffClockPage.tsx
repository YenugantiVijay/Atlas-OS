import { portalEntry } from '@/lib/portal-entry';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrg } from '@/features/organizations/OrgContext';
import { useAttendanceAccess } from '@/hooks/useAttendanceAccess';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Pagination } from '@/components/ui/Pagination';
import { getBusinessDate } from '@/lib/dates';
import { staffPayService } from '@/services/staff-pay.service';
import { staffClockService, type ClockAction, type StaffClockSession } from '@/services/staff-clock.service';
import { EmployeeAccountLinks } from './StaffEmployeeAccounts';

const time = (value: string | null) => value ? new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value)) : '—';
const duration = (minutes: number | null) => minutes === null ? 'In progress' : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

export function StaffClockPage() {
  const { currentOrg, currentUser, currentRole, isAuthenticated, isDemoMode, canWriteOperations } = useOrg();
  const access = useAttendanceAccess();
  return <div className="space-y-5">
    <header><h1 className="text-2xl font-bold">{portalEntry() === 'manager' ? 'Manager / HR Portal' : portalEntry() === 'employee' ? 'Employee Portal' : 'Employee Attendance'}</h1>
      <p className="mt-1 text-sm text-content-secondary">Check in, record breaks and submit your daily work summary. Times use IST.</p></header>
    {!isAuthenticated || isDemoMode || !currentOrg || !currentUser
      ? <Card>Sign in to a cloud workspace to use employee attendance.</Card>
      : <ClockWorkspace key={currentOrg.id + ':' + currentUser.id + ':' + currentRole}
        orgId={currentOrg.id} userId={currentUser.id} manager={access.data === true}
        owner={currentRole === 'owner'} editable={canWriteOperations} />}
  </div>;
}

function ClockWorkspace({ orgId, userId, manager, owner, editable }: {
  orgId: string; userId: string; manager: boolean; owner: boolean; editable: boolean;
}) {
  const [month, setMonth] = useState(getBusinessDate().slice(0, 7));
  const [page, setPage] = useState(1);
  const [team, setTeam] = useState(portalEntry() === 'manager');
  const [location, setLocation] = useState('');
  const [summary, setSummary] = useState('');
  const client = useQueryClient();
  const scope = ['staff-clock', orgId, userId];
  const account = useQuery({ queryKey: [...scope, 'account'], queryFn: () => staffClockService.account(orgId, userId) });
  const active = useQuery({ queryKey: [...scope, 'active'], queryFn: () => staffClockService.active(orgId, userId), refetchInterval: 30_000 });
  const locations = useQuery({ queryKey: [...scope, 'locations', account.data?.staff_id], queryFn: () => staffClockService.locations(orgId, account.data!.staff_id), enabled: account.data?.is_active === true });
  const today = useQuery({ queryKey: [...scope, 'today'], queryFn: () => staffClockService.month(orgId, getBusinessDate().slice(0, 7), 1, userId), enabled: account.data?.is_active === true });
  const history = useQuery({ queryKey: [...scope, 'month', month, page, manager && team],
    queryFn: () => staffClockService.month(orgId, month, page, manager && team ? undefined : userId), enabled: !!month });
  const totals = useQuery({ queryKey: [...scope, 'totals', month, manager && team],
    queryFn: () => staffClockService.summary(orgId, month, manager && team ? undefined : userId), enabled: !!month });
  const staff = useQuery({ queryKey: [...scope, 'staff-names'], queryFn: async () => {
    const rows = [];
    for (let index = 0; ; index++) {
      const batch = await staffPayService.listStaff(orgId, index);
      rows.push(...batch.rows);
      if (rows.length >= batch.count || batch.rows.length < 25) return rows;
    }
  }, enabled: manager });
  const action = useMutation({ mutationFn: (kind: ClockAction) => staffClockService.act(orgId, kind,
    active.data?.id, location || undefined, summary), onSuccess: async () => {
    setSummary('');
    await client.invalidateQueries({ queryKey: scope });
  } });
  const refresh = () => { action.reset(); void client.invalidateQueries({ queryKey: scope }); };
  const todayClosed = today.data?.rows.some(row => row.work_date === getBusinessDate() && row.checked_out_at);
  const shift = active.data;
  const busy = action.isPending || !editable || !account.isSuccess || !active.isSuccess || action.isError;
  return <>
    <nav className="flex flex-wrap gap-3 text-sm font-semibold text-teal-800">
      {manager && <Link to="/attendance">Manager daily roster</Link>}
      {owner && <Link to="/team/staff">Staff &amp; Pay Setup</Link>}
    </nav>
    <Card className="space-y-3">
      <h2 className="font-semibold">My shift</h2>
      {(account.isPending || active.isPending) && <p role="status">Loading your attendance…</p>}
      {(account.isError || active.isError || locations.isError) && <p role="alert">Attendance could not be loaded. Ask the owner to confirm setup, then refresh.</p>}
      {account.isSuccess && !account.data?.is_active && <p>Ask the owner to link your sign-in to an existing staff profile.</p>}
      {!editable && <p>Attendance is read-only while workspace writes are unavailable.</p>}
      {shift && <div className="rounded-xl bg-teal-50 p-4 text-sm">
        <p className="font-semibold">{shift.break_started_at ? 'On break' : 'Working'} · Checked in {time(shift.checked_in_at)}</p>
        {shift.break_started_at && <p>Break started: {time(shift.break_started_at)}</p>}
        <p>Shift date: {shift.work_date}. Completed breaks: {Math.floor(shift.break_seconds / 60)} minutes.</p>
        <p className="mt-1">Finish this shift before starting another, including after midnight.</p>
      </div>}
      {account.data?.is_active && !shift && <>
        <Select label="Assigned work location" value={location} onChange={event => setLocation(event.target.value)}
          disabled={busy || !locations.isSuccess} options={[{ value: '', label: 'Choose a location' }, ...(locations.data ?? []).map(row => ({ value: row.id, label: row.name }))]} />
        <Button disabled={busy || !location || !locations.isSuccess || !!todayClosed} onClick={() => action.mutate('check_in')}>Check in</Button>
        {todayClosed && <p className="text-sm">Today's shift is closed. One shift per employee per IST day.</p>}
      </>}
      {account.data?.is_active && shift && <>
        <Button variant="outline" disabled={busy} onClick={() => action.mutate(shift.break_started_at ? 'end_break' : 'start_break')}>
          {shift.break_started_at ? 'End break' : 'Start break'}</Button>
        <label className="block text-sm font-semibold" htmlFor="attendance-summary">Daily work summary (20–2000 characters)</label>
        <textarea id="attendance-summary" rows={3} maxLength={2000} value={summary} disabled={busy}
          onChange={event => setSummary(event.target.value)} className="w-full rounded-lg border border-border bg-surface-card p-3 text-sm" />
        <Button disabled={busy || summary.trim().length < 20} onClick={() => action.mutate('check_out')}>Submit report &amp; check out</Button>
      </>}
      {action.isError && <p role="alert" className="text-sm text-rose-800">{action.error.message}</p>}
      {action.isSuccess && <p role="status" className="text-sm text-teal-800">Attendance action confirmed by the server.</p>}
      <Button variant="ghost" size="sm" disabled={action.isPending} onClick={refresh}>Refresh attendance</Button>
    </Card>
    <Card className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-semibold">{manager && team ? 'Team attendance & daily reports' : 'My attendance history'}</h2>
        <div className="w-full sm:w-44"><Input label="Attendance month" type="month" value={month} onChange={event => { setMonth(event.target.value); setPage(1); }} /></div>
        {manager && <Button variant="outline" aria-pressed={team} onClick={() => { setTeam(!team); setPage(1); }}>{team ? 'Show my attendance' : 'Show team attendance'}</Button>}
      </div>
      {history.isPending && month && <p role="status">Loading history…</p>}
      {(history.isError || (manager && team && staff.isError)) && <p role="alert">Attendance history or staff names could not be loaded. Refresh to retry.</p>}
      {totals.isError && <p role="alert">Monthly totals are unavailable. Refresh to retry.</p>}
      {totals.data && <dl className="grid grid-cols-3 gap-3 rounded-xl bg-surface-muted p-4 text-sm">
        <div><dt>Recorded shifts</dt><dd className="mt-1 text-xl font-bold">{totals.data.recorded_shifts}</dd></div>
        <div><dt>Completed shifts</dt><dd className="mt-1 text-xl font-bold">{totals.data.completed_shifts}</dd></div>
        <div><dt>Recorded work time</dt><dd className="mt-1 text-xl font-bold">{duration(totals.data.worked_minutes)}</dd></div>
      </dl>}
      {history.isSuccess && <>
        <p className="text-sm text-content-secondary">{history.data.count} recorded shift(s) this month. Unrecorded days are not automatically marked absent.</p>
        {history.data.rows.length === 0 && <p>No attendance records for this month.</p>}
        <div className="grid gap-3 md:grid-cols-2">
          {history.data.rows.map(row => <ShiftCard key={row.id} row={row}
            name={manager && team ? staff.data?.find(person => person.id === row.staff_id)?.display_name ?? 'Employee ' + row.staff_id : undefined} />)}
        </div>
        {history.data.count > 25 && <Pagination page={page} pageSize={25} totalCount={history.data.count}
          totalPages={Math.ceil(history.data.count / 25)} onPageChange={setPage} />}
      </>}
    </Card>
    {owner && <EmployeeAccountLinks orgId={orgId} userId={userId} editable={editable} />}
    <p className="text-xs text-content-secondary">Check-in and check-out use server timestamps. Completed work time excludes recorded breaks. Attendance does not automatically change pay, approve overtime or determine leave. No automatic checkout or email reminders are enabled.</p>
  </>;
}

function ShiftCard({ row, name }: { row: StaffClockSession; name?: string }) {
  return <article className="min-w-0 space-y-2 rounded-xl border border-border p-4 text-sm">
    <h3 className="font-semibold">{name ? name + ' · ' : ''}{row.work_date}</h3>
    <dl className="space-y-1">
      <div><dt className="inline font-medium">Check in: </dt><dd className="inline">{time(row.checked_in_at)}</dd></div>
      <div><dt className="inline font-medium">Check out: </dt><dd className="inline">{time(row.checked_out_at)}</dd></div>
      <div><dt className="inline font-medium">Work time: </dt><dd className="inline">{duration(row.worked_minutes)}</dd></div>
    </dl>
    <p className="whitespace-pre-wrap break-words text-content-secondary">{row.work_summary ?? (row.break_started_at ? 'On break' : 'Report pending checkout')}</p>
  </article>;
}
