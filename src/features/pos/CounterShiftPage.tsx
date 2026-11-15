import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, CircleDollarSign, Link2, Play, Square } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useOrg } from '@/features/organizations/OrgContext';
import { useActionPermission } from '@/hooks/useActionPermission';
import { formatCurrency } from '@/lib/money';
import { counterShiftsService, CounterShift, CounterShiftReceipt, summarizeCounterShiftCash } from '@/services/counter-shifts.service';

export const CounterShiftPage: React.FC = () => {
  const { currentOrg, isMockAuth } = useOrg();
  const { check } = useActionPermission();
  const organizationId = currentOrg?.id;
  const permission = check('orders:create');
  const [shift, setShift] = useState<CounterShift | null>(null);
  const [payments, setPayments] = useState<CounterShiftReceipt[]>([]);
  const [linkedPaymentIds, setLinkedPaymentIds] = useState<string[]>([]);
  const [openingCash, setOpeningCash] = useState('');
  const [closingCash, setClosingCash] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    if (!organizationId) {
      setShift(null);
      setPayments([]);
      setLinkedPaymentIds([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const current = await counterShiftsService.getLatestShift(organizationId, isMockAuth);
      let shiftPayments: CounterShiftReceipt[] = [];
      let linked: string[] = [];
      if (current?.status === 'OPEN') {
        [shiftPayments, linked] = await Promise.all([
          counterShiftsService.getShiftPayments(organizationId, current.id, current.openedAt, isMockAuth),
          counterShiftsService.getLinkedPaymentIds(organizationId, current.id, isMockAuth),
        ]);
      }
      setShift(current);
      setPayments(shiftPayments);
      setLinkedPaymentIds(linked);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load counter shift data.');
    } finally {
      setLoading(false);
    }
  }, [organizationId, isMockAuth]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const sinceOpen = useMemo(() => {
    if (!shift || shift.status !== 'OPEN') return [];
    return [...payments].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [payments, shift]);
  const linkedSet = useMemo(() => new Set(linkedPaymentIds), [linkedPaymentIds]);
  const unlinkedPayments = sinceOpen.filter((payment) => !linkedSet.has(payment.id));
  const linkedPayments = sinceOpen.filter((payment) => linkedSet.has(payment.id));
  const summary = useMemo(() => shift?.status === 'OPEN'
    ? summarizeCounterShiftCash(shift.openingCash, linkedPayments)
    : null, [shift, linkedPayments]);
  const cashCount = Number(closingCash);
  const variancePreview = summary && closingCash.trim() !== '' && Number.isFinite(cashCount)
    ? Math.round((cashCount - summary.expectedCash + Number.EPSILON) * 100) / 100
    : null;

  const runAction = async (action: () => Promise<void>) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await action();
      setReloadKey((key) => key + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The counter shift action failed.');
    } finally {
      setSaving(false);
    }
  };

  const openShift = () => runAction(async () => {
    if (!organizationId) throw new Error('Choose a business before opening a shift.');
    const value = Number(openingCash);
    if (!Number.isFinite(value) || value < 0) throw new Error('Enter a valid nonnegative opening cash amount.');
    if (!globalThis.crypto?.randomUUID) throw new Error('Secure shift request IDs are unavailable in this browser.');
    const opened = await counterShiftsService.openShift(organizationId, value, globalThis.crypto.randomUUID(), isMockAuth);
    setShift(opened);
    setOpeningCash('');
  });

  const linkPayment = (paymentId: string) => runAction(async () => {
    if (!organizationId || !shift) throw new Error('Open a counter shift before linking receipts.');
    await counterShiftsService.linkPayment(organizationId, shift.id, paymentId, isMockAuth);
  });

  const closeShift = () => runAction(async () => {
    if (!organizationId || !shift) throw new Error('There is no open counter shift to close.');
    const value = Number(closingCash);
    if (!Number.isFinite(value) || value < 0) throw new Error('Enter the counted cash in the drawer.');
    const closed = await counterShiftsService.closeShift(organizationId, shift.id, value, isMockAuth);
    setShift(closed);
  });

  if (!permission.allowed) {
    return <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      {permission.message || 'You do not have permission to manage counter shifts.'}
    </p>;
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-8">
      <header className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-teal-100 bg-teal-50 text-teal-700">
          <CircleDollarSign size={22}/>
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#142B4D] sm:text-2xl">Counter shift</h1>
          <p className="mt-1 text-sm text-slate-600">Open the drawer, assign receipts to this shift, then reconcile the counted cash.</p>
        </div>
      </header>
      <p className="text-xs leading-relaxed text-slate-600">
        Paid Retail Counter sales link their receipts to this shift. Other receipts recorded in the business during the shift must be assigned here before closing.
        {' '}Recipe-based stock deduction and expiry tracking are not included yet.
        {' '}<Link to="/pos" className="font-semibold text-teal-700 underline underline-offset-2">Open Retail Counter</Link>
      </p>

      {error && <div role="alert" className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
        <AlertCircle size={17} className="mt-0.5 shrink-0"/><span>{error}</span>
      </div>}

      {loading ? (
        <p role="status" className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">Loading shift and receipt data…</p>
      ) : !shift ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold text-[#142B4D]">Start a shift</h2>
          <p className="mt-1 text-sm text-slate-600">Count the cash float before serving customers.</p>
          <label htmlFor="opening-cash" className="mt-4 block text-sm font-medium text-slate-700">Opening cash</label>
          <div className="mt-1 flex max-w-md gap-2">
            <input id="opening-cash" type="number" min="0" step="0.01" inputMode="decimal" value={openingCash}
              onChange={(event) => setOpeningCash(event.target.value)} disabled={saving}
              className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-100"/>
            <Button disabled={saving || !openingCash.trim()} onClick={openShift}>
              <Play size={15} className="mr-1.5"/>Open shift
            </Button>
          </div>
        </section>
      ) : shift.status === 'CLOSED' ? (
        <section role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
          <div className="flex items-center gap-2 font-semibold"><CheckCircle2 size={18}/>Last shift closed</div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-emerald-800">Expected cash</dt><dd className="font-semibold">{formatCurrency(shift.expectedCash || 0)}</dd></div>
            <div><dt className="text-emerald-800">Counted cash</dt><dd className="font-semibold">{formatCurrency(shift.closingCash || 0)}</dd></div>
            <div><dt className="text-emerald-800">Variance</dt><dd className="font-semibold">{formatCurrency(shift.variance || 0)}</dd></div>
          </dl>
          <div className="mt-5 max-w-md">
            <label htmlFor="opening-cash" className="block text-sm font-medium">Opening cash for the next shift</label>
            <div className="mt-1 flex gap-2">
              <input id="opening-cash" type="number" min="0" step="0.01" inputMode="decimal" value={openingCash}
                onChange={(event) => setOpeningCash(event.target.value)} disabled={saving}
                className="h-10 min-w-0 flex-1 rounded-lg border border-emerald-300 bg-white px-3 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-100"/>
              <Button disabled={saving || !openingCash.trim()} onClick={openShift}><Play size={15} className="mr-1.5"/>Open next</Button>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[#142B4D]">Shift is open</h2>
                <p className="mt-1 text-xs text-slate-500">Opened {new Date(shift.openedAt).toLocaleString()}</p>
              </div>
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">OPEN</span>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-slate-500">Opening float</dt><dd className="font-semibold text-[#142B4D]">{formatCurrency(shift.openingCash)}</dd></div>
              <div><dt className="text-slate-500">Cash receipts</dt><dd className="font-semibold text-[#142B4D]">{formatCurrency(summary?.cashReceipts || 0)}</dd></div>
              <div><dt className="text-slate-500">Non-cash receipts</dt><dd className="font-semibold text-[#142B4D]">{formatCurrency(summary?.nonCashReceipts || 0)}</dd></div>
              <div><dt className="text-slate-500">Expected drawer cash</dt><dd className="font-semibold text-[#142B4D]">{formatCurrency(summary?.expectedCash || 0)}</dd></div>
            </dl>
            <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
              Expected cash is opening float plus linked CASH receipts. Cash payouts are not included in this first version; record them separately and account for them before comparing the drawer.
            </p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-[#142B4D]">Receipts to assign</h2>
              <span className="text-xs text-slate-500">{unlinkedPayments.length} unassigned · {linkedPayments.length} assigned</span>
            </div>
            {unlinkedPayments.length ? (
              <ul className="mt-3 divide-y divide-slate-100">
                {unlinkedPayments.map((payment) => (
                  <li key={payment.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#142B4D]">{payment.paymentNumber} · {payment.customerName || 'Customer receipt'}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{payment.paymentMethod} · {new Date(payment.createdAt).toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold tabular-nums text-[#142B4D]">{formatCurrency(payment.amount)}</span>
                      <Button size="sm" variant="outline" disabled={saving} onClick={() => linkPayment(payment.id)}>
                        <Link2 size={14} className="mr-1"/>Assign
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-3 text-sm text-slate-600">No unassigned receipts recorded since this shift opened.</p>}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-[#142B4D]">Close shift</h2>
            <p className="mt-1 text-sm text-slate-600">Assign every receipt created during this shift before closing.</p>
            <label htmlFor="closing-cash" className="mt-4 block text-sm font-medium text-slate-700">Counted cash in drawer</label>
            <div className="mt-1 flex max-w-md gap-2">
              <input id="closing-cash" type="number" min="0" step="0.01" inputMode="decimal" value={closingCash}
                onChange={(event) => setClosingCash(event.target.value)} disabled={saving}
                className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-100"/>
              <Button variant="outline" disabled={saving || unlinkedPayments.length > 0 || !closingCash.trim()} onClick={closeShift}>
                <Square size={14} className="mr-1.5"/>Close shift
              </Button>
            </div>
            {variancePreview !== null && <p className="mt-3 text-sm text-slate-700">
              Preview variance: <strong className={variancePreview === 0 ? 'text-emerald-700' : 'text-amber-800'}>{formatCurrency(variancePreview)}</strong>
            </p>}
            {unlinkedPayments.length > 0 && <p role="status" className="mt-3 text-xs text-amber-800">
              Close is disabled until all {unlinkedPayments.length} receipt(s) are assigned.
            </p>}
          </section>
        </>
      )}
    </div>
  );
};
