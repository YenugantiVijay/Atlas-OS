import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { getBusinessDate } from '@/lib/dates';
import { formatCurrency, fromPaise } from '@/lib/money';
import { parseStaffPayAmount, payBases } from '@/services/staff-pay.service';
import {
  advanceDeductionCapacity, parseStaffDeduction, staffAdvanceService,
  type PaydayAmounts, type PaydayPreview, type StaffPaymentMethod,
} from '@/services/staff-advances.service';
import { PaymentMethodSelect, type AdvanceFormScope } from './StaffAdvanceForms';

function suggestedDeductions(lines: PaydayPreview['lines'], capacity: number) {
  let available = capacity;
  return Object.fromEntries(lines.map(line => {
    const amount = Math.min(line.scheduled_paise, available);
    available -= amount;
    return [line.id, fromPaise(amount).toFixed(2)];
  }));
}

function readDeductions(lines: PaydayPreview['lines'], selected: Record<string, string>) {
  try {
    return lines.map(line => {
      const amount = parseStaffDeduction(selected[line.id] ?? '0');
      if (amount > line.catchup_paise) throw new Error('Above amount due');
      return { id: line.id, amount_paise: amount };
    }).filter(line => line.amount_paise > 0);
  } catch {
    return null;
  }
}

export function StaffPaydayReview({ scope, joiningOn, currency, initialPeriod, onSaved }: {
  scope: AdvanceFormScope; joiningOn: string; currency: string; initialPeriod?: string; onSaved: () => Promise<void>;
}) {
  const thisMonth = getBusinessDate().slice(0, 7);
  const [month, setMonth] = useState(initialPeriod?.slice(0, 7) ?? thisMonth);
  const [gross, setGross] = useState('');
  const [wageBasis, setWageBasis] = useState('');
  const [other, setOther] = useState('0');
  const [limit, setLimit] = useState('');
  const [method, setMethod] = useState<StaffPaymentMethod>('bank');
  const [review, setReview] = useState<{ period: string; data: PaydayPreview; amounts: PaydayAmounts; capacity: number }>();
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const money = (amount: number) => formatCurrency(fromPaise(amount), currency);
  const selectedMonth = useQuery({
    queryKey: ['staff-advances', scope.orgId, scope.userId, scope.staffId, 'month-rate', month],
    queryFn: () => staffAdvanceService.previewPayday(scope.orgId, scope.staffId, month + '-01'),
    enabled: !review && !!month && month >= joiningOn.slice(0, 7) && month <= thisMonth,
    retry: false,
  });
  const rate = selectedMonth.data?.rate;

  const choices = review ? readDeductions(review.data.lines, selected) : null;
  const total = choices?.reduce((sum, line) => sum + line.amount_paise, 0) ?? 0;
  const available = review?.capacity ?? 0;
  const net = review ? review.amounts.gross - review.amounts.other - total : 0;
  const valid = !!review && !!choices && total <= available;

  async function preview(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const period = month + '-01';
      const data = await staffAdvanceService.previewPayday(scope.orgId, scope.staffId, period);
      if (data.latest_period && data.latest_period >= period) {
        throw new Error('This or a later wage month has already been posted.');
      }
      const amounts = {
        gross: parseStaffPayAmount(gross), wageBasis: parseStaffDeduction(wageBasis), other: parseStaffDeduction(other),
        limit: limit.trim() ? parseStaffDeduction(limit) : null,
      };
      const capacity = advanceDeductionCapacity(amounts);
      setReview({ period, data, amounts, capacity });
      setSelected(suggestedDeductions(data.lines, capacity));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not preview this payday.');
    } finally {
      setBusy(false);
    }
  }

  async function post() {
    if (busy || !valid || !choices || !review) return;
    setError('');
    setBusy(true);
    try {
      await staffAdvanceService.postPayday(scope, review.period, review.amounts, method, review.data.snapshot, choices);
      setReview(undefined);
      await onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not confirm the pay record.');
    } finally {
      setBusy(false);
    }
  }

  return <Card className="space-y-4">
    <h2 className="text-base font-semibold">Monthly payday</h2>
    {!review ? <form onSubmit={event => void preview(event)} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Wage month" type="month" min={joiningOn.slice(0, 7)} max={thisMonth} required value={month}
          disabled={busy} onChange={event => setMonth(event.target.value)} />
        <PaymentMethodSelect value={method} onChange={setMethod} disabled={busy} label="How pay was sent" />
        <Input label={`Gross pay (${currency})`} value={gross} onChange={event => setGross(event.target.value)}
          inputMode="decimal" required disabled={busy} />
        <Input label={`Wage basis for deduction limit (${currency})`} value={wageBasis} onChange={event => setWageBasis(event.target.value)}
          inputMode="decimal" required disabled={busy} />
        <Input label={`Other wage deductions (${currency})`} value={other} onChange={event => setOther(event.target.value)}
          inputMode="decimal" required disabled={busy} />
        <Input label={`Lower advance recovery limit, optional (${currency})`} value={limit}
          onChange={event => setLimit(event.target.value)} inputMode="decimal" disabled={busy} />
      </div>
      {rate && <div className="flex flex-wrap items-center gap-2 text-sm text-content-secondary">
        <p>Starting rate for this month · {money(rate.amount_paise)} · {payBases[rate.basis]}</p>
        {rate.basis === 'monthly' && <Button variant="outline" size="sm" type="button" disabled={busy}
          onClick={() => setGross(fromPaise(rate.amount_paise).toFixed(2))}>Use rate for gross pay</Button>}
      </div>}
      <p className="text-sm text-content-secondary">Enter actual gross pay for the month. Half the wage basis, minus other wage deductions, caps advance recovery.</p>
      <Button type="submit" isLoading={busy} disabled={busy}>Preview payday</Button>
    </form> : <div className="space-y-4">
      <div className="grid gap-2 text-sm sm:grid-cols-4">
        <p>Gross pay <strong className="block">{money(review.amounts.gross)}</strong></p>
        <p>Wage basis <strong className="block">{money(review.amounts.wageBasis)}</strong></p>
        <p>Advance deduction limit <strong className="block">{money(available)}</strong></p>
        <p>Net pay <strong className="block">{valid ? money(net) : '—'}</strong></p>
      </div>
      <p className="text-sm text-content-secondary">Other deductions {money(review.amounts.other)} · Advance deductions {money(total)}</p>
      {review.data.rate && <p className="text-sm text-content-secondary">Starting rate for this month · {money(review.data.rate.amount_paise)} · {payBases[review.data.rate.basis]}</p>}
      {review.data.lines.length > 0 ? <>
        <p className="text-sm">Enter zero to skip an advance this month. Include missed installments only when agreed.</p>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setSelected(
          Object.fromEntries(review.data.lines.map(line => [line.id, '0'])),
        )}>Skip all advance deductions</Button>
        <ul className="divide-y divide-border">
          {review.data.lines.map(line => <li key={line.id} className="grid items-end gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)_auto]">
            <div className="min-w-0 text-sm">
              <p className="break-words font-medium">{line.note}</p>
              <p className="text-content-secondary">Balance {money(line.balance_paise)} · Scheduled {money(line.scheduled_paise)}</p>
              {line.catchup_paise > line.scheduled_paise && <p className="text-content-secondary">
                With missed installments {money(line.catchup_paise)}
              </p>}
            </div>
            <Input label={`Deduct (${currency})`} value={selected[line.id] ?? ''} inputMode="decimal" disabled={busy}
              onChange={event => setSelected(previous => ({ ...previous, [line.id]: event.target.value }))} />
            {line.catchup_paise > line.scheduled_paise && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => {
              setSelected(previous => {
                let otherSelected = 0;
                for (const otherLine of review.data.lines) {
                  if (otherLine.id !== line.id) {
                    try {
                      const parsed = parseStaffDeduction(previous[otherLine.id] ?? '0');
                      otherSelected += Math.max(0, parsed);
                    } catch {
                      // ignore unparseable input on other lines
                    }
                  }
                }
                const allowed = Math.min(line.catchup_paise, Math.max(available - otherSelected, 0));
                return {
                  ...previous,
                  [line.id]: fromPaise(allowed).toFixed(2),
                };
              });
            }}>Include missed</Button>}
          </li>)}
        </ul>
      </> : <p className="text-sm text-content-secondary">No advances are due this wage month.</p>}
      {!valid && <p role="alert" className="text-sm text-rose-800">Check each amount due and the total recovery limit.</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => { setReview(undefined); setError(''); }}>Edit details</Button>
        <Button disabled={!valid || busy} isLoading={busy} onClick={() => void post()}>
          {valid ? `Record ${money(net)} as paid` : 'Record pay'}
        </Button>
      </div>
    </div>}
    {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
  </Card>;
}
