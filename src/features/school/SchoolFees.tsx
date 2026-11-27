import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { formatCurrency, fromPaise } from '@/lib/money';
import { getBusinessDate } from '@/lib/dates';
import { classOptions, CommandForm, methodOptions, Pager, QueryState, SchoolPanel, useSchoolCommand, useSchoolRead, yearOptions, type SchoolScope } from './SchoolShared';
import { parseSchoolMoney, parseSchoolTax } from './school.service';
import { schoolPermissions, type SchoolAdjustment, type SchoolCharge, type SchoolPageData, type SchoolReceipt, type SchoolSchedule, type SchoolStudent } from './school.types';
import { SchoolReceiptView } from './SchoolReceipt';

export const schoolMoney = (paise: number) => formatCurrency(fromPaise(paise));
export function SchoolFees({ scope }: { scope: SchoolScope }) {
  const [year, setYear] = useState(scope.bootstrap.years[0]?.id ?? ''); const [classId, setClassId] = useState('');
  const [search, setSearch] = useState(''); const [page, setPage] = useState(1); const [student, setStudent] = useState<SchoolStudent>();
  const [receipt, setReceipt] = useState<string>();
  const schedules = useSchoolRead<SchoolPageData<SchoolSchedule>>(scope, 'schedules', { class_id: classId }, !!classId);
  const students = useSchoolRead<SchoolPageData<SchoolStudent>>(scope, 'students', { year_id: year, class_id: classId, search, offset: (page - 1) * 25 }, !!year);
  const save = useSchoolCommand(scope);
  return <div className="space-y-5">
    <SchoolPanel title="Class fee structures and instalments">
      <p className="text-sm text-content-secondary">Create a category and one schedule per instalment. Issuing a schedule creates a charge for each active enrolment in that class; reissuing adds only students not charged before.</p>
      <div className="grid gap-3 sm:grid-cols-2"><Select label="Fees academic year" value={year} options={yearOptions(scope)} onChange={event => { setYear(event.target.value); setClassId(''); setStudent(undefined); setPage(1); }} />
        <Select label="Fees class and section" value={classId} options={[{ value: '', label: 'Choose class for schedules' }, ...classOptions(scope, year)]} onChange={event => { setClassId(event.target.value); setStudent(undefined); setPage(1); }} /></div>
      <CommandForm scope={scope} action="fee_category" title="Add fee category" fields={[{ name: 'name', label: 'Fee category name', maxLength: 100 }]} />
      {classId && <>
        <CommandForm key={classId} scope={scope} action="fee_schedule" title="Add class instalment" initial={{ due_on: getBusinessDate(), tax_rate: '0' }} fields={[
          { name: 'category_id', label: 'Fee category', type: 'select', options: scope.bootstrap.fee_categories.map(row => ({ value: row.id, label: row.name })) },
          { name: 'label', label: 'Instalment label', hint: 'For example: Tuition — Term 1 or Transport — July.' },
          { name: 'due_on', label: 'Fee due date', type: 'date' }, { name: 'amount', label: 'Fee amount before configured tax (INR)', type: 'number' },
          { name: 'tax_rate', label: 'Configured tax rate (%)', type: 'number', hint: 'Confirm treatment for this fee category; no GST rate is inferred.' },
          { name: 'tax_note', label: 'Tax treatment / approval reference', maxLength: 300 },
        ]} transform={values => ({ ...values, class_id: classId, amount_paise: parseSchoolMoney(values.amount), tax_basis_points: parseSchoolTax(values.tax_rate) })} submitLabel="Save fee instalment" />
        <QueryState pending={schedules.isPending} error={schedules.error} retry={schedules.refetch} />
        {schedules.data && !schedules.isError && <div className="space-y-3">{schedules.data.rows.map(row => <article key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
          <div><h3 className="font-semibold">{row.label} · due {row.due_on}</h3><p>{schoolMoney(row.amount_paise)} before tax · {row.tax_basis_points / 100}% configured tax</p><p className="text-content-secondary">{row.tax_note}</p></div>
          <Button size="sm" disabled={!scope.editable || save.isPending} onClick={() => save.mutate({ action: 'issue_fees', data: { schedule_id: row.id } })}>Issue fees to this class</Button>
        </article>)}</div>}
        {save.isError && <p role="alert" className="text-sm text-rose-800">{save.error.message}</p>}
        {save.isSuccess && <p role="status" className="text-sm text-teal-800">Fee issue request confirmed. Previously issued charges were preserved.</p>}
      </>}
    </SchoolPanel>
    <SchoolPanel title="Student fees and collections">
      <Input label="Find student for fees" value={search} placeholder="Name, admission number or guardian phone" onChange={event => { setSearch(event.target.value); setPage(1); setStudent(undefined); }} />
      {!!year && <QueryState pending={students.isPending} error={students.error} retry={students.refetch} />}
      {students.data && !students.isError && <>
        <div className="grid gap-2 sm:grid-cols-2">{students.data.rows.map(row => <Button key={row.enrolment_id} variant={student?.enrolment_id === row.enrolment_id ? 'secondary' : 'outline'}
          onClick={() => setStudent(row)} className="!h-auto !whitespace-normal !justify-start py-3 text-left [&>span]:!whitespace-normal">{row.name} · {row.admission_no} · {row.class_name} {row.section}</Button>)}</div>
        {!students.data.rows.length && <p className="text-sm">No matching students.</p>}<Pager data={students.data} page={page} onChange={next => { setPage(next); setStudent(undefined); }} />
      </>}
    </SchoolPanel>
    {student && <StudentFees key={student.enrolment_id} scope={scope} student={student} onReceipt={setReceipt} />}
    <SchoolReceiptView scope={scope} id={receipt} onClose={() => setReceipt(undefined)} />
  </div>;
}

function StudentFees({ scope, student, onReceipt }: { scope: SchoolScope; student: SchoolStudent; onReceipt: (id: string) => void }) {
  const filter = { enrolment_id: student.enrolment_id };
  const charges = useSchoolRead<SchoolPageData<SchoolCharge>>(scope, 'charges', filter);
  const receipts = useSchoolRead<SchoolPageData<SchoolReceipt>>(scope, 'receipts', filter);
  const concessions = useSchoolRead<SchoolPageData<SchoolAdjustment>>(scope, 'concessions', filter);
  const refunds = useSchoolRead<SchoolPageData<SchoolAdjustment>>(scope, 'refunds', filter);
  const [concession, setConcession] = useState<SchoolCharge>(); const [refund, setRefund] = useState<SchoolReceipt>();
  const save = useSchoolCommand(scope); const permission = schoolPermissions(scope.bootstrap.role);
  const balance = charges.data?.rows.reduce((sum, row) => sum + row.balance_paise, 0);
  return <SchoolPanel title={`${student.name} · ${student.admission_no} · ${student.class_name} ${student.section}`}>
    <QueryState pending={charges.isPending} error={charges.error} retry={charges.refetch} />
    {charges.data && !charges.isError && <>
      <p className="text-lg font-semibold">Outstanding fees: {schoolMoney(balance ?? 0)}</p>
      {charges.data.rows.map(row => <article key={row.id} className="space-y-2 rounded-xl border border-border p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{row.label} · due {row.due_on}</h3><strong>Due {schoolMoney(row.balance_paise)}</strong></div>
        <p>Base {schoolMoney(row.base_paise)} · Tax {schoolMoney(row.tax_paise)} · Approved concessions {schoolMoney(row.concession_paise)} · Net paid {schoolMoney(row.paid_paise)}</p>
        <p className="text-content-secondary">{row.tax_note}</p>
        {row.balance_paise > 0 && <Button size="sm" variant="outline" disabled={!scope.editable} onClick={() => setConcession(row)}>Request concession / scholarship</Button>}
      </article>)}
      {!charges.data.rows.length && <p className="text-sm">No fee charges issued yet. Issue the applicable class instalments first.</p>}
      {(balance ?? 0) > 0 && <CommandForm scope={scope} action="payment" title="Record a fee payment" submitLabel="Record payment and create receipt"
        initial={{ paid_on: getBusinessDate(), method: 'cash' }} fields={[
          { name: 'amount', label: 'Fee payment amount (INR)', type: 'number' }, { name: 'paid_on', label: 'Fee payment date', type: 'date' },
          { name: 'method', label: 'Fee payment method', type: 'select', options: methodOptions }, { name: 'reference', label: 'Bank / UPI / cheque reference', required: false, maxLength: 200 },
        ]} transform={values => ({ ...values, enrolment_id: student.enrolment_id, amount_paise: parseSchoolMoney(values.amount) })}
        onSaved={result => { if (result && typeof result === 'object' && 'receipt_id' in result && typeof result.receipt_id === 'string') onReceipt(result.receipt_id); }} />}
    </>}
    <SchoolPanel title="Payment receipts">
      <p className="text-xs text-content-secondary">These are records of payments received. Atlas does not initiate bank transfers or verify UPI settlement automatically.</p>
      <QueryState pending={receipts.isPending} error={receipts.error} retry={receipts.refetch} />
      {receipts.data && !receipts.isError && receipts.data.rows.map(row => <article key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 text-sm">
        <div><h3 className="font-semibold">{row.receipt_no} · {row.paid_on}</h3><p>{schoolMoney(row.amount_paise)} · {row.method.toUpperCase()} · Adjusted {schoolMoney(row.refunded_paise ?? 0)}</p></div>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => onReceipt(row.id)}>View / print fee receipt</Button>
          {(row.refunded_paise ?? 0) < row.amount_paise && <Button size="sm" variant="outline" disabled={!scope.editable} onClick={() => setRefund(row)}>Request refund / reversal</Button>}</div>
      </article>)}
    </SchoolPanel>
    <SchoolPanel title="Concession and refund approvals">
      <p className="text-xs text-content-secondary">Only the principal or owner can approve. Approval records the adjustment and updates dues; transfer any actual refund through the selected payment method separately.</p>
      {(concessions.isPending || refunds.isPending) && <p role="status">Loading fee adjustments…</p>}
      {(concessions.isError || refunds.isError) && <p role="alert" className="text-sm text-rose-800">Fee adjustments could not be loaded.</p>}
      {[
        ...(concessions.data?.rows ?? []).map(row => ({ ...row, type: 'concession' })),
        ...(refunds.data?.rows ?? []).map(row => ({ ...row, type: 'refund' })),
      ].map(row => <article key={row.id} className="space-y-2 border-t border-border py-3 text-sm"><h3 className="font-semibold">{row.kind ?? row.type} · {schoolMoney(row.amount_paise)} · {row.status}</h3>
        <p className="whitespace-pre-wrap break-words">{row.reason}</p>
        {permission.approve && row.status === 'pending' && <div className="flex gap-2">{['approved', 'rejected'].map(decision => <Button key={decision} size="sm" variant={decision === 'approved' ? 'primary' : 'outline'}
          disabled={!scope.editable || save.isPending} onClick={() => save.mutate({ action: row.type === 'concession' ? 'concession_review' : 'refund_review', data: { id: row.id, decision } })}>{decision === 'approved' ? 'Approve' : 'Reject'} {row.type}</Button>)}</div>}
      </article>)}
      {save.isError && <p role="alert" className="text-sm text-rose-800">{save.error.message}</p>}
    </SchoolPanel>
    <Modal isOpen={!!concession} onClose={() => setConcession(undefined)} title="Request fee concession">
      {concession && <CommandForm key={concession.id} scope={scope} action="concession_request" title={concession.label} submitLabel="Submit concession for approval"
        fields={[{ name: 'amount', label: 'Concession amount (INR)', type: 'number' }, { name: 'reason', label: 'Scholarship / concession reason', type: 'textarea' }]}
        transform={values => ({ ...values, charge_id: concession.id, amount_paise: parseSchoolMoney(values.amount) })} onSaved={() => setConcession(undefined)} />}
    </Modal>
    <Modal isOpen={!!refund} onClose={() => setRefund(undefined)} title="Request receipt adjustment" maxWidth="2xl">
      {refund && <CommandForm key={refund.id} scope={scope} action="refund_request" title={refund.receipt_no} submitLabel="Submit refund or reversal for approval"
        initial={{ refunded_on: getBusinessDate(), method: 'cash', kind: 'refund' }} fields={[
          { name: 'kind', label: 'Receipt adjustment type', type: 'select', options: [{ value: 'refund', label: 'Partial refund' }, { value: 'reversal', label: 'Reverse remaining receipt amount' }] },
          { name: 'amount', label: 'Refund / reversal amount (INR)', type: 'number', hint: `Available to adjust: ${schoolMoney(refund.amount_paise - (refund.refunded_paise ?? 0))}` },
          { name: 'refunded_on', label: 'Adjustment date', type: 'date' }, { name: 'method', label: 'Refund method', type: 'select', options: methodOptions },
          { name: 'reference', label: 'Refund reference', required: false, maxLength: 200 }, { name: 'reason', label: 'Reason for refund / reversal', type: 'textarea' },
        ]} transform={values => ({ ...values, receipt_id: refund.id, amount_paise: parseSchoolMoney(values.amount) })} onSaved={() => setRefund(undefined)} />}
    </Modal>
  </SchoolPanel>;
}
