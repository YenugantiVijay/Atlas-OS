import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { Select } from '@/components/ui/Select';
import { useOrg } from '@/features/organizations/OrgContext';
import { useAttendanceAccess } from '@/hooks/useAttendanceAccess';
import { DEFAULT_BUSINESS_TIMEZONE, getBusinessDate } from '@/lib/dates';
import {
  AttendanceConflictError, attendanceStatuses, staffAttendanceService, type AttendanceEmployee, type AttendanceEntry,
  type AttendanceStatus,
} from '@/services/staff-attendance.service';
import { staffPageSize, staffPayService, type StaffLocation } from '@/services/staff-pay.service';
import { AttendanceManagers } from './AttendanceManagers';

const timestampFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: DEFAULT_BUSINESS_TIMEZONE,
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function StaffAttendancePage() {
  const { currentOrg, currentUser, currentRole, isDemoMode, isAuthenticated, canWriteOperations } = useOrg();
  const access = useAttendanceAccess();
  const sessionReady = !isDemoMode && isAuthenticated && currentOrg && currentUser && currentRole;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-content-primary">Staff Attendance</h1>
        <p className="mt-1 text-sm text-content-secondary">Choose a date, assign work locations, and record attendance.</p>
      </header>
      {!sessionReady ? <Card><p className="text-sm">Sign in to a cloud workspace to use attendance.</p></Card>
        : access.isPending ? <p role="status" className="text-sm">Checking attendance access…</p>
          : access.isError ? <Card className="flex flex-wrap items-center gap-3 text-sm">
            <p role="alert">Attendance access could not be verified.</p>
            <Button variant="outline" size="sm" onClick={() => void access.refetch()}>Retry</Button>
          </Card>
            : access.data ? <AttendanceWorkspace key={currentOrg.id + ':' + currentUser.id}
              orgId={currentOrg.id} userId={currentUser.id} editable={canWriteOperations} owner={currentRole === 'owner'} />
              : <Card><p className="text-sm">Ask the workspace owner for attendance access.</p></Card>}
    </div>
  );
}

function AttendanceWorkspace({ orgId, userId, editable, owner }: {
  orgId: string; userId: string; editable: boolean; owner: boolean;
}) {
  const today = getBusinessDate();
  const [date, setDate] = useState(today);
  const [page, setPage] = useState(1);
  const scope = ['staff-attendance', orgId, userId] as const;
  const day = useQuery({
    queryKey: [...scope, 'day', date, page],
    queryFn: () => staffAttendanceService.listDay(orgId, date, page),
    enabled: !!date,
  });
  const locations = useQuery({
    queryKey: [...scope, 'locations'],
    queryFn: () => staffPayService.listLocations(orgId),
  });
  const byStaff = new Map(day.data?.entries.map(entry => [entry.staff_id, entry]));

  return <>
    <Card className="flex flex-wrap items-end justify-between gap-3">
      <Input label="Attendance date (IST)" type="date" value={date} required onChange={event => {
        setDate(event.target.value);
        setPage(1);
      }} />
      {owner && <Link to="/team/staff" className="inline-flex min-h-10 items-center text-sm font-semibold text-teal-800 hover:underline">
        Staff &amp; Pay Setup
      </Link>}
    </Card>
    {!editable && <p role="status" className="text-sm text-content-secondary">Attendance is read-only while workspace writes are unavailable.</p>}
    {date > today && <p className="text-sm text-content-secondary">You can schedule future dates and mark attendance when the date arrives.</p>}
    {(day.isError || locations.isError) && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-rose-800">
      Attendance could not be loaded.
      <Button size="sm" variant="outline" onClick={() => {
        if (date) void day.refetch();
        void locations.refetch();
      }}>Retry</Button>
    </div>}
    {!!date && (day.isPending || locations.isPending) && <p role="status" className="text-sm">Loading attendance…</p>}
    {day.isSuccess && locations.isSuccess && <Card className="space-y-3">
      <h2 className="text-base font-semibold">Daily roster</h2>
      {day.data.staff.length === 0 && <p className="text-sm text-content-secondary">
        No employees with a joining date on or before the selected date.
      </p>}
      {day.data.staff.map(employee => {
        const entry = byStaff.get(employee.id);
        return <AttendanceRow key={date + ':' + employee.id + ':' + (entry?.revision ?? 0)}
          orgId={orgId} date={date} future={date > today} employee={employee} entry={entry}
          editable={editable} locations={locations.data} scope={scope} />;
      })}
      {day.data.count > staffPageSize && <Pagination page={page} pageSize={staffPageSize} totalCount={day.data.count}
        totalPages={Math.ceil(day.data.count / staffPageSize)} onPageChange={setPage} />}
    </Card>}
    {owner && <AttendanceManagers orgId={orgId} userId={userId} />}
  </>;
}

function AttendanceRow({ orgId, date, future, employee, entry, editable, locations, scope }: {
  orgId: string; date: string; future: boolean; employee: AttendanceEmployee; entry?: AttendanceEntry;
  editable: boolean; locations: StaffLocation[]; scope: readonly string[];
}) {
  const [status, setStatus] = useState<AttendanceStatus>(entry?.status ?? (future ? 'scheduled' : 'present'));
  const [location, setLocation] = useState(entry?.location_id ?? '');
  const [showHistory, setShowHistory] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(10);
  const queryClient = useQueryClient();
  const requiresLocation = status !== 'absent' && status !== 'leave';
  const history = useQuery({
    queryKey: [...scope, 'history', date, employee.id, historyLimit],
    queryFn: () => staffAttendanceService.listHistory(orgId, employee.id, date, historyLimit + 1),
    enabled: showHistory,
  });
  const save = useMutation({
    mutationFn: () => staffAttendanceService.save(orgId, employee, date, {
      revision: (entry?.revision ?? 0) + 1, location: location || null, status,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: scope }),
  });
  const conflicted = save.error instanceof AttendanceConflictError;
  const locationName = (id: string | null) => locations.find(item => item.id === id)?.name ?? 'No work location';
  const canSave = editable && !save.isPending && !conflicted && (!requiresLocation || !!location)
    && (!entry || entry.status !== status || (entry.location_id ?? '') !== location);

  return (
    <section aria-label={'Attendance for ' + employee.display_name} className="space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{employee.display_name}</h3>
          <p className="text-xs text-content-secondary">{entry
            ? attendanceStatuses[entry.status] + ' · ' + locationName(entry.location_id) : 'Not recorded'}</p>
        </div>
        {entry && <Button type="button" variant="ghost" size="sm" aria-expanded={showHistory}
          onClick={() => setShowHistory(!showHistory)}>{showHistory ? 'Hide history' : 'History'}</Button>}
      </div>
      <form className="grid min-w-0 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" onSubmit={event => {
        event.preventDefault();
        if (canSave) save.mutate();
      }}>
        <Select label="Status" value={status} disabled={!editable || save.isPending}
          onChange={event => setStatus(event.target.value as AttendanceStatus)}
          options={(Object.keys(attendanceStatuses) as AttendanceStatus[]).filter(option => !future || option === 'scheduled')
            .map(option => ({ value: option, label: attendanceStatuses[option] }))} />
        <Select label="Work location" value={location} disabled={!editable || save.isPending}
          onChange={event => setLocation(event.target.value)} required={requiresLocation} options={[
            { value: '', label: requiresLocation ? 'Choose a location' : 'No location' },
            ...locations.map(item => ({ value: item.id, label: item.name })),
          ]} />
        <Button type="submit" disabled={!canSave} isLoading={save.isPending}>Save</Button>
      </form>
      {save.isError && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-rose-800">
        {save.error.message}
        {conflicted && <Button size="sm" variant="outline" onClick={() => void queryClient.invalidateQueries({ queryKey: scope })}>
          Reload day
        </Button>}
      </div>}
      {showHistory && <div className="space-y-2 rounded-lg bg-surface-muted p-3 text-xs">
        {history.isPending && <p role="status">Loading history…</p>}
        {history.isError && <div role="alert" className="flex flex-wrap items-center gap-2">
          Could not load history. <Button size="sm" variant="outline" onClick={() => void history.refetch()}>Retry</Button>
        </div>}
        {history.data && <ol className="space-y-2">
          {history.data.slice(0, historyLimit).map(change => <li key={change.revision}>
            {attendanceStatuses[change.status]} · {locationName(change.location_id)} · {timestampFormat.format(new Date(change.recorded_at))}
          </li>)}
        </ol>}
        {(history.data?.length ?? 0) > historyLimit && <Button type="button" size="sm" variant="ghost"
          onClick={() => setHistoryLimit(historyLimit + 10)}>Show older changes</Button>}
      </div>}
    </section>
  );
}
