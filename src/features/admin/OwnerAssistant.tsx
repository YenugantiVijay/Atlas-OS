import { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowUpRight, Bot, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useDialog } from '@/components/ui/useDialog';
import { formatCurrency } from '@/lib/money';
import { supportAreaLabel } from '@/lib/support-reports';
import { editionLabel, generateOwnerSummary, type OwnerOverview } from '@/services/owner-console.service';
import { getOwnerInsights, type OwnerSection } from './owner-insights';

const topics = [
  { id: 'attention', label: 'What needs attention?' },
  { id: 'purchases', label: 'Review purchases' },
  { id: 'reports', label: 'Review client reports' },
  { id: 'renewals', label: 'Check renewals' },
  { id: 'ai', label: 'Summarise with AI' },
] as const;
type Topic = typeof topics[number]['id'];

export function OwnerAssistant({ open, onClose, snapshot, overviewError, navigate }: {
  open: boolean;
  onClose: () => void;
  snapshot: OwnerOverview | undefined;
  overviewError: boolean;
  navigate: (section: OwnerSection) => void;
}) {
  const dialog = useDialog(open, onClose);
  const id = useId();
  const [topic, setTopic] = useState<Topic>('attention');
  const summary = useMutation({ mutationFn: generateOwnerSummary });
  if (!open) return null;

  const navigateTo = (section: OwnerSection) => { onClose(); navigate(section); };
  const insights = snapshot ? getOwnerInsights(snapshot) : [];
  const month = snapshot?.months.at(-1);
  const leader = snapshot?.products[0];
  const openSection = (section: OwnerSection, label: string) => (
    <button type="button" className="owner-text-link" onClick={() => navigateTo(section)}>
      {label}<ArrowUpRight size={15} aria-hidden="true" />
    </button>
  );
  return <div className="owner-assistant-overlay">
    <div className="owner-assistant-scrim" aria-hidden="true" onClick={onClose} />
    <div className="owner-assistant-panel" id="owner-assistant-panel" ref={dialog} tabIndex={-1}
      role="dialog" aria-modal="true" aria-labelledby={id}>
      <header className="owner-assistant-header">
        <span className="owner-assistant-icon"><Bot size={23} aria-hidden="true" /></span>
        <div><h2 id={id}>Atlas Assistant</h2><p>Purchase trends, renewals and support</p></div>
        <button type="button" className="owner-assistant-close" aria-label="Close Atlas Assistant" onClick={onClose}><X size={20} /></button>
      </header>
      <div className="owner-assistant-body">
        <div className="owner-assistant-topics" aria-label="Assistant topics">
          {topics.map(item => <button type="button" key={item.id} aria-pressed={topic === item.id}
            onClick={() => setTopic(item.id)}>{item.label}</button>)}
        </div>
        <section className="owner-assistant-answer" aria-live="polite" aria-atomic="false">
          {topic === 'ai' ? <>
            <h3><Sparkles size={16} aria-hidden="true" /> AI report brief</h3>
            <p>Generate a short brief from recent report excerpts and totals. This sends the excerpts to the configured AI provider with detected email addresses and phone-like numbers masked.</p>
            <Button size="sm" isLoading={summary.isPending} onClick={() => summary.mutate()}>Generate summary</Button>
            {summary.isError && <p role="alert" className="owner-error">{summary.error.message}</p>}
            {summary.data && <p className="owner-ai-result" role="status">{summary.data}</p>}
          </> : !snapshot ? (
            <p role={overviewError ? 'alert' : 'status'}>{overviewError ? 'The latest dashboard data could not be loaded.' : 'Loading the latest dashboard data…'}</p>
          ) : <>
            {topic === 'attention' && <>
              <h3>Attention needed</h3>
              {insights.length ? <ul className="owner-assistant-list">
                {insights.map(item => <li key={item.message}>{openSection(item.area, item.message)}</li>)}
              </ul> : <p>No current warnings in the dashboard data.</p>}
            </>}
            {topic === 'purchases' && <>
              <h3>Recorded purchases</h3>
              <p>{month?.purchases ? `This month has ${month.purchases} recorded purchase${month.purchases === 1 ? '' : 's'}, totalling ${formatCurrency(month.revenue)}.`
                : 'No purchases have been recorded this month.'}</p>
              {leader && <p>{editionLabel(leader.product)} leads the six-month ranking with {leader.purchases} recorded {leader.purchases === 1 ? 'purchase' : 'purchases'}.</p>}
              {openSection('purchases', 'Open purchase ledger')}
            </>}
            {topic === 'reports' && <>
              <h3>Client reports</h3>
              <p>{snapshot.open_reports} open · {snapshot.urgent_reports} urgent · {snapshot.overdue_reports} open over 48 hours</p>
              {snapshot.recent_reports.length > 0 && <ul className="owner-assistant-list">
                {snapshot.recent_reports.map(report => <li key={report.id}>
                  <strong>{report.subject}</strong><small>{supportAreaLabel(report.area)} · {report.source === 'erp' ? 'ERP' : 'Website'}</small>
                </li>)}
              </ul>}
              {openSection('tickets', 'Open support inbox')}
            </>}
            {topic === 'renewals' && <>
              <h3>Subscription renewals</h3>
              <p>{snapshot.due_renewals} {snapshot.due_renewals === 1 ? 'subscription reaches' : 'subscriptions reach'} the access end date within 14 days.</p>
              {openSection('clients', 'Review client plans')}
            </>}
          </>}
        </section>
      </div>
    </div>
  </div>;
}
