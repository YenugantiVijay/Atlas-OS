import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, CircleDollarSign, Play, Square } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useOrg } from '@/features/organizations/OrgContext';
import { useActionPermission } from '@/hooks/useActionPermission';
import { formatCurrency, fromPaise, toPaise } from '@/lib/money';
import { counterShiftsService, CounterShift, CounterShiftReceipt, type CounterCashMovement, summarizeCounterShiftCash } from '@/services/counter-shifts.service';

export const CounterShiftPage: React.FC = () => {
  const { currentOrg, isMockAuth } = useOrg();
  const { check } = useActionPermission();
  const organizationId = currentOrg?.id;
  const permission = check('orders:create');
  const [shift, setShift] = useState<CounterShift | null>(null);
  const [payments, setPayments] = useState<CounterShiftReceipt[]>([]);
  const [cashMovements, setCashMovements] = useState<CounterCashMovement[]>([]);
  const [cashDirection, setCashDirection] = useState<'IN' | 'OUT'>('IN');
  const [cashAmount, setCashAmount] = useState('');
  const [cashReason, setCashReason] = useState('');
  const cashRequest = useRef<{ fingerprint: string; id: string }>();
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
      setCashMovements([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const current = await counterShiftsService.getLatestShift(organizationId, isMockAuth);
      let shiftPayments: CounterShiftReceipt[] = [];
      let movements: CounterCashMovement[] = [];
      if (current) {
        [shiftPayments, movements] = await Promise.all([
          counterShiftsService.getShiftPayments(organizationId, current.id, isMockAuth),
          counterShiftsService.getCashMovements(organizationId, current.id, isMockAuth),
        ]);
      }
      setShift(current);
      setPayments(shiftPayments);
      setCashMovements(movements);
    } catch (reason) {
      setShift(null);
      setError(reason instanceof Error ? reason.message : 'Unable to load counter shift data.');
    } finally {
      setLoading(false);
    }
  }, [organizationId, isMockAuth]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  const summary = useMemo(() => shift?.status === 'OPEN'
    ? summarizeCounterShiftCash(shift.openingCash, payments, cashMovements)
    : null, [shift, payments, cashMovements]);
  const cashCount = Number(closingCash);
  const variancePreview = summary && closingCash.trim() !== '' && Number.isFinite(cashCount)
    ? fromPaise(toPaise(cashCount) - toPaise(summary.expectedCash))
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

  const addCashMovement = () => runAction(async () => {
    if (!organizationId || !shift) throw new Error('Open a counter shift before recording cash.');
    const amount = Number(cashAmount);
    const reason = cashReason.trim();
    const fingerprint = JSON.stringify([shift.id, cashDirection, amount, reason]);
    if (cashRequest.current?.fingerprint !== fingerprint) {
      cashRequest.current = { fingerprint, id: globalThis.crypto.randomUUID() };
    }
    await counterShiftsService.recordCashMovement(organizationId, shift.id, {
      requestId: cashRequest.current.id, direction: cashDirection, amount, reason,
    }, isMockAuth);
    cashRequest.current = undefined;
    setCashAmount('');
    setCashReason('');
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
          <p className="mt-1 text-sm text-slate-600">Open the drawer, record cash movements, and reconcile the counted cash.</p>
        </div>
      </header>
      <p className="text-xs leading-relaxed text-slate-600">
        Paid Retail Counter sales are recorded against this drawer.
        {' '}<Link to="/pos" className="font-semibold text-teal-700 underline underline-offset-2">Open Retail Counter</Link>
      </p>

      {error && <div role="alert" className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
        <AlertCircle size={17} className="mt-0.5 shrink-0"/><span>{error}</span>
      </div>}

      {loading ? (
        <p role="status" className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">Loading shift and receipt data…</p>
      ) : !shift && error ? (
        <Button variant="outline" onClick={() => setReloadKey(key => key + 1)}>Reload drawer</Button>
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
              Expected cash includes the opening float, drawer cash receipts, and cash added or removed.
              {' '}Cash in {formatCurrency(summary?.cashIn ?? 0)} · Cash out {formatCurrency(summary?.cashOut ?? 0)}.
            </p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-[#142B4D]">Cash movements</h2>
            <form className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); addCashMovement(); }}>
              <label className="grid gap-1 text-sm">Direction
                <select className="h-10 rounded-lg border border-border px-2" value={cashDirection} disabled={saving}
                  onChange={event => setCashDirection(event.target.value === 'OUT' ? 'OUT' : 'IN')}>
                  <option value="IN">Cash in</option>
                  <option value="OUT">Cash out</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">Amount
                <input className="h-10 min-w-0 rounded-lg border border-border px-2" type="number" inputMode="decimal"
                  min="0.01" step="0.01" required disabled={saving} value={cashAmount} onChange={event => setCashAmount(event.target.value)} />
              </label>
              <label className="grid gap-1 text-sm">Reason
                <input className="h-10 min-w-0 rounded-lg border border-border px-2" maxLength={200} required disabled={saving}
                  value={cashReason} onChange={event => setCashReason(event.target.value)} />
              </label>
              <Button type="submit" className="self-end" disabled={saving || !cashAmount.trim() || !cashReason.trim()}>Record cash movement</Button>
            </form>
            {cashMovements.length > 0 && <ul className="mt-3 divide-y divide-border">
              {cashMovements.map(move => (
                <li key={move.requestId} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                  <span className="break-all">{move.reason}</span>
                  <span className="font-semibold">{move.direction === 'IN' ? 'Cash in' : 'Cash out'} · {formatCurrency(move.amount)}</span>
                </li>
              ))}
            </ul>}
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-[#142B4D]">Drawer receipts</h2>
            {payments.length === 0 ? <p className="mt-2 text-sm text-slate-600">No receipts for this drawer.</p> :
              <ul className="mt-3 max-h-72 divide-y divide-border overflow-y-auto">
                {payments.map(payment => (
                  <li key={payment.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                    <span>{payment.paymentNumber} · {payment.customerName || 'Customer receipt'}</span>
                    <span className="font-semibold">{payment.paymentMethod} · {formatCurrency(payment.amount)}</span>
                  </li>
                ))}
              </ul>}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-[#142B4D]">Close shift</h2>
            <label htmlFor="closing-cash" className="mt-4 block text-sm font-medium text-slate-700">Counted cash in drawer</label>
            <div className="mt-1 flex max-w-md gap-2">
              <input id="closing-cash" type="number" min="0" step="0.01" inputMode="decimal" value={closingCash}
                onChange={(event) => setClosingCash(event.target.value)} disabled={saving}
                className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-100"/>
              <Button variant="outline" disabled={saving || !closingCash.trim()} onClick={closeShift}>
                <Square size={14} className="mr-1.5"/>Close shift
              </Button>
            </div>
            {variancePreview !== null && <p className="mt-3 text-sm text-slate-700">
              Preview variance: <strong className={variancePreview === 0 ? 'text-emerald-700' : 'text-amber-800'}>{formatCurrency(variancePreview)}</strong>
            </p>}

          </section>
        </>
      )}
    </div>
  );
};
