import { portalEntry } from '@/lib/portal-entry';
import { StudentPortalLinks } from '@/features/portals/StudentPortalLinks';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { getBusinessDate } from '@/lib/dates';
import { classOptions, CommandForm, Pager, QueryState, SchoolPanel, useSchoolCommand, useSchoolRead, yearOptions, type SchoolField, type SchoolScope } from './SchoolShared';
import { downloadSchoolCsv, schoolService } from './school.service';
import { previewSchoolImport, schoolImportHeaders, type SchoolImportRow } from './school-import';
import { schoolPermissions, type SchoolPageData, type SchoolStudent } from './school.types';

export const studentFields = (scope: SchoolScope, yearId?: string): SchoolField[] => [
  { name: 'admission_no', label: 'Admission number', maxLength: 40 }, { name: 'name', label: 'Student full name' },
  { name: 'dob', label: 'Date of birth', type: 'date', required: false }, { name: 'joining_on', label: 'Joining date', type: 'date' },
  { name: 'class_id', label: 'Student class and section', type: 'select', options: classOptions(scope, yearId) },
  { name: 'guardian_name', label: 'Guardian name' }, { name: 'guardian_phone', label: 'Guardian phone', maxLength: 30 },
  { name: 'guardian_email', label: 'Guardian email', type: 'email', required: false },
  { name: 'address', label: 'Student address', type: 'textarea', required: false }, { name: 'previous_school', label: 'Previous school', required: false },
];

export function SchoolStudents({ scope }: { scope: SchoolScope }) {
  const [year, setYear] = useState(scope.bootstrap.years[0]?.id ?? '');
  const [classId, setClassId] = useState(''); const [search, setSearch] = useState(''); const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<'add' | 'import' | null>(null); const [student, setStudent] = useState<SchoolStudent>(); const [saved, setSaved] = useState('');
  const canEdit = schoolPermissions(scope.bootstrap.role).admissions && !['teacher','school_accounts'].includes(portalEntry());
  const directory = useSchoolRead<SchoolPageData<SchoolStudent>>(scope, 'students', { year_id: year, class_id: classId, search, offset: (page - 1) * 25 }, !!year);
  return <div className="space-y-5">
    <SchoolPanel title="Student directory">
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Student academic year" value={year} onChange={event => { setYear(event.target.value); setClassId(''); setPage(1); }} options={yearOptions(scope)} />
        <Select label="Filter student class" value={classId} onChange={event => { setClassId(event.target.value); setPage(1); }}
          options={[{ value: '', label: 'All authorized classes' }, ...classOptions(scope, year)]} />
        <Input label="Search students" value={search} placeholder="Name, admission number or phone" onChange={event => { setSearch(event.target.value); setPage(1); }} />
      </div>
      {canEdit && <div className="flex flex-wrap gap-2"><Button disabled={!scope.editable || !year} onClick={() => setDialog('add')}>Add student</Button>
        <Button variant="outline" disabled={!scope.editable || !year} onClick={() => setDialog('import')}>Import student CSV</Button></div>}
      {saved && <p role="status" className="text-sm text-teal-800">{saved}</p>}
      {!year && <p className="text-sm">Set up an academic year and classes before adding students.</p>}
      {year && <QueryState pending={directory.isPending} error={directory.error} retry={directory.refetch} />}
      {directory.data && !directory.isError && <>
        <p className="text-sm text-content-secondary">{directory.data.count} enrolment(s) in the selected year.</p>
        {!directory.data.rows.length && <p className="text-sm">No matching students. Import or add a student to get started.</p>}
        <div className="grid gap-3 lg:grid-cols-2">{directory.data.rows.map(row => <article key={row.enrolment_id} className="min-w-0 space-y-2 rounded-xl border border-border p-4 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold">{row.name}</h3><p>{row.admission_no} · {row.class_name} {row.section}</p></div>
            <Button size="sm" variant="outline" onClick={() => setStudent(row)}>Open student</Button></div>
          <p className="break-words text-content-secondary">Guardian: {row.guardian_name} · {row.guardian_phone}</p>
        </article>)}</div>
        <Pager data={directory.data} page={page} onChange={setPage} />
      </>}
    </SchoolPanel>
    <Modal isOpen={dialog === 'add'} onClose={() => setDialog(null)} title="Add student" maxWidth="2xl">
      <CommandForm scope={scope} title="Student and guardian details" action="student" initial={{ joining_on: getBusinessDate(), class_id: classId }} fields={studentFields(scope, year)}
        onSaved={() => { setDialog(null); setSaved('Student and class enrolment saved.'); }} submitLabel="Save student and enrolment" />
    </Modal>
    <Modal isOpen={dialog === 'import'} onClose={() => setDialog(null)} title="Preview student import" maxWidth="3xl">
      {dialog === 'import' && <SchoolImport scope={scope} yearId={year} onSaved={() => { setDialog(null); setSaved('Student import confirmed by the server.'); }} />}
    </Modal>
    <Modal isOpen={!!student} onClose={() => setStudent(undefined)} title="Student profile" maxWidth="2xl">
      {student && <StudentProfile key={student.enrolment_id} scope={scope} student={student} editable={canEdit} onSaved={() => { setStudent(undefined); setSaved('Student profile or enrolment updated.'); }} />}
    </Modal>
  </div>;
}

function StudentProfile({ scope, student, editable, onSaved }: { scope: SchoolScope; student: SchoolStudent; editable: boolean; onSaved: () => void }) {
  return <div className="space-y-4">
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      <div><dt className="font-semibold">Student</dt><dd>{student.name} · {student.admission_no}</dd></div>
      <div><dt className="font-semibold">Current enrolment</dt><dd>{student.class_name} {student.section} · {student.year_name}</dd></div>
      <div><dt className="font-semibold">Joined</dt><dd>{student.joining_on}</dd></div>
      {student.dob && <div><dt className="font-semibold">Date of birth</dt><dd>{student.dob}</dd></div>}
      <div><dt className="font-semibold">Guardian</dt><dd>{student.guardian_name} · {student.guardian_phone}</dd></div>
      <div><dt className="font-semibold">Guardian email</dt><dd className="break-words">{student.guardian_email || 'Not recorded'}</dd></div>
    </dl>
    {scope.bootstrap.role === 'owner' && !['teacher','school_accounts'].includes(portalEntry()) && <StudentPortalLinks scope={scope} studentId={student.id} />}
    {editable && <>
      <CommandForm scope={scope} title="Update student contact details" action="student_update"
        initial={{ name: student.name, guardian_name: student.guardian_name, guardian_phone: student.guardian_phone, guardian_email: student.guardian_email, address: student.address ?? '', previous_school: student.previous_school ?? '' }}
        fields={[{ name: 'name', label: 'Student full name' }, { name: 'guardian_name', label: 'Guardian name' }, { name: 'guardian_phone', label: 'Guardian phone', maxLength: 30 },
          { name: 'guardian_email', label: 'Guardian email', type: 'email', required: false }, { name: 'address', label: 'Student address', type: 'textarea', required: false },
          { name: 'previous_school', label: 'Previous school', required: false }, { name: 'reason', label: 'Reason for profile correction', type: 'textarea' }]}
        transform={values => ({ ...values, id: student.id, revision: student.revision })} onSaved={onSaved} />
      <CommandForm scope={scope} title="Enrol in another academic year" action="enrol" fields={[
        { name: 'class_id', label: 'New academic year class', type: 'select', options: classOptions(scope).filter(row => scope.bootstrap.classes.find(cls => cls.id === row.value)?.year_id !== student.year_id) },
      ]} transform={values => ({ ...values, student_id: student.id })} submitLabel="Create next-year enrolment" onSaved={onSaved} />
      <p className="text-xs text-content-secondary">A new year creates a separate enrolment. Previous attendance, charges and receipt snapshots remain intact.</p>
    </>}
  </div>;
}

function SchoolImport({ scope, yearId, onSaved }: { scope: SchoolScope; yearId: string; onSaved: () => void }) {
  const [classId, setClassId] = useState(''); const [text, setText] = useState(''); const [error, setError] = useState('');
  const [preview, setPreview] = useState<{ rows: SchoolImportRow[]; errors: string[] }>(); const [checking, setChecking] = useState(false);
  const save = useSchoolCommand(scope);
  return <div className="space-y-4">
    <p className="text-sm">Use the CSV template. Import up to 200 students into one selected class; preview and correct errors before confirming.</p>
    <Button variant="outline" onClick={() => downloadSchoolCsv('Atlas-Student-Import-Template.csv', schoolImportHeaders, [])}>Download student template</Button>
    <Select label="Import class and section" value={classId} onChange={event => { setClassId(event.target.value); setPreview(undefined); }}
      options={[{ value: '', label: 'Choose class' }, ...classOptions(scope, yearId)]} disabled={save.isPending || checking} />
    <label className="block text-sm font-medium">Student CSV file<input className="mt-2 block w-full text-sm" type="file" accept=".csv,text/csv" disabled={save.isPending || checking}
      onChange={async event => { setPreview(undefined); setError(''); const file = event.target.files?.[0]; if (!file) { setText(''); return; }
        if (file.size > 250000) { setText(''); setError('Use a CSV file smaller than 250 KB.'); return; }
        try { setText(await file.text()); } catch { setError('The CSV file could not be read.'); }
      }} /></label>
    <Button disabled={!text || !classId || checking || save.isPending} variant="outline" onClick={async () => {
      setError(''); setChecking(true); setPreview(undefined);
      try {
        const parsed = previewSchoolImport(text, classId, getBusinessDate());
        if (!parsed.errors.length) {
          const duplicates = await schoolService.read<string[]>(scope.orgId, 'import_duplicates', { admission_nos: parsed.rows.map(row => row.admission_no) });
          setPreview(previewSchoolImport(text, classId, getBusinessDate(), duplicates));
        } else setPreview(parsed);
      } catch (failure) { setError(failure instanceof Error ? failure.message : 'Import preview failed.'); }
      finally { setChecking(false); }
    }}>Preview and check duplicates</Button>
    {checking && <p role="status">Checking student identifiers…</p>}
    {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
    {preview && <SchoolPanel title={`${preview.rows.length} student rows in preview`}>
      {preview.errors.length ? <ul role="alert" className="list-disc space-y-1 pl-4 text-sm text-rose-800">{preview.errors.map((message, index) => <li key={index}>{message}</li>)}</ul>
        : <p className="text-sm text-teal-800">Preview checks passed. The server will validate all rows again and save the batch atomically.</p>}
      <ol className="max-h-64 space-y-1 overflow-auto text-sm">{preview.rows.map((row, index) => <li key={index}>{row.admission_no} · {row.name} · {row.guardian_name} · {row.guardian_phone}</li>)}</ol>
      <Button disabled={!scope.editable || save.isPending || !!preview.errors.length} onClick={() => save.mutate({ action: 'students_import', data: { rows: preview.rows } }, { onSuccess: onSaved })}>Confirm student import</Button>
      {save.isError && <p role="alert" className="text-sm text-rose-800">{save.error.message}</p>}
    </SchoolPanel>}
  </div>;
}
