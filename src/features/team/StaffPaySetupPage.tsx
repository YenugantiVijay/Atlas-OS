import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useOrg } from '@/features/organizations/OrgContext';
import { useActionPermission } from '@/hooks/useActionPermission';
import { getBusinessDate, formatDisplayDate } from '@/lib/dates';
import { formatCurrency, fromPaise } from '@/lib/money';
import {
  payBases, parseStaffPayAmount, staffPageSize, staffPayService, type PayBasis, type StaffProfile, type StaffPayRate,
} from '@/services/staff-pay.service';

const selectClass = 'mt-1 h-11 w-full rounded-lg border border-border bg-surface-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-teal-700';

export function StaffPaySetupPage() {
  const { currentOrg, currentUser, isDemoMode, isAuthenticated } = useOrg();
  const { can } = useActionPermission();

  return (
    <div className="space-y-5">
      <header>
        <Link to="/team" className="text-sm font-semibold text-teal-800 hover:underline">Team &amp; Permissions</Link>
        <h1 className="mt-2 text-2xl font-bold text-content-primary">Staff &amp; Pay Setup</h1>
        <p className="mt-1 text-sm text-content-secondary">Set work locations, joining dates, and pay rates for each employee.</p>
      </header>
      {isDemoMode || !isAuthenticated || !currentOrg
        ? <Card><p className="text-sm">Sign in to a cloud workspace to use staff and pay setup.</p></Card>
        : <StaffWorkspace key={currentOrg.id + ':' + currentUser?.id} orgId={currentOrg.id}
            currency={currentOrg.currency} editable={can('members:manage')} />}
    </div>
  );
}

function StaffWorkspace({ orgId, currency, editable }: { orgId: string; currency: string; editable: boolean }) {
  const { currentUser } = useOrg();
  const queryClient = useQueryClient();
  const scope = ['staff-setup', orgId, currentUser?.id] as const;
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string>();
  const [locationName, setLocationName] = useState('');
  const [staffName, setStaffName] = useState('');
  const [joiningOn, setJoiningOn] = useState(getBusinessDate);
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean }>();
  const saving = useRef(false);
  const staffId = useRef<string>();
  const locations = useQuery({ queryKey: [...scope, 'locations'], queryFn: () => staffPayService.listLocations(orgId) });
  const staff = useQuery({ queryKey: [...scope, 'profiles', page], queryFn: () => staffPayService.listStaff(orgId, page - 1) });
  const currentRows = staff.data?.rows ?? [];
  const locationRows = locations.data ?? [];
  const activeStaff = currentRows.find((person) => person.id === selectedId);
  const loadError = staff.isError || locations.isError;

  async function save(action: () => Promise<void>, message: string) {
    if (saving.current || !editable) return;
    saving.current = true;
    setBusy(true);
    setFeedback(undefined);
    try {
      await action();
      setFeedback({ text: message, error: false });
      await queryClient.invalidateQueries({ queryKey: scope });
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : 'Could not save the change.', error: true });
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  function createLocation(event: FormEvent) {
    event.preventDefault();
    if (!locationName.trim()) return;
    void save(async () => {
      await staffPayService.addLocation(orgId, locationName);
      setLocationName('');
    }, 'Work location added.');
  }

  function createStaff(event: FormEvent) {
    event.preventDefault();
    if (!staffName.trim() || locationIds.length === 0) return;
    staffId.current ??= crypto.randomUUID();
    const id = staffId.current;
    void save(async () => {
      await staffPayService.addStaff(orgId, id, staffName, joiningOn, locationIds);
      staffId.current = undefined;
      setStaffName('');
      setLocationIds([]);
    }, 'Employee added.');
  }

  return (
    <>
      {!editable && <p role="status" className="text-sm text-content-secondary">You can view staff setup. Workspace writes are unavailable.</p>}
      {loadError && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-rose-800">
        Staff setup could not be loaded.
        <Button type="button" variant="outline" size="sm" onClick={() => { void staff.refetch(); void locations.refetch(); }}>Retry</Button>
      </div>}
      {feedback && <p role={feedback.error ? 'alert' : 'status'} className={feedback.error ? 'text-sm text-rose-800' : 'text-sm text-teal-800'}>{feedback.text}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <h2 className="text-base font-semibold">Work locations</h2>
          {locationRows.length > 0 && <ul className="flex flex-wrap gap-2 text-sm">
            {locationRows.map((location) => <li key={location.id} className="rounded-lg bg-surface-muted px-2 py-1">{location.name}</li>)}
          </ul>}
          <form onSubmit={createLocation} className="space-y-3">
            <Input label="Location name" value={locationName} onChange={e => setLocationName(e.target.value)}
              maxLength={100} required disabled={!editable || busy} placeholder="Main studio" />
            <Button type="submit" variant="outline" disabled={!editable || busy || !locationName.trim()}>Add location</Button>
          </form>
        </Card>
        <Card className="space-y-3">
          <h2 className="text-base font-semibold">Add employee</h2>
          <form onSubmit={createStaff} className="space-y-3">
            <Input label="Employee name" value={staffName}
              onChange={e => { staffId.current = undefined; setStaffName(e.target.value); }} maxLength={100} required disabled={!editable || busy} />
            <Input label="Joining date" type="date" value={joiningOn}
              onChange={e => { staffId.current = undefined; setJoiningOn(e.target.value); }} required disabled={!editable || busy} />
            <fieldset disabled={!editable || busy} className="space-y-1">
              <legend className="text-sm font-medium">Assigned locations</legend>
              {locations.isPending && <p className="text-sm" role="status">Loading locations…</p>}
              {locations.isSuccess && locationRows.length === 0 && <p className="text-sm text-content-secondary">Add a work location first.</p>}
              <div className="flex flex-wrap gap-x-4">
                {locationRows.map((location) => <label key={location.id} className="flex min-h-10 items-center gap-2 text-sm">
                  <input type="checkbox" checked={locationIds.includes(location.id)} onChange={e => {
                    staffId.current = undefined;
                    setLocationIds(e.target.checked ? [...locationIds, location.id] : locationIds.filter(id => id !== location.id));
                  }} />{location.name}
                </label>)}
              </div>
            </fieldset>
            <Button type="submit" disabled={!editable || busy || locationIds.length === 0}>Add employee</Button>
          </form>
        </Card>
      </div>
      <Card className="space-y-3">
        <h2 className="text-base font-semibold">Staff directory</h2>
        {staff.isPending && <p role="status" className="text-sm">Loading staff…</p>}
        {staff.isSuccess && currentRows.length === 0 && <p className="text-sm text-content-secondary">No employees added yet.</p>}
        <ul className="divide-y divide-border">
          {currentRows.map(person => <li key={person.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <div>
              <p className="font-medium">{person.display_name}</p>
              <p className="text-content-secondary">{person.joining_on > getBusinessDate() ? 'Starts' : 'Joined'} {formatDisplayDate(person.joining_on)}
                {' · '}{person.staff_location_assignments.map(a => locationRows.find(l => l.id === a.location_id)?.name)
                  .filter(Boolean).join(', ') || (locations.isSuccess ? 'No location assigned' : 'Locations unavailable')}</p>
            </div>
            <Button type="button" variant="outline" size="sm" aria-pressed={activeStaff?.id === person.id}
              onClick={() => setSelectedId(person.id)}>Manage pay<span className="sr-only"> for {person.display_name}</span></Button>
          </li>)}
        </ul>
        {staff.data && staff.data.count > staffPageSize && <Pagination page={page} pageSize={staffPageSize} totalCount={staff.data.count}
          totalPages={Math.ceil(staff.data.count / staffPageSize)} onPageChange={setPage} />}
      </Card>
      {activeStaff && <PaySetup key={activeStaff.id} staff={activeStaff} orgId={orgId} currency={currency} editable={editable && !busy}
        save={save} scope={scope} newLocations={locationRows.filter(l => !activeStaff.staff_location_assignments.some(a => a.location_id === l.id))} />}
    </>
  );
}

function PaySetup({ staff, orgId, currency, editable, save, scope, newLocations }: {
  staff: StaffProfile; orgId: string; currency: string; editable: boolean; scope: readonly (string | undefined)[];
  save: (action: () => Promise<void>, message: string) => Promise<void>;
  newLocations: Array<{ id: string; name: string }>;
}) {
  const today = getBusinessDate();
  const [page, setPage] = useState(1);
  const [basis, setBasis] = useState<PayBasis>('monthly');
  const [effectiveOn, setEffectiveOn] = useState(today < staff.joining_on ? staff.joining_on : today);
  const [amount, setAmount] = useState('');
  const [assignment, setAssignment] = useState('');
  const [correction, setCorrection] = useState<StaffPayRate>();
  const rates = useQuery({
    queryKey: [...scope, 'rates', staff.id, today, page],
    queryFn: () => staffPayService.listRates(orgId, staff.id, today, page - 1),
  });
  const current = rates.data?.current;

  return (
    <Card className="space-y-4">
      <h2 className="text-base font-semibold">Pay setup for {staff.display_name}</h2>
      {rates.isPending && <p role="status" className="text-sm">Loading pay rates…</p>}
      {rates.isError && <p role="alert" className="text-sm text-rose-800">Pay rates are unavailable. <button type="button" className="underline" onClick={() => void rates.refetch()}>Retry</button></p>}
      {rates.isSuccess && <p className="text-sm">{current
        ? `Current rate · ${formatCurrency(fromPaise(current.amount_paise), currency)} · ${payBases[current.basis]}`
        : 'No rate effective today.'}</p>}
      {current && editable && <Button type="button" variant="outline" size="sm" onClick={() => setCorrection(current)}>
        Correct current rate
      </Button>}
      <form className="grid items-end gap-3 sm:grid-cols-3" onSubmit={event => {
        event.preventDefault();
        void save(async () => {
          await staffPayService.addRate(orgId, staff, effectiveOn, basis, parseStaffPayAmount(amount));
          setAmount('');
          setPage(1);
        }, 'Pay rate saved.');
      }}>
        <label className="text-sm font-medium">Pay basis
          <select className={selectClass} value={basis} onChange={e => setBasis(e.target.value as PayBasis)} disabled={!editable}>
            {Object.entries(payBases).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <Input label={`Rate (${currency})`} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} required disabled={!editable} />
        <Input label="Effective date" type="date" value={effectiveOn} min={staff.joining_on}
          onChange={e => setEffectiveOn(e.target.value)} required disabled={!editable} />
        <Button type="submit" disabled={!editable} className="sm:justify-self-start">Save pay rate</Button>
      </form>
      {newLocations.length > 0 && <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
        event.preventDefault();
        if (!assignment) return;
        void save(async () => {
          await staffPayService.assignLocation(orgId, staff.id, assignment);
          setAssignment('');
        }, 'Location assigned.');
      }}>
        <label className="text-sm font-medium">Additional location
          <select className={selectClass} value={assignment} onChange={e => setAssignment(e.target.value)} disabled={!editable}>
            <option value="">Choose location</option>
            {newLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <Button type="submit" variant="outline" disabled={!editable || !assignment}>Assign location</Button>
      </form>}
      {rates.data && rates.data.rows.length > 0 && <div>
        <h3 className="font-semibold text-sm">Rate history</h3>
        <ul className="mt-2 divide-y divide-border text-sm">
          {rates.data.rows.map(rate => <li key={rate.effective_on + ':' + rate.revision} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0 break-words">
              <p>{formatDisplayDate(rate.effective_on)}{rate.effective_on > today && rate.is_latest ? ' · Scheduled' : ''}
                {rate.is_latest ? '' : ' · Superseded'}{rate.revision > 1 ? ' · Correction ' + (rate.revision - 1) : ''}</p>
              {rate.reason && <p className="text-xs text-content-secondary">{rate.reason} · Recorded {formatDisplayDate(rate.recorded_at)}</p>}
            </div>
            <span>{formatCurrency(fromPaise(rate.amount_paise), currency)} · {payBases[rate.basis]}</span>
            {rate.is_latest && editable && <Button type="button" variant="outline" size="sm"
              onClick={() => setCorrection(rate)}>Correct<span className="sr-only"> rate for {formatDisplayDate(rate.effective_on)}</span></Button>}
          </li>)}
        </ul>
        {rates.data.count > staffPageSize && <Pagination page={page} pageSize={staffPageSize} totalCount={rates.data.count}
          totalPages={Math.ceil(rates.data.count / staffPageSize)} onPageChange={setPage} />}
      </div>}
      {correction && <PayCorrectionForm rate={correction} currency={currency} close={() => setCorrection(undefined)}
        onCorrect={async (nextBasis, nextAmount, reason) => {
          await staffPayService.correctRate(orgId, staff.id, correction, nextBasis, nextAmount, reason);
          setCorrection(undefined);
          setPage(1);
          await rates.refetch();
        }} />}
    </Card>
  );
}

function PayCorrectionForm({ rate, currency, close, onCorrect }: {
  rate: StaffPayRate;
  currency: string;
  close: () => void;
  onCorrect: (basis: PayBasis, amount: number, reason: string) => Promise<void>;
}) {
  const [basis, setBasis] = useState(rate.basis);
  const [amount, setAmount] = useState(fromPaise(rate.amount_paise).toFixed(2));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !reason.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onCorrect(basis, parseStaffPayAmount(amount), reason);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save the rate correction.');
    } finally {
      setBusy(false);
    }
  }

  return <Modal isOpen onClose={() => { if (!busy) close(); }} title="Correct pay rate"
    description={`Effective ${formatDisplayDate(rate.effective_on)}. The previous rate stays in history.`}>
    <form className="space-y-4" onSubmit={event => void save(event)}>
      <Select label="Corrected pay basis" value={basis}
        options={Object.entries(payBases).map(([value, label]) => ({ value, label }))}
        onChange={event => setBasis(event.target.value as PayBasis)} disabled={busy} />
      <Input label={`Corrected rate (${currency})`} value={amount} inputMode="decimal" required
        onChange={event => setAmount(event.target.value)} disabled={busy} />
      <Input label="Reason for correction" value={reason} required maxLength={300}
        onChange={event => setReason(event.target.value)} disabled={busy} />
      {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
      <Button type="submit" isLoading={busy} disabled={busy || !reason.trim()}>Save correction</Button>
    </form>
  </Modal>;
}
