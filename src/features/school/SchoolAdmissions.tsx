import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { getBusinessDate } from '@/lib/dates';
import { classOptions, CommandForm, Pager, QueryState, SchoolPanel, useSchoolCommand, useSchoolRead, type SchoolScope } from './SchoolShared';
import type { SchoolAdmission, SchoolPageData } from './school.types';

const nextStage: Record<string, string> = { enquiry: 'application', application: 'review', review: 'approved' };
export function SchoolAdmissions({ scope }: { scope: SchoolScope }) {
  const [search, setSearch] = useState(''); const [page, setPage] = useState(1); const [newEnquiry, setNewEnquiry] = useState(false);
  const [admit, setAdmit] = useState<SchoolAdmission>(); const save = useSchoolCommand(scope);
  const enquiries = useSchoolRead<SchoolPageData<SchoolAdmission>>(scope, 'admissions', { search, offset: (page - 1) * 25 });
  return <div className="space-y-5">
    <SchoolPanel title="Admissions pipeline">
      <p className="text-sm text-content-secondary">Enquiry → Application → Review → Approved → Admitted. Admission creates the student and class enrolment together.</p>
      <div className="flex flex-wrap items-end gap-3"><div className="grow"><Input label="Search admissions" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Applicant or phone; check for existing enquiries" /></div>
        <Button disabled={!scope.editable} onClick={() => setNewEnquiry(true)}>New admission enquiry</Button></div>
      <QueryState pending={enquiries.isPending} error={enquiries.error} retry={enquiries.refetch} />
      {save.isError && <p role="alert" className="text-sm text-rose-800">{save.error.message}</p>}
      {enquiries.data && !enquiries.isError && <>
        {!enquiries.data.rows.length && <p className="text-sm">No matching enquiries.</p>}
        <div className="grid gap-3 lg:grid-cols-2">{enquiries.data.rows.map(row => <article key={row.id} className="space-y-2 rounded-xl border border-border p-4 text-sm">
          <h3 className="font-semibold">{row.applicant}</h3><p>{row.guardian_name} · {row.phone}</p><p>{row.desired_class || 'Class not specified'} · <strong>{row.status}</strong></p>
          {row.note && <p className="whitespace-pre-wrap break-words text-content-secondary">{row.note}</p>}
          <div className="flex flex-wrap gap-2">
            {nextStage[row.status] && <Button size="sm" disabled={!scope.editable || save.isPending} onClick={() => save.mutate({ action: 'admission_stage', data: { id: row.id, revision: row.revision, status: nextStage[row.status] } })}>
              {nextStage[row.status] === 'approved' ? 'Approve application' : 'Move to ' + nextStage[row.status]}</Button>}
            {row.status === 'approved' && <Button size="sm" disabled={!scope.editable} onClick={() => setAdmit(row)}>Admit and assign class</Button>}
            {['enquiry', 'application', 'review'].includes(row.status) && <Button size="sm" variant="outline" disabled={!scope.editable || save.isPending}
              onClick={() => save.mutate({ action: 'admission_stage', data: { id: row.id, revision: row.revision, status: 'rejected' } })}>Reject application</Button>}
          </div>
        </article>)}</div><Pager data={enquiries.data} page={page} onChange={setPage} />
      </>}
    </SchoolPanel>
    <Modal isOpen={newEnquiry} onClose={() => setNewEnquiry(false)} title="New admission enquiry" maxWidth="2xl">
      <CommandForm scope={scope} action="admission" title="Applicant and guardian" submitLabel="Save enquiry" onSaved={() => setNewEnquiry(false)} fields={[
        { name: 'applicant', label: 'Applicant full name' }, { name: 'guardian_name', label: 'Applicant guardian name' }, { name: 'phone', label: 'Applicant guardian phone', maxLength: 30 },
        { name: 'desired_class', label: 'Desired class', required: false }, { name: 'note', label: 'Admission notes', type: 'textarea', required: false },
      ]} />
    </Modal>
    <Modal isOpen={!!admit} onClose={() => setAdmit(undefined)} title="Complete school admission" maxWidth="2xl">
      {admit && <CommandForm key={admit.id} scope={scope} action="admit" title={'Admit ' + admit.applicant} submitLabel="Confirm admission and enrolment"
        initial={{ joining_on: getBusinessDate() }} onSaved={() => setAdmit(undefined)} transform={values => ({ ...values, id: admit.id, revision: admit.revision })} fields={[
          { name: 'admission_no', label: 'New admission number', maxLength: 40 }, { name: 'class_id', label: 'Admission class and section', type: 'select', options: classOptions(scope) },
          { name: 'joining_on', label: 'Admission joining date', type: 'date' }, { name: 'dob', label: 'Applicant date of birth', type: 'date', required: false },
          { name: 'guardian_email', label: 'Applicant guardian email', type: 'email', required: false }, { name: 'address', label: 'Applicant address', type: 'textarea', required: false },
          { name: 'previous_school', label: 'Previous school', required: false },
        ]} />}
    </Modal>
  </div>;
}
