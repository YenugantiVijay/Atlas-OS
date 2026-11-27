import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { getBusinessDate } from '@/lib/dates';
import { classOptions, Pager, QueryState, SchoolPanel, useSchoolCommand, useSchoolRead, yearOptions, type SchoolScope } from './SchoolShared';
import { downloadSchoolCsv, schoolService } from './school.service';
import type { SchoolAttendance as AttendanceRow, SchoolAttendanceHistory, SchoolPageData, StudentAttendanceStatus } from './school.types';

const statuses: Array<{ value: string; label: string }> = [
  { value: '', label: 'Unmarked' }, { value: 'present', label: 'Present' }, { value: 'absent', label: 'Absent' },
  { value: 'late', label: 'Late' }, { value: 'half_day', label: 'Half day' }, { value: 'leave', label: 'Approved leave' },
];
interface AttendanceReport { enrolment_id: string; name: string; admission_no: string; recorded_days: number; present: number; absent: number; late: number; half_day: number; leave: number }
export function SchoolAttendance({ scope }: { scope: SchoolScope }) {
  const [year, setYear] = useState(scope.bootstrap.years[0]?.id ?? ''); const [classId, setClassId] = useState('');
  const [date, setDate] = useState(getBusinessDate()); const [page, setPage] = useState(1); const [report, setReport] = useState(false);
  const [month, setMonth] = useState(getBusinessDate().slice(0, 7)); const [history, setHistory] = useState<AttendanceRow>();
  const [draft, setDraft] = useState<Record<string, { status: string; reason: string }>>({}); const [exportError, setExportError] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [exporting, setExporting] = useState(false); const save = useSchoolCommand(scope);
  const first = month + '-01'; const next = /^\d{4}-\d{2}$/.test(month) ? new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10) : first;
  const filter = { class_id: classId, from: report ? first : date, to: report ? next : date, offset: (page - 1) * 25 };
  const roster = useSchoolRead<SchoolPageData<AttendanceRow>>(scope, 'attendance', filter, !!classId && !!date && !report);
  const totals = useSchoolRead<SchoolPageData<AttendanceReport>>(scope, 'attendance_report', filter, !!classId && !!month && report);
  const historyQuery = useSchoolRead<SchoolPageData<SchoolAttendanceHistory>>(scope, 'attendance_history', { class_id: classId, enrolment_id: history?.enrolment_id, from: date, offset: (historyPage - 1) * 25 }, !!history);
  const changed = (roster.data?.rows ?? []).flatMap(row => {
    const edit = draft[row.enrolment_id];
    return edit?.status && (edit.status !== row.status || edit.reason.trim()) ? [{ enrolment_id: row.enrolment_id, status: edit.status as StudentAttendanceStatus, reason: edit.reason, revision: row.revision ?? 0 }] : [];
  });
  const invalidCorrections = changed.some(row => row.revision > 0 && row.reason.trim().length < 3);
  const reset = () => { setDraft({}); setPage(1); setHistory(undefined); save.reset(); };
  return <div className="space-y-5"><SchoolPanel title={report ? 'Monthly student attendance' : 'Daily student register'}>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Select label="Attendance academic year" value={year} options={yearOptions(scope)} onChange={event => { setYear(event.target.value); setClassId(''); reset(); }} />
      <Select label="Attendance class and section" value={classId} options={[{ value: '', label: 'Choose assigned class' }, ...classOptions(scope, year)]}
        onChange={event => { setClassId(event.target.value); reset(); }} />
      {report ? <Input label="Student attendance month" type="month" value={month} onChange={event => { setMonth(event.target.value); reset(); }} />
        : <Input label="Student attendance date (IST)" type="date" value={date} max={getBusinessDate()} onChange={event => { setDate(event.target.value); reset(); }} />}
      <Button variant="outline" onClick={() => { setReport(!report); reset(); }}>{report ? 'Open daily register' : 'Open monthly attendance'}</Button>
    </div>
    <p className="text-sm text-content-secondary">Choose and save explicit statuses. Unmarked days are not automatically absent. Corrections retain prior entries and require a reason.</p>
    {!!classId && !report && <>
      <QueryState pending={roster.isPending} error={roster.error} retry={roster.refetch} />
      {roster.data && !roster.isError && <>
        <p className="text-sm">{roster.data.count} eligible student(s). Save applies only to changed rows on this page.</p>
        <Button size="sm" variant="outline" disabled={!scope.editable || save.isPending || date > getBusinessDate()} onClick={() => setDraft(Object.fromEntries(roster.data.rows.map(row => [row.enrolment_id, { status: 'present', reason: draft[row.enrolment_id]?.reason ?? '' }]))) }>
          Select Present for this page</Button>
        {roster.data.rows.map(row => <section key={row.enrolment_id} aria-label={'Student attendance for ' + row.name} className="space-y-2 border-t border-border pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-sm"><h3 className="font-semibold">{row.name} · {row.admission_no}</h3>
            <p className="text-content-secondary">Saved: {statuses.find(option => option.value === row.status)?.label ?? 'Unmarked'}{row.revision ? ` · revision ${row.revision}` : ''}</p></div>
            {row.revision && <Button size="sm" variant="ghost" onClick={() => { setHistoryPage(1); setHistory(row); }}>View attendance changes</Button>}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label={'Status for ' + row.name} value={draft[row.enrolment_id]?.status ?? row.status ?? ''} options={statuses}
              disabled={!scope.editable || save.isPending || date > getBusinessDate()} onChange={event => setDraft(current => ({ ...current, [row.enrolment_id]: { status: event.target.value, reason: current[row.enrolment_id]?.reason ?? '' } }))} />
            <Input label={'Attendance note / correction reason for ' + row.name} value={draft[row.enrolment_id]?.reason ?? ''} maxLength={1000}
              disabled={!scope.editable || save.isPending} onChange={event => setDraft(current => ({ ...current, [row.enrolment_id]: { status: current[row.enrolment_id]?.status ?? row.status ?? '', reason: event.target.value } }))} />
          </div>
        </section>)}
        {!roster.data.rows.length && <p className="text-sm">No eligible students for this class and date.</p>}
        <div className="flex flex-wrap gap-2"><Button disabled={!scope.editable || save.isPending || save.isError || !changed.length || invalidCorrections || date > getBusinessDate()}
          onClick={() => save.mutate({ action: 'attendance', data: { class_id: classId, day: date, rows: changed } }, { onSuccess: () => setDraft({}) })}>Save selected attendance</Button>
          <Button variant="outline" disabled={save.isPending} onClick={() => { setDraft({}); save.reset(); void roster.refetch(); }}>Reload and discard changes</Button></div>
        {invalidCorrections && <p role="alert" className="text-sm text-rose-800">Enter a correction reason of at least three characters for every previously recorded student.</p>}
        {save.isError && <p role="alert" className="text-sm text-rose-800">{save.error.message} Reload the register before another attempt.</p>}
        {save.isSuccess && <p role="status" className="text-sm text-teal-800">Student attendance confirmed by the server.</p>}
        <Pager data={roster.data} page={page} onChange={nextPage => { setPage(nextPage); setDraft({}); save.reset(); }} />
      </>}
    </>}
    {!!classId && report && <>
      <QueryState pending={totals.isPending} error={totals.error} retry={totals.refetch} />
      {totals.data && !totals.isError && <>
        <Button variant="outline" disabled={exporting} onClick={async () => {
          setExportError(''); setExporting(true);
          try { const all = await schoolService.page<AttendanceReport>(scope.orgId, 'attendance_report', { ...filter, export: true });
            downloadSchoolCsv('School-Attendance-' + month + '.csv', ['Admission number', 'Name', 'Recorded days', 'Present', 'Absent', 'Late', 'Half day', 'Leave'],
              all.rows.map(row => [row.admission_no, row.name, row.recorded_days, row.present, row.absent, row.late, row.half_day, row.leave]));
          } catch (error) { setExportError(error instanceof Error ? error.message : 'Attendance export failed.'); }
          finally { setExporting(false); }
        }}>Export monthly attendance CSV</Button>
        <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[40rem] text-left text-sm"><thead><tr>{['Student', 'Recorded days', 'Present', 'Absent', 'Late', 'Half day', 'Leave'].map(label => <th className="p-3" key={label}>{label}</th>)}</tr></thead>
          <tbody>{totals.data.rows.map(row => <tr key={row.enrolment_id} className="border-t border-border"><td className="p-3">{row.name} · {row.admission_no}</td>{[row.recorded_days, row.present, row.absent, row.late, row.half_day, row.leave].map((value, index) => <td key={index} className="p-3">{value}</td>)}</tr>)}</tbody></table></div>
        <Pager data={totals.data} page={page} onChange={setPage} />
      </>}
      {exportError && <p role="alert" className="text-sm text-rose-800">{exportError}</p>}
    </>}
  </SchoolPanel>
    <Modal isOpen={!!history} onClose={() => setHistory(undefined)} title={'Attendance history · ' + (history?.name ?? '')}>
      <QueryState pending={historyQuery.isPending} error={historyQuery.error} retry={historyQuery.refetch} />
      {historyQuery.data?.rows.map(row => <article key={row.revision} className="mb-3 space-y-1 border-b border-border pb-3 text-sm"><h3 className="font-semibold">Revision {row.revision} · {row.status.replace(/_/g, ' ')}</h3>
        <p className="whitespace-pre-wrap break-words">{row.reason || 'Initial entry'}</p><p className="text-content-secondary">{new Date(row.recorded_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p></article>)}
      {historyQuery.data && !historyQuery.isError && <Pager data={historyQuery.data} page={historyPage} onChange={setHistoryPage} />}
    </Modal>
  </div>;
}
