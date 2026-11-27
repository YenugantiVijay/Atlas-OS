import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, fromPaise } from '@/lib/money';
import { QueryState, useSchoolRead, type SchoolScope } from './SchoolShared';
import type { SchoolReceipt } from './school.types';
import './school-print.css';

export function SchoolReceiptView({ scope, id, onClose }: { scope: SchoolScope; id?: string; onClose: () => void }) {
  const receipt = useSchoolRead<SchoolReceipt>(scope, 'receipt', { receipt_id: id }, !!id);
  return <>
    <Modal isOpen={!!id} onClose={onClose} title="School fee payment receipt" maxWidth="2xl">
      <QueryState pending={receipt.isPending} error={receipt.error} retry={receipt.refetch} />
      {receipt.data && !receipt.isError && <><ReceiptDetails receipt={receipt.data} /><Button className="mt-4" onClick={() => window.print()}>Print school fee receipt</Button></>}
    </Modal>
    {!!id && receipt.data && !receipt.isError && createPortal(<div id="school-receipt-print"><ReceiptDetails receipt={receipt.data} /></div>, document.body)}
  </>;
}
function ReceiptDetails({ receipt }: { receipt: SchoolReceipt }) {
  const school = receipt.school_snapshot; const student = receipt.student_snapshot;
  const money = (amount: number) => formatCurrency(fromPaise(amount));
  return <article aria-label={'Fee receipt ' + receipt.receipt_no} className="space-y-4 text-sm">
    <header className="border-b border-border pb-4">{school.logo_url && <img src={school.logo_url} alt="School logo" className="mb-3 h-14 max-w-48 object-contain" />}
      <h2 className="text-xl font-bold">{school.name}</h2><p className="whitespace-pre-wrap">{school.address}</p><p>{school.phone}{school.email ? ' · ' + school.email : ''}</p></header>
    <div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-semibold">Fee payment receipt</h3><p>{receipt.receipt_no} · {receipt.paid_on}</p></div><strong className="text-lg">{money(receipt.amount_paise)}</strong></div>
    <dl className="grid gap-2 sm:grid-cols-2"><div><dt className="font-semibold">Student</dt><dd>{student.name} · {student.admission_no}</dd></div>
      <div><dt className="font-semibold">Class / academic year</dt><dd>{student.class} {student.section} · {student.year}</dd></div>
      <div><dt className="font-semibold">Guardian</dt><dd>{student.guardian_name}</dd></div>
      <div><dt className="font-semibold">Recorded payment</dt><dd>{receipt.method.toUpperCase()} · {receipt.reference || 'No reference recorded'}</dd></div></dl>
    <table className="w-full text-left"><thead><tr><th className="border-b border-border py-2">Fee instalment</th><th className="border-b border-border py-2">Due date</th><th className="border-b border-border py-2 text-right">Amount allocated</th></tr></thead>
      <tbody>{receipt.allocations?.map((row, index) => <tr key={index}><td className="py-2">{row.label}</td><td className="py-2">{row.due_on}</td><td className="py-2 text-right">{money(row.amount_paise)}</td></tr>)}</tbody>
      <tfoot><tr><th colSpan={2} className="border-t border-border py-2">Payment received</th><td className="border-t border-border py-2 text-right font-semibold">{money(receipt.amount_paise)}</td></tr></tfoot></table>
    {!!receipt.adjustments?.length && <section><h3 className="font-semibold">Approved adjustments to this receipt</h3>
      {receipt.adjustments.map((row, index) => <p key={index} className="mt-1">{row.refunded_on} · {row.kind} · {money(row.amount_paise)} · {row.reason}</p>)}
      <p className="mt-2 font-semibold">Net retained: {money(receipt.amount_paise - receipt.adjustments.reduce((sum, row) => sum + row.amount_paise, 0))}</p></section>}
    <p className="text-xs text-content-secondary">Payment receipt for recorded school fees. This document does not confirm bank settlement or replace an applicable tax document.</p>
  </article>;
}
