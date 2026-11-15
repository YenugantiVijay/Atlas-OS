import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Pagination } from '@/components/ui/Pagination';
import { Select } from '@/components/ui/Select';
import { useOrg } from '@/features/organizations/OrgContext';
import { useActionPermission } from '@/hooks/useActionPermission';
import { formatDisplayDate } from '@/lib/dates';
import { formatCurrency, fromPaise } from '@/lib/money';
import { staffPageSize, staffPayService, type StaffProfile } from '@/services/staff-pay.service';
import { advancePageSize, staffAdvanceService, staffPaymentMethods, type StaffAdvance, type StaffPayday } from '@/services/staff-advances.service';
import { AdvanceForm, RepaymentForm, ReversePaydayForm, type AdvanceFormScope } from './StaffAdvanceForms';
import { StaffPaydayReview } from './StaffPaydayReview';

const monthFormat = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
function monthName(date: string) {
  return monthFormat.format(new Date(date));
}

export function StaffAdvancesPage() {
  const { currentOrg, currentUser, isDemoMode, isAuthenticated } = useOrg();
  const { can } = useActionPermission();
  return <div className="space-y-5">
    <header>
      <Link to="/team/staff" className="text-sm font-semibold text-teal-800 hover:underline">Staff &amp; Pay Setup</Link>
      <h1 className="mt-2 text-2xl font-bold">Staff advances &amp; payday</h1>
      <p className="mt-1 text-sm text-content-secondary">Record advances, review monthly deductions, and track what is still owed.</p>
    </header>
    {currentOrg && currentUser && isAuthenticated && !isDemoMode
      ? <StaffDirectory key={currentOrg.id + ':' + currentUser.id} orgId={currentOrg.id} userId={currentUser.id}
        currency={currentOrg.currency} editable={can('members:manage')} />
      : <Card><p className="text-sm">Sign in to a cloud workspace to open staff advances.</p></Card>}
  </div>;
}

function StaffDirectory({ orgId, userId, currency, editable }: {
  orgId: string; userId: string; currency: string; editable: boolean;
}) {
  const [page, setPage] = useState(1);
  const [staffId, setStaffId] = useState('');
  const directory = useQuery({
    queryKey: ['staff-advances', orgId, userId, 'directory', page],
    queryFn: () => staffPayService.listStaff(orgId, page - 1),
  });
  const selected = directory.data?.rows.find(person => person.id === staffId);
  return <>
    <Card className="space-y-3">
      <Select label="Employee" value={staffId} disabled={!directory.data?.rows.length}
        options={[{ value: '', label: 'Choose an employee' }, ...(directory.data?.rows ?? []).map(person => ({
          value: person.id, label: person.display_name + ' · ' + formatDisplayDate(person.joining_on),
        }))]} onChange={event => setStaffId(event.target.value)} />
      {directory.isPending && <p role="status" className="text-sm">Loading staff…</p>}
      {directory.isError && <QueryError text="Could not load staff." retry={directory.refetch} />}
      {directory.data?.count === 0 && <p className="text-sm text-content-secondary">Add an employee in Staff &amp; Pay Setup to get started.</p>}
      {!!directory.data && directory.data.count > staffPageSize && <Pagination page={page} pageSize={staffPageSize}
        totalCount={directory.data.count} totalPages={Math.ceil(directory.data.count / staffPageSize)}
        onPageChange={next => { setStaffId(''); setPage(next); }} />}
    </Card>
    {selected && <EmployeeLedger key={selected.id} person={selected} scope={{ orgId, userId, staffId: selected.id }}
      currency={currency} editable={editable} />}
  </>;
}

function EmployeeLedger({ person, scope, currency, editable }: {
  person: StaffProfile; scope: AdvanceFormScope; currency: string; editable: boolean;
}) {
  const queryClient = useQueryClient();
  const base = ['staff-advances', scope.orgId, scope.userId, scope.staffId] as const;
  const [advancePage, setAdvancePage] = useState(1);
  const [payPage, setPayPage] = useState(1);
  const [mode, setMode] = useState<'advance' | 'payday'>();
  const [repayment, setRepayment] = useState<StaffAdvance>();
  const [reversal, setReversal] = useState<StaffPayday>();
  const [paydayPeriod, setPaydayPeriod] = useState<string>();
  const [historyId, setHistoryId] = useState<string>();
  const [feedback, setFeedback] = useState('');
  const advances = useQuery({
    queryKey: [...base, 'advances', advancePage],
    queryFn: () => staffAdvanceService.listAdvances(scope.orgId, scope.staffId, advancePage),
  });
  const paydays = useQuery({
    queryKey: [...base, 'paydays', payPage],
    queryFn: () => staffAdvanceService.listPaydays(scope.orgId, scope.staffId, payPage),
  });
  const money = (paise: number) => formatCurrency(fromPaise(paise), currency);

  async function saved(message: string) {
    setFeedback(message);
    setMode(undefined);
    setRepayment(undefined);
    setReversal(undefined);
    setPaydayPeriod(undefined);
    setAdvancePage(1);
    setPayPage(1);
    await queryClient.invalidateQueries({ queryKey: base });
  }

  return <>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{person.display_name}</h2>
      {editable && <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setMode('advance')}>New advance</Button>
        <Button onClick={() => setMode(mode === 'payday' ? undefined : 'payday')}>{mode === 'payday' ? 'Close payday' : 'Review payday'}</Button>
      </div>}
    </div>
    {!editable && <p className="text-sm text-content-secondary">Records are available in read-only mode.</p>}
    {feedback && <p role="status" className="text-sm text-teal-800">{feedback}</p>}
    {editable && mode === 'payday' && <StaffPaydayReview key={paydayPeriod ?? 'current'} scope={scope} currency={currency}
      joiningOn={person.joining_on} initialPeriod={paydayPeriod}
      onSaved={() => saved('Payday recorded. Advance balances were updated.')} />}
    <Card className="space-y-3">
      <h3 className="text-base font-semibold">Advance register</h3>
      {advances.isPending && <p role="status" className="text-sm">Loading advances…</p>}
      {advances.isError && <QueryError text="Could not load advances." retry={advances.refetch} />}
      {advances.isSuccess && advances.data.rows.length === 0 && <p className="text-sm text-content-secondary">No advances recorded.</p>}
      <ul className="divide-y divide-border">
        {advances.data?.rows.map(advance => <li key={advance.id} className="space-y-3 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 text-sm">
              <p className="break-words font-medium">{advance.note}</p>
              <p className="text-content-secondary">{formatDisplayDate(advance.issued_on)} · {staffPaymentMethods[advance.method]} · {money(advance.amount_paise)}</p>
              <p className="text-content-secondary">{advance.first_month
                ? `${money(advance.installment_paise)} per month from ${monthName(advance.first_month)}`
                : 'Direct repayment only'}</p>
            </div>
            <p className="text-sm"><span className="text-content-secondary">Outstanding </span><strong>{money(advance.balance_paise)}</strong></p>
          </div>
          <div className="flex flex-wrap gap-2">
            {editable && advance.balance_paise > 0 && <Button size="sm" variant="outline" onClick={() => setRepayment(advance)}>
              Record repayment<span className="sr-only"> for {advance.note}</span>
            </Button>}
            <Button size="sm" variant="ghost" aria-expanded={historyId === advance.id}
              onClick={() => setHistoryId(historyId === advance.id ? undefined : advance.id)}>
              {historyId === advance.id ? 'Hide recovery history' : 'Recovery history'}<span className="sr-only"> for {advance.note}</span>
            </Button>
          </div>
          {historyId === advance.id && <RecoveryHistory key={advance.id} scope={scope} advanceId={advance.id} currency={currency} />}
        </li>)}
      </ul>
      <RecordPages count={advances.data?.count ?? 0} page={advancePage} onChange={setAdvancePage} />
    </Card>
    <Card className="space-y-3">
      <h3 className="text-base font-semibold">Pay records</h3>
      {paydays.isPending && <p role="status" className="text-sm">Loading pay records…</p>}
      {paydays.isError && <QueryError text="Could not load pay records." retry={paydays.refetch} />}
      {paydays.isSuccess && paydays.data.rows.length === 0 && <p className="text-sm text-content-secondary">No pay records posted.</p>}
      <ul className="divide-y divide-border">
        {paydays.data?.rows.map(record => <li key={record.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm">
          <div>
            <p className="font-medium">{monthName(record.period)}{record.reversed_at && <span className="ml-2 text-rose-800">Reversed</span>}</p>
            <p className="text-content-secondary">Gross {money(record.gross_paise)} · Advance deducted {money(record.advance_deductions_paise)} · Other {money(record.other_deductions_paise)}</p>
            {record.reversed_at && <p className="break-words text-content-secondary">Reversed {formatDisplayDate(record.reversed_at)} · {record.reversal_reason}</p>}
          </div>
          <div className="space-y-1">
            <p className="font-semibold">{money(record.net_paise)} {record.reversed_at ? 'originally recorded via' : 'paid by'} {staffPaymentMethods[record.method]}</p>
            {editable && !record.reversed_at && record.id === paydays.data?.latestActiveId &&
              <Button size="sm" variant="outline" onClick={() => setReversal(record)}>Reverse payday</Button>}
          </div>
        </li>)}
      </ul>
      <RecordPages count={paydays.data?.count ?? 0} page={payPage} onChange={setPayPage} />
    </Card>
    {editable && mode === 'advance' && <AdvanceForm scope={scope} joiningOn={person.joining_on} currency={currency}
      onClose={() => setMode(undefined)} onSaved={() => saved('Advance recorded.')} />}
    {editable && repayment && <RepaymentForm scope={scope} advance={repayment} currency={currency}
      onClose={() => setRepayment(undefined)} onSaved={() => saved('Repayment recorded.')} />}
    {editable && reversal && <ReversePaydayForm scope={scope} payday={reversal} month={monthName(reversal.period)} currency={currency}
      onClose={() => setReversal(undefined)} onSaved={async () => {
        await saved('Payday reversed. You can review a corrected record for the same month.');
        setPaydayPeriod(reversal.period);
        setMode('payday');
      }} />}
  </>;
}

function RecoveryHistory({ scope, advanceId, currency }: { scope: AdvanceFormScope; advanceId: string; currency: string }) {
  const [page, setPage] = useState(1);
  const history = useQuery({
    queryKey: ['staff-advances', scope.orgId, scope.userId, scope.staffId, 'recovery', advanceId, page],
    queryFn: () => staffAdvanceService.listRecoveries(scope.orgId, scope.staffId, advanceId, page),
  });
  return <div className="rounded-lg bg-surface-muted p-3 text-sm">
    {history.isPending && <p role="status">Loading recovery history…</p>}
    {history.isError && <QueryError text="Could not load recovery history." retry={history.refetch} />}
    {history.isSuccess && history.data.rows.length === 0 && <p>No repayments or deductions recorded.</p>}
    <ul className="divide-y divide-border">
      {history.data?.rows.map(row => <li key={row.id} className="flex flex-wrap justify-between gap-2 py-2">
        <span>{formatDisplayDate(row.received_on)} · {row.payday_reversed_at ? 'Reversed payday deduction' : row.payday_id ? 'Payday deduction' : 'Direct repayment'}
          {row.method ? ' · ' + staffPaymentMethods[row.method] : ''}{row.note ? ' · ' + row.note : ''}</span>
        <strong>{formatCurrency(fromPaise(row.amount_paise), currency)}</strong>
      </li>)}
    </ul>
    <RecordPages count={history.data?.count ?? 0} page={page} onChange={setPage} />
  </div>;
}

function RecordPages({ page, count, onChange }: { page: number; count: number; onChange: (page: number) => void }) {
  if (count <= advancePageSize) return null;
  return <Pagination page={page} pageSize={advancePageSize} totalCount={count}
    totalPages={Math.ceil(count / advancePageSize)} onPageChange={onChange} />;
}

function QueryError({ text, retry }: { text: string; retry: () => Promise<unknown> }) {
  return <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-rose-800">
    {text}<Button type="button" size="sm" variant="outline" onClick={() => void retry()}>Retry</Button>
  </p>;
}
