import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { getBusinessDate, formatDisplayDate } from '@/lib/dates';
import { formatCurrency, fromPaise } from '@/lib/money';
import { parseStaffPayAmount } from '@/services/staff-pay.service';
import {
  staffAdvanceService, staffPaymentMethods, type StaffAdvance, type StaffPaymentMethod,
} from '@/services/staff-advances.service';

export type AdvanceFormScope = { orgId: string; staffId: string; userId: string };
const methodOptions = Object.entries(staffPaymentMethods).map(([value, label]) => ({ value, label }));

export function PaymentMethodSelect({ value, onChange, disabled, label = 'Payment method' }: {
  value: StaffPaymentMethod; onChange: (method: StaffPaymentMethod) => void; disabled?: boolean; label?: string;
}) {
  return <Select label={label} value={value} options={methodOptions} disabled={disabled}
    onChange={event => onChange(event.target.value as StaffPaymentMethod)} />;
}

export function AdvanceForm({ scope, joiningOn, currency, onClose, onSaved }: {
  scope: AdvanceFormScope; joiningOn: string; currency: string; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const today = getBusinessDate();
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'next' | 'monthly' | 'direct'>('next');
  const [period, setPeriod] = useState('');
  const [installment, setInstallment] = useState('');
  const [method, setMethod] = useState<StaffPaymentMethod>('cash');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const preJoining = date < joiningOn;
  let earliest = (preJoining ? joiningOn : date).slice(0, 7);
  if (preJoining && joiningOn.slice(-2) !== '01') {
    const [year, month] = earliest.split('-').map(Number);
    earliest = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
  }
  const startMonth = period || (earliest > today.slice(0, 7) ? earliest : today.slice(0, 7));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !note.trim()) return;
    setBusy(true);
    setError('');
    try {
      const total = parseStaffPayAmount(amount);
      const regular = mode === 'monthly' ? parseStaffPayAmount(installment) : mode === 'direct' ? 0 : total;
      if (regular > total) throw new Error('The installment exceeds the original advance.');
      await staffAdvanceService.recordAdvance(scope, {
        issuedOn: date, amount: total, method, note, installment: regular,
        firstMonth: mode === 'direct' ? null : startMonth + '-01',
      });
      await onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not confirm the advance.');
    } finally {
      setBusy(false);
    }
  }

  return <Modal isOpen title="Record staff advance" description="Enter the advance amount already paid to this employee."
    onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={event => void save(event)} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={`Advance amount (${currency})`} inputMode="decimal" required value={amount}
          disabled={busy} onChange={event => setAmount(event.target.value)} />
        <Input label="Date paid" type="date" max={today} required value={date} disabled={busy}
          onChange={event => { setDate(event.target.value); setPeriod(''); }} />
        <Select label="Recovery plan" value={mode} disabled={busy} options={[
          { value: 'next', label: 'One payday deduction' },
          { value: 'monthly', label: 'Monthly installments' },
          { value: 'direct', label: 'Direct repayment only' },
        ]} onChange={event => setMode(event.target.value as typeof mode)} />
        <PaymentMethodSelect value={method} onChange={setMethod} disabled={busy} />
        {mode !== 'direct' && <Input label="First deduction month" type="month" required value={startMonth} min={earliest}
          disabled={busy} onChange={event => setPeriod(event.target.value)} />}
        {mode === 'monthly' && <Input label={`Monthly installment (${currency})`} value={installment} inputMode="decimal"
          required disabled={busy} onChange={event => setInstallment(event.target.value)} />}
      </div>
      {preJoining && mode !== 'direct' && <p className="text-sm text-content-secondary">
        This is a pre-joining advance. The earliest recovery month is the employee’s first complete month.
      </p>}
      <Input label="Reason or reference" value={note} required maxLength={300} disabled={busy} onChange={event => setNote(event.target.value)} />
      {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
      <Button type="submit" isLoading={busy} disabled={busy || !note.trim()}>Record advance</Button>
    </form>
  </Modal>;
}

export function RepaymentForm({ scope, advance, currency, onClose, onSaved }: {
  scope: AdvanceFormScope; advance: StaffAdvance; currency: string; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const today = getBusinessDate();
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<StaffPaymentMethod>('cash');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !note.trim()) return;
    setError('');
    setBusy(true);
    try {
      await staffAdvanceService.recordRepayment(scope, advance.id, {
        receivedOn: date, method, note, amount: parseStaffPayAmount(amount),
      });
      await onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not confirm the repayment.');
    } finally {
      setBusy(false);
    }
  }

  return <Modal isOpen title="Record direct repayment"
    description={`Balance ${formatCurrency(fromPaise(advance.balance_paise), currency)} from ${formatDisplayDate(advance.issued_on)}.`}
    onClose={() => { if (!busy) onClose(); }}>
    <form onSubmit={event => void save(event)} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={`Amount received (${currency})`} inputMode="decimal" required value={amount}
          disabled={busy} onChange={event => setAmount(event.target.value)} />
        <Input label="Date received" type="date" min={advance.issued_on} max={today} required value={date}
          disabled={busy} onChange={event => setDate(event.target.value)} />
      </div>
      <PaymentMethodSelect value={method} onChange={setMethod} disabled={busy} />
      <Input label="Reason or reference" value={note} required maxLength={300} disabled={busy} onChange={event => setNote(event.target.value)} />
      {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
      <Button type="submit" isLoading={busy} disabled={busy || !note.trim()}>Record repayment</Button>
    </form>
  </Modal>;
}
