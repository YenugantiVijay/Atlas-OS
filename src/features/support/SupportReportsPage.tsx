import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LifeBuoy } from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { getSupabaseClient } from '@/lib/supabase';
import { SUPPORT_AREAS, supportAreaLabel, ticketStatusLabel, type SupportArea, type TicketStatus } from '@/lib/support-reports';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

interface ClientReport {
  id: string;
  area: SupportArea;
  subject: string;
  status: TicketStatus;
  client_update: string | null;
  created_at: string;
}

export function SupportReportsPage() {
  const { currentOrg, currentUser, isDemoMode, isAuthenticated } = useOrg();
  const org = currentOrg?.id;
  const enabled = Boolean(org && currentUser && isAuthenticated && !isDemoMode);
  const client = useQueryClient();
  const queryKey = ['my-support-reports', currentUser?.id, org];
  const [area, setArea] = useState<SupportArea>('general');
  const [subject, setSubject] = useState('');
  const [report, setReport] = useState('');
  const [reference, setReference] = useState('');
  const draftRequest = useRef<{ fingerprint: string; id: string } | null>(null);
  const reports = useQuery({
    queryKey, enabled, retry: false, refetchInterval: enabled ? 60_000 : false,
    queryFn: async ({ signal }) => {
      const { data, error } = await getSupabaseClient().rpc('my_client_problem_reports', { p_org: org }).abortSignal(signal);
      if (error) throw new Error('Your reports could not be loaded.');
      return (data ?? []) as ClientReport[];
    },
  });
  const send = useMutation({
    mutationFn: async () => {
      if (!enabled) throw new Error('Select an active signed-in workspace.');
      const fingerprint = JSON.stringify([org, area, subject.trim(), report.trim()]);
      if (draftRequest.current?.fingerprint !== fingerprint) draftRequest.current = { fingerprint, id: crypto.randomUUID() };
      const { data, error } = await getSupabaseClient().rpc('report_client_problem', {
        p_org: org, p_area: area, p_subject: subject.trim(), p_body: report.trim(), p_request_id: draftRequest.current.id,
      });
      if (error || typeof data !== 'string') {
        throw new Error(error?.code === '22023' ? error.message : 'Your report could not be saved. Please retry.');
      }
      return data;
    },
    onSuccess: async id => {
      draftRequest.current = null;
      setSubject(''); setReport(''); setReference(id.slice(0,8));
      await client.invalidateQueries({ queryKey });
    },
  });
  return <div className="space-y-6">
    <header>
      <h1 className="flex items-center gap-2 text-2xl font-bold"><LifeBuoy size={23} aria-hidden="true" /> Atlas OS Support</h1>
      <p className="mt-1 text-sm text-content-secondary">Report a problem and check for updates from the Atlas team.</p>
    </header>
    {enabled ? <div className="grid gap-5 xl:grid-cols-2">
      <form className="space-y-4 rounded-2xl border border-border bg-white p-5" onSubmit={event => {
        event.preventDefault();
        if (subject.trim().length >= 3 && report.trim().length >= 10 && !send.isPending) send.mutate();
      }}>
        <h2 className="text-lg font-bold">Report a problem</h2>
        <fieldset disabled={send.isPending} className="space-y-4">
          <Select label="Affected area" options={[...SUPPORT_AREAS]} value={area} onChange={event => setArea(event.target.value as SupportArea)} />
          <Input label="Subject" required minLength={3} maxLength={120} value={subject} onChange={event => setSubject(event.target.value)} />
          <label htmlFor="client-support-body" className="block text-sm font-medium">What happened?</label>
          <textarea id="client-support-body" required minLength={10} maxLength={2000} rows={6} value={report}
            onChange={event => setReport(event.target.value)}
            className="w-full rounded-lg border border-border p-3 text-sm"
            placeholder="Include the screen, what you expected, and the error you saw." />
        </fieldset>
        <p className="text-xs text-content-secondary">Leave out passwords, payment credentials, and customer information.</p>
        {send.isError && <p role="alert" className="text-sm text-status-danger-text">{send.error.message}</p>}
        {reference && <p role="status" className="text-sm font-semibold text-status-success-text">Report received · {reference}</p>}
        <Button type="submit" isLoading={send.isPending} disabled={subject.trim().length < 3 || report.trim().length < 10}>Send report</Button>
      </form>
      <section className="rounded-2xl border border-border bg-white p-5">
        <h2 className="text-lg font-bold">My reports</h2>
        <p className="mt-1 text-sm text-content-secondary">Reports you sent from this workspace.</p>
        {reports.isPending ? <p role="status" className="mt-4">Loading reports…</p>
          : reports.isError ? <div className="mt-4"><p role="alert">{reports.error.message}</p><Button variant="outline" onClick={() => void reports.refetch()}>Retry</Button></div>
          : reports.data.length === 0 ? <p className="mt-4 text-sm text-content-secondary">You haven’t sent any reports from this workspace.</p>
          : <ul className="mt-4 space-y-3">{reports.data.map(item => <li key={item.id} className="rounded-xl border border-border p-3">
            <p className="break-words font-semibold">{item.subject}</p>
            <p className="mt-1 text-xs text-content-secondary">{supportAreaLabel(item.area)} · {ticketStatusLabel[item.status]} · {item.id.slice(0,8)}</p>
            {item.client_update && <p className="mt-2 whitespace-pre-wrap break-words text-sm">Atlas Support · {item.client_update}</p>}
          </li>)}</ul>}
      </section>
    </div> : <p className="rounded-xl border border-border bg-white p-5 text-sm">Sign in to a cloud workspace to send a support report.</p>}
  </div>;
}
