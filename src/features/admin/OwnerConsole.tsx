import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Building2, ChartNoAxesCombined, Inbox, LogOut, ReceiptText, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency } from '@/lib/money';
import { getBusinessDate } from '@/lib/dates';
import { supportAreaLabel, ticketStatusLabel, type TicketStatus } from '@/lib/support-reports';
import { EDITIONS, editionLabel, ownerRequest, type OwnerClient, type OwnerOverview, type OwnerPurchase, type OwnerTicket } from '@/services/owner-console.service';
import { OwnerOverviewScreen } from './OwnerOverview';
import { OwnerAssistant } from './OwnerAssistant';
import type { OwnerSection } from './owner-insights';

const tabs = [
  { id: 'overview', label: 'Overview', Icon: ChartNoAxesCombined },
  { id: 'clients', label: 'Clients', Icon: Building2 },
  { id: 'tickets', label: 'Support inbox', Icon: Inbox },
  { id: 'purchases', label: 'Purchase ledger', Icon: ReceiptText },
] as const;
const PAGE_SIZE = 25;
const dateLabel = (date: string | null) => date ? new Intl.DateTimeFormat('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
}).format(new Date(date)) : '—';
const label = (value: string | null) => value?.replace(/_/g, ' ') ?? 'Unassigned';
const clientPeriodEnd = (client: OwnerClient) => client.subscription_status === 'trialing' ? client.trial_ends_at
  : client.subscription_status === 'past_due' ? client.grace_period_ends_at : client.current_period_ends_at;

type ClientAction = 'purchase' | 'subscription' | 'review';
type Dialog = { kind: ClientAction; client: OwnerClient } | { kind: 'ticket'; ticket: OwnerTicket };

export function OwnerConsole({ account, onSignOut }: { account: string; onSignOut: () => void }) {
  const cache = useQueryClient();
  const [tab, setTab] = useState<OwnerSection>('overview');
  const previousTab = useRef(tab);
  const heading = useRef<HTMLHeadingElement>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState('');
  const overview = useQuery({
    queryKey: ['owner', account, 'overview'],
    queryFn: ({ signal }) => ownerRequest<OwnerOverview>('overview', {}, signal),
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });
  useEffect(() => {
    if (previousTab.current === tab) return;
    previousTab.current = tab;
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [tab]);
  const navigate = (section: OwnerSection) => { setTab(section); setNotice(''); };
  const current = tabs.find(item => item.id === tab)!;
  const saved = async (message: string) => {
    setDialog(null); setNotice(message);
    await cache.invalidateQueries({ queryKey: ['owner', account] });
  };
  const refresh = () => void cache.invalidateQueries({ queryKey: ['owner', account] });
  return <div className="owner-shell">
    <aside className="owner-rail">
      <div className="owner-brand"><img src="/favicon.svg" width={35} height={35} alt="" /><div><strong>Atlas OS</strong><span>Owner console</span></div></div>
      <nav aria-label="Owner sections">
        {tabs.map(({ id, label: title, Icon }) => <button type="button" key={id} aria-current={tab === id ? 'page' : undefined}
          onClick={() => navigate(id)}>
          <Icon size={18} aria-hidden="true" /><span>{title}</span>
          {id === 'tickets' && !!overview.data?.open_reports && <small>{overview.data.open_reports}</small>}
        </button>)}
      </nav>
      <button className="owner-signout" type="button" onClick={onSignOut}><LogOut size={17} aria-hidden="true" /> Sign out</button>
    </aside>
    <main className="owner-content">
      <header className="owner-hero">
        <div>
          <p className="owner-kicker"><ShieldCheck size={15} aria-hidden="true" /> Private access</p>
          <h1 ref={heading} tabIndex={-1}>{current.label}</h1>
          <p>{tab === 'overview' ? 'Subscriptions, purchases and client issues across Atlas OS.'
            : tab === 'clients' ? 'Review client activity and manage subscription access.'
            : tab === 'tickets' ? 'Reports submitted through the ERP and website.'
            : 'Verified subscription payments recorded by your team.'}</p>
        </div>
        <Button variant="outline" onClick={refresh} leftIcon={<RefreshCw size={15} aria-hidden="true" />}>Refresh</Button>
      </header>
      {notice && <p className="owner-notice" role="status">{notice}</p>}
      {tab === 'overview' && (overview.isPending ? <p role="status">Loading overview…</p>
        : overview.isError ? <p role="alert" className="owner-error">{overview.error.message}</p>
        : <OwnerOverviewScreen snapshot={overview.data} navigate={navigate} openAssistant={() => setAssistantOpen(true)} />)}
      {tab === 'clients' && <Clients account={account} open={setDialog} />}
      {tab === 'tickets' && <Tickets account={account} open={ticket => setDialog({ kind: 'ticket', ticket })} />}
      {tab === 'purchases' && <Purchases account={account} />}
    </main>
    {!dialog && <button type="button" className="owner-assistant-launcher"
      aria-label="Open Atlas Assistant" aria-haspopup="dialog" aria-expanded={assistantOpen} onClick={() => setAssistantOpen(true)}>
      <Bot size={22} aria-hidden="true" /><span>Atlas Assistant</span>
    </button>}
    <OwnerAssistant open={assistantOpen} onClose={() => setAssistantOpen(false)} snapshot={overview.isError ? undefined : overview.data}
      overviewError={overview.isError} navigate={navigate} />
    {dialog && (dialog.kind === 'ticket'
      ? <TicketDialog ticket={dialog.ticket} close={() => setDialog(null)} saved={() => saved('Support report updated.')} />
      : <ClientDialog selection={dialog} close={() => setDialog(null)} saved={saved} />)}
  </div>;
}

function PageControl({ page, change, more }: { page: number; change: (page: number) => void; more: boolean }) {
  return <div className="owner-page-control">
    <Button size="sm" variant="outline" disabled={page === 0} onClick={() => change(page - 1)}>Previous</Button>
    <span>Page {page + 1}</span>
    <Button size="sm" variant="outline" disabled={!more} onClick={() => change(page + 1)}>Next</Button>
  </div>;
}

function Clients({ account, open }: { account: string; open: (dialog: Dialog) => void }) {
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ['owner', account, 'clients', search, page],
    queryFn: ({ signal }) => ownerRequest<OwnerClient[]>('clients', { search, offset: page * PAGE_SIZE }, signal),
    refetchInterval: 60_000,
  });
  return <section className="owner-panel">
    <form className="owner-filter" onSubmit={event => { event.preventDefault(); setSearch(draft.trim()); setPage(0); }}>
      <Input label="Workspace name" value={draft} maxLength={120} onChange={event => setDraft(event.target.value)} />
      <Button type="submit">Search</Button>
    </form>
    {query.isPending ? <p role="status">Loading workspaces…</p> : query.isError ? <p role="alert" className="owner-error">{query.error.message}</p>
      : query.data.length === 0 ? <p className="owner-empty">No workspaces match this search.</p>
      : <div className="owner-table-wrap" role="region" aria-label="Client workspaces" tabIndex={0}>
        <table className="owner-table">
          <thead><tr><th>Workspace</th><th>Verification</th><th>Plan and access</th><th>Last recorded activity</th><th>Actions</th></tr></thead>
          <tbody>{query.data.slice(0, PAGE_SIZE).map(client => <tr key={client.id}>
            <th scope="row">{client.name}<small>{label(client.business_category)} · {client.open_reports} open reports</small></th>
            <td className="capitalize">{label(client.eligibility_status)}</td>
            <td>{editionLabel(client.plan_tier)}<small className="capitalize">{label(client.subscription_status)} · {dateLabel(clientPeriodEnd(client))}</small></td>
            <td>{dateLabel(client.last_activity)}</td>
            <td><div className="owner-row-actions">
              <Button variant="outline" size="sm" onClick={() => open({ kind: 'purchase', client })}>Record purchase</Button>
              {client.subscription_updated_at && <Button variant="outline" size="sm" onClick={() => open({ kind: 'subscription', client })}>Manage access</Button>}
              {client.declaration_updated_at && ['pending','review_required'].includes(client.eligibility_status) &&
                <Button variant="outline" size="sm" onClick={() => open({ kind: 'review', client })}>Review declaration</Button>}
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>}
    <PageControl page={page} change={setPage} more={(query.data?.length ?? 0) > PAGE_SIZE} />
  </section>;
}

function Tickets({ account, open }: { account: string; open: (ticket: OwnerTicket) => void }) {
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ['owner', account, 'tickets', status, page],
    queryFn: ({ signal }) => ownerRequest<OwnerTicket[]>('tickets', { status, offset: page * PAGE_SIZE }, signal),
    refetchInterval: 60_000,
  });
  return <section className="owner-panel">
    <div className="owner-filter">
      <Select label="Report status" value={status} onChange={event => { setStatus(event.target.value); setPage(0); }}
        options={[{ value: 'active', label: 'Open and investigating' }, { value: 'resolved', label: 'Resolved' }, { value: 'all', label: 'All reports' }]} />
    </div>
    {query.isPending ? <p role="status">Loading reports…</p> : query.isError ? <p role="alert" className="owner-error">{query.error.message}</p>
      : query.data.length === 0 ? <p className="owner-empty">No reports match this view.</p>
      : <ul className="owner-ticket-list">{query.data.slice(0, PAGE_SIZE).map(ticket => <li key={ticket.id}>
        <div><h2>{ticket.subject}</h2>
          <p>{ticket.company || 'Website visitor'} · {ticket.source === 'erp' ? 'ERP' : 'Website'} · {supportAreaLabel(ticket.area)} · {dateLabel(ticket.created_at)}</p></div>
        <span className={ticket.priority === 'urgent' ? 'owner-urgent' : 'owner-status'}>{ticket.priority === 'urgent' ? 'Urgent · ' : ''}{ticketStatusLabel[ticket.status]}</span>
        <Button size="sm" variant="outline" onClick={() => open(ticket)}>Open report</Button>
      </li>)}</ul>}
    <PageControl page={page} change={setPage} more={(query.data?.length ?? 0) > PAGE_SIZE} />
  </section>;
}

function Purchases({ account }: { account: string }) {
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ['owner', account, 'purchases', page],
    queryFn: ({ signal }) => ownerRequest<OwnerPurchase[]>('purchases', { offset: page * PAGE_SIZE }, signal),
    refetchInterval: 60_000,
  });
  return <section className="owner-panel">
    {query.isPending ? <p role="status">Loading purchases…</p> : query.isError ? <p role="alert" className="owner-error">{query.error.message}</p>
      : query.data.length === 0 ? <p className="owner-empty">No purchases have been recorded. Start from a workspace in Clients.</p>
      : <div className="owner-table-wrap" role="region" aria-label="Purchase ledger" tabIndex={0}>
        <table className="owner-table">
          <thead><tr><th>Workspace</th><th>Edition</th><th>Paid on</th><th>Amount</th><th>Reference</th></tr></thead>
          <tbody>{query.data.slice(0, PAGE_SIZE).map(item => <tr key={item.id}>
            <th scope="row">{item.company}</th><td>{editionLabel(item.product)}</td><td>{dateLabel(item.paid_on)}</td>
            <td>{formatCurrency(item.amount)}</td><td>{item.payment_reference}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    <PageControl page={page} change={setPage} more={(query.data?.length ?? 0) > PAGE_SIZE} />
  </section>;
}

function ClientDialog({ selection, close, saved }: {
  selection: { kind: ClientAction; client: OwnerClient }; close: () => void; saved: (message: string) => Promise<void>;
}) {
  const { kind, client } = selection;
  const editions = EDITIONS.filter(item => item.value !== 'enterprise_network' || client.plan_tier === item.value);
  const [edition, setEdition] = useState(editions.find(item => item.value === client.plan_tier)?.value ?? 'starter');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(kind === 'purchase' ? getBusinessDate() : '');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('active');
  const [decision, setDecision] = useState('approved');
  const save = useMutation({
    mutationFn: async () => {
      if (kind === 'purchase') {
        return ownerRequest('record_purchase', { organization_id: client.id, product: edition, amount, paid_on: date, reference });
      }
      if (kind === 'review') {
        return ownerRequest('review_declaration', { organization_id: client.id, version: client.declaration_updated_at, decision, reason });
      }
      return ownerRequest('set_subscription', { organization_id: client.id, version: client.subscription_updated_at,
        product: edition, status, end_date: status === 'active' ? date : null, reason });
    },
    onSuccess: () => saved(kind === 'purchase' ? 'Purchase recorded.' : kind === 'review' ? 'Verification decision recorded.' : 'Subscription access updated.'),
  });
  return <Modal isOpen title={kind === 'purchase' ? 'Record a verified purchase' : kind === 'review' ? 'Review declaration' : 'Manage subscription access'}
    description={client.name} onClose={() => { if (!save.isPending) close(); }}>
    <form className="owner-form" onSubmit={event => { event.preventDefault(); if (!save.isPending) save.mutate(); }}>
      {kind === 'review' && <dl className="grid grid-cols-2 gap-2 text-sm">
        <div><dt className="owner-muted">Industry</dt><dd>{label(client.business_category)}</dd></div>
        <div><dt className="owner-muted">Tax identity</dt><dd>{client.identity_present ? 'On file' : 'Missing'}</dd></div>
        <div><dt className="owner-muted">Electrical products</dt><dd>{client.sells_electrical_products ? 'Declared' : 'Not declared'}</dd></div>
        <div><dt className="owner-muted">Product lines</dt><dd className="break-words">{client.product_lines?.join(', ') || 'None declared'}</dd></div>
      </dl>}
      {kind === 'purchase' && <p className="text-sm">Record a payment you have verified. Manage access separately.</p>}
      {kind === 'subscription' && <Select label="Access decision" value={status} onChange={event => setStatus(event.target.value)}
        options={[{value:'active',label:'Activate or renew'}, {value:'canceled',label:'Cancel access now'}]} />}
      {(kind === 'purchase' || (kind === 'subscription' && status === 'active')) &&
        <Select label="Edition" value={edition} options={editions} onChange={event => setEdition(event.target.value as typeof edition)} />}
      {kind === 'purchase' && <>
        <Input label="Amount received (₹)" required type="number" min=".01" max="9999999999.99" step=".01" value={amount} onChange={event => setAmount(event.target.value)} />
        <Input label="Paid on" required type="date" value={date} max={getBusinessDate()} onChange={event => setDate(event.target.value)} />
        <Input label="Payment reference" required minLength={3} maxLength={100} value={reference} onChange={event => setReference(event.target.value)} />
      </>}
      {kind === 'review' && <Select label="Verification decision" value={decision} onChange={event => setDecision(event.target.value)}
        options={[{value:'approved',label:'Approve'}, {value:'rejected',label:'Reject'}]} />}
      {kind === 'subscription' && status === 'active' && <Input label="Last access day (India time)" required type="date" min={getBusinessDate()} value={date} onChange={event => setDate(event.target.value)} />}
      {kind === 'subscription' && status === 'canceled' && <p className="owner-error">Canceling immediately ends operational write access for this workspace.</p>}
      {kind !== 'purchase' && <Input label="Decision reason" required minLength={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />}
      {save.isError && <p role="alert" className="owner-error">{save.error.message}</p>}
      <Button type="submit" isLoading={save.isPending}>{status === 'canceled' ? 'Cancel access' : 'Save'}</Button>
    </form>
  </Modal>;
}

function TicketDialog({ ticket, close, saved }: { ticket: OwnerTicket; close: () => void; saved: () => Promise<void> }) {
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [priority, setPriority] = useState(ticket.priority);
  const [note, setNote] = useState(ticket.client_update ?? '');
  const save = useMutation({
    mutationFn: () => ownerRequest('update_ticket', { id: ticket.id, version: ticket.updated_at, status, priority, client_update: note }),
    onSuccess: saved,
  });
  return <Modal isOpen title={ticket.subject} description={`${ticket.source === 'erp' ? 'ERP' : 'Website'} · ${ticket.id.slice(0,8)}`} onClose={() => { if (!save.isPending) close(); }}>
    <form className="owner-form" onSubmit={event => { event.preventDefault(); if (!save.isPending) save.mutate(); }}>
      <p className="owner-report-text">{ticket.body}</p>
      {ticket.contact_email && <p className="text-sm">Website reply email · <a className="underline" href={'mailto:' + encodeURIComponent(ticket.contact_email)}>{ticket.contact_email}</a></p>}
      <Select label="Status" value={status} options={Object.entries(ticketStatusLabel).map(([value, title]) => ({ value, label: title }))}
        onChange={event => setStatus(event.target.value as TicketStatus)} />
      <Select label="Priority" value={priority} options={[{ value:'normal',label:'Normal' },{value:'urgent',label:'Urgent'}]}
        onChange={event => setPriority(event.target.value as typeof priority)} />
      {ticket.source === 'erp' && <label className="owner-field">Client update in the ERP
        <textarea value={note} onChange={event => setNote(event.target.value)} maxLength={1000} rows={4} />
      </label>}
      {save.isError && <p role="alert" className="owner-error">{save.error.message}</p>}
      <Button type="submit" isLoading={save.isPending}>Save report update</Button>
    </form>
  </Modal>;
}
