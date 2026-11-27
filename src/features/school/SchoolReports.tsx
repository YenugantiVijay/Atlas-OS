import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { getBusinessDate } from '@/lib/dates';
import { classOptions, Pager, QueryState, SchoolPanel, useSchoolRead, yearOptions, type SchoolScope } from './SchoolShared';
import { downloadSchoolCsv, schoolService } from './school.service';
import { schoolMoney } from './SchoolFees';
import type { SchoolPageData } from './school.types';

interface FeeSummary { enrolment_id: string; name: string; admission_no: string; charged_paise: number; concession_paise: number; paid_paise: number; balance_paise: number }
interface Collection { id: string; kind: string; receipt_no: string; day: string; method: string; reference: string; amount_paise: number; student_snapshot: { name: string; admission_no: string } }
export function SchoolReports({ scope }: { scope: SchoolScope }) {
  const [year, setYear] = useState(scope.bootstrap.years[0]?.id ?? ''); const [classId, setClassId] = useState('');
  const [from, setFrom] = useState(getBusinessDate().slice(0, 7) + '-01'); const [to, setTo] = useState(getBusinessDate());
  const [page, setPage] = useState(1); const [collections, setCollections] = useState(false); const [error, setError] = useState(''); const [exporting, setExporting] = useState(false);
  const filter = collections ? { from, to, offset: (page - 1) * 25 } : { year_id: year, class_id: classId, offset: (page - 1) * 25 };
  const fees = useSchoolRead<SchoolPageData<FeeSummary>>(scope, 'fee_summary', filter, !collections && !!year);
  const cash = useSchoolRead<SchoolPageData<Collection>>(scope, 'collections', filter, collections && !!from && !!to);
  const report = collections ? cash : fees;
  return <SchoolPanel title={collections ? 'School collections and refunds' : 'School fee dues report'}>
    <div className="flex flex-wrap gap-2"><Button variant={collections ? 'outline' : 'primary'} onClick={() => { setCollections(false); setPage(1); }}>Fee dues</Button>
      <Button variant={collections ? 'primary' : 'outline'} onClick={() => { setCollections(true); setPage(1); }}>Collections and refunds</Button></div>
    <div className="grid gap-3 sm:grid-cols-2">{collections ? <>
      <Input label="Collection report from" type="date" value={from} onChange={event => { setFrom(event.target.value); setPage(1); }} />
      <Input label="Collection report to" type="date" value={to} onChange={event => { setTo(event.target.value); setPage(1); }} />
    </> : <>
      <Select label="Fee report academic year" value={year} options={yearOptions(scope)} onChange={event => { setYear(event.target.value); setClassId(''); setPage(1); }} />
      <Select label="Fee report class" value={classId} options={[{ value: '', label: 'All classes' }, ...classOptions(scope, year)]} onChange={event => { setClassId(event.target.value); setPage(1); }} />
    </>}</div>
    <QueryState pending={report.isPending} error={report.error} retry={report.refetch} />
    {report.data && !report.isError && <>
      <dl className="grid gap-3 rounded-xl bg-surface-muted p-4 text-sm sm:grid-cols-3">{Object.entries(report.data.totals ?? {}).map(([label, value]) => <div key={label}>
        <dt className="capitalize">{label.replace(/_paise$/, '').replace(/_/g, ' ')}</dt><dd className="mt-1 text-lg font-bold">{schoolMoney(value)}</dd>
      </div>)}</dl>
      <p className="text-xs text-content-secondary">Totals cover the full filtered report, not just this page. Collections are based on recorded payment dates; approved refunds and reversals reduce net collections.</p>
      <Button variant="outline" disabled={exporting} onClick={async () => {
        setError(''); setExporting(true);
        try {
          if (collections) {
            const result = await schoolService.page<Collection>(scope.orgId, 'collections', { ...filter, export: true });
            downloadSchoolCsv(`School-Collections-${from}-${to}.csv`, ['Type', 'Receipt', 'Date', 'Admission number', 'Student', 'Method', 'Reference', 'Amount INR'],
              result.rows.map(row => [row.kind, row.receipt_no, row.day, row.student_snapshot.admission_no, row.student_snapshot.name, row.method, row.reference, (row.amount_paise / 100).toFixed(2)]));
          } else {
            const result = await schoolService.page<FeeSummary>(scope.orgId, 'fee_summary', { ...filter, export: true });
            downloadSchoolCsv('School-Fee-Dues.csv', ['Admission number', 'Student', 'Charged INR', 'Approved concessions INR', 'Net paid INR', 'Outstanding INR'],
              result.rows.map(row => [row.admission_no, row.name, (row.charged_paise / 100).toFixed(2), (row.concession_paise / 100).toFixed(2), (row.paid_paise / 100).toFixed(2), (row.balance_paise / 100).toFixed(2)]));
          }
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'School export failed.'); }
        finally { setExporting(false); }
      }}>Export complete filtered report CSV</Button>
      {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
      {collections ? <div className="space-y-2">{cash.data?.rows.map(row => <article key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
        <div><h3 className="font-semibold">{row.receipt_no} · {row.kind}</h3><p>{row.student_snapshot.name} · {row.student_snapshot.admission_no} · {row.day}</p><p>{row.method.toUpperCase()} · {row.reference || 'No reference'}</p></div><strong>{schoolMoney(row.amount_paise)}</strong>
      </article>)}</div> : <div className="overflow-auto rounded-lg border border-border"><table className="w-full min-w-[40rem] text-left text-sm"><thead><tr>{['Student', 'Charged', 'Concessions', 'Net paid', 'Outstanding'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead>
        <tbody>{fees.data?.rows.map(row => <tr key={row.enrolment_id} className="border-t border-border"><td className="p-3">{row.name} · {row.admission_no}</td>{[row.charged_paise, row.concession_paise, row.paid_paise, row.balance_paise].map((value, index) => <td key={index} className="p-3">{schoolMoney(value)}</td>)}</tr>)}</tbody></table></div>}
      {report.data.count === 0 && <p className="text-sm">No records for the selected filters.</p>}
      <Pager data={report.data as SchoolPageData<unknown>} page={page} onChange={setPage} />
    </>}
  </SchoolPanel>;
}
