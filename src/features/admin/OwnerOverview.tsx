import { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Activity, Bell, Building2, CircleHelp, CreditCard, IndianRupee, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/lib/money';
import { supportAreaLabel } from '@/lib/support-reports';
import { editionLabel, generateOwnerSummary, type OwnerOverview, type PurchaseMonth } from '@/services/owner-console.service';

const monthName = (value: string) => new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' })
  .format(new Date(value + '-01T00:00:00Z'));

function PurchaseWave({ months }: { months: PurchaseMonth[] }) {
  const [metric, setMetric] = useState<'purchases' | 'revenue'>('purchases');
  const gradient = useId().replace(/:/g, '');
  const max = Math.max(1, ...months.map(item => item[metric]));
  const points = months.map((item, index) => {
    const x = 25 + index * (550 / Math.max(1, months.length - 1));
    return { x, y: 158 - item[metric] / max * 129 };
  });
  const stroke = points.reduce((path, point, index) => {
    if (index === 0) return 'M ' + point.x + ' ' + point.y;
    const prior = points[index - 1];
    const mid = (prior.x + point.x) / 2;
    return path + ` C ${mid} ${prior.y}, ${mid} ${point.y}, ${point.x} ${point.y}`;
  }, '');
  const fill = points.length ? stroke + ` L ${points.at(-1)?.x} 158 L ${points[0].x} 158 Z` : '';
  const total = months.reduce((sum, item) => sum + item[metric], 0);
  return <section className="owner-panel owner-purchases" aria-labelledby="owner-purchase-heading">
    <div className="owner-panel-heading">
      <div><h2 id="owner-purchase-heading">Monthly purchases</h2><p>Last six months · recorded payments</p></div>
      <div className="owner-switch" aria-label="Chart measure">
        <button type="button" aria-pressed={metric === 'purchases'} onClick={() => setMetric('purchases')}>Purchases</button>
        <button type="button" aria-pressed={metric === 'revenue'} onClick={() => setMetric('revenue')}>Revenue</button>
      </div>
    </div>
    <p className="owner-chart-total">{metric === 'revenue' ? formatCurrency(total) : total.toLocaleString('en-IN')}</p>
    {total === 0 && <p className="owner-muted">No purchases have been recorded in this period.</p>}
    <svg className="owner-wave" viewBox="0 0 600 174" aria-hidden="true">
      <defs><linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
        <stop stopColor="#9c72f2" stopOpacity=".46" /><stop offset="1" stopColor="#9c72f2" stopOpacity=".03" />
      </linearGradient></defs>
      {[35, 77, 118, 158].map(y => <line key={y} x1="20" x2="580" y1={y} y2={y} stroke="#e5dff5" strokeDasharray="4 5" />)}
      <path d={fill} fill={`url(#${gradient})`} className="owner-wave-fill" />
      <path d={stroke} pathLength="1" stroke="#7047cd" strokeWidth="3.5" fill="none" strokeLinecap="round" className="owner-wave-line" />
      {points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="4" fill="white" stroke="#7047cd" strokeWidth="2" />)}
    </svg>
    <ul className="owner-month-list">{months.map(item => <li key={item.month}>
      <span>{monthName(item.month)}</span>
      <strong>{metric === 'revenue' ? formatCurrency(item.revenue) : item.purchases}</strong>
    </li>)}</ul>
  </section>;
}

export function OwnerOverviewScreen({ snapshot, openReports }: { snapshot: OwnerOverview; openReports: () => void }) {
  const [showAI, setShowAI] = useState(false);
  const summary = useMutation({ mutationFn: generateOwnerSummary });
  const reportArea = snapshot.report_areas[0];
  const lastMonth = snapshot.months.at(-1);
  const lastComplete = snapshot.months.at(-2);
  const preceding = snapshot.months.at(-3);
  const signals = [
    snapshot.urgent_reports > 0 && `${snapshot.urgent_reports} urgent client report${snapshot.urgent_reports === 1 ? ' needs' : 's need'} attention.`,
    snapshot.overdue_reports > 0 && `${snapshot.overdue_reports} reports have been open for over 48 hours.`,
    snapshot.due_renewals > 0 && `${snapshot.due_renewals} subscriptions reach their access end date within 14 days.`,
    reportArea && `${supportAreaLabel(reportArea.area)} has the most open reports (${reportArea.reports}).`,
    lastComplete && preceding && lastComplete.purchases < preceding.purchases &&
      `Purchases fell from ${preceding.purchases} in ${monthName(preceding.month)} to ${lastComplete.purchases} in ${monthName(lastComplete.month)}.`,
  ].filter(Boolean);
  const cards = [
    { label: 'Client workspaces', value: snapshot.clients, Icon: Building2, tone: 'violet' },
    { label: 'Active subscriptions', value: snapshot.active, Icon: CreditCard, tone: 'teal' },
    { label: 'Recorded this month', value: formatCurrency(lastMonth?.revenue ?? 0), Icon: IndianRupee, tone: 'amber' },
    { label: 'Open client reports', value: snapshot.open_reports, Icon: CircleHelp, tone: 'rose' },
  ];
  const top = Math.max(1, ...snapshot.products.map(p => p.purchases));
  return <>
    <div className="owner-metrics">
      {cards.map(({ label, value, Icon, tone }) => <article className={`owner-metric tone-${tone}`} key={label}>
        <span className="owner-icon"><Icon size={21} aria-hidden="true" /></span>
        <p>{label}</p><strong>{value}</strong>
      </article>)}
    </div>
    <div className="owner-overview-grid">
      <PurchaseWave months={snapshot.months} />
      <section className="owner-panel">
        <div className="owner-panel-heading"><div><h2>Most purchased editions</h2><p>Ranked by purchase count · last six months</p></div><Activity size={20} aria-hidden="true" /></div>
        {snapshot.products.length ? <ol className="owner-ranking">
          {snapshot.products.map((row, index) => <li key={row.product}>
            <div><strong>{editionLabel(row.product)}</strong><span>{row.purchases.toLocaleString('en-IN')}</span></div>
            <div className="owner-bar"><span className={`tone-${['violet', 'teal', 'amber'][index % 3]}`} style={{ width: `${row.purchases / top * 100}%` }} /></div>
          </li>)}
        </ol> : <p className="owner-empty">Record a verified purchase to see edition rankings.</p>}
      </section>
    </div>
    <div className="owner-overview-grid">
      <section className="owner-panel">
        <div className="owner-panel-heading"><div><h2>Attention needed</h2><p>Refreshes every 60 seconds while the console is open</p></div><Bell size={20} aria-hidden="true" /></div>
        {signals.length ? <ul className="owner-signal-list">{signals.map(item => <li key={String(item)}>{item}</li>)}</ul>
          : <p className="owner-empty">No current warnings from the records available.</p>}
        {snapshot.recent_reports.length > 0 && <div className="owner-recent">
          <h3>Recent open reports</h3>
          <ul>{snapshot.recent_reports.map(report => <li key={report.id}>
            <span>{report.subject}</span><small>{supportAreaLabel(report.area)} · {report.source === 'erp' ? 'ERP' : 'Website'}</small>
          </li>)}</ul>
          <Button size="sm" variant="outline" onClick={openReports}>Open support inbox</Button>
        </div>}
      </section>
      <section className="owner-panel owner-ai">
        <div className="owner-panel-heading"><div><h2>AI report brief</h2><p>Summarise recent client reports and purchase trends.</p></div><Sparkles size={22} aria-hidden="true" /></div>
        {showAI ? <>
          <p className="owner-muted">This sends recent report excerpts and aggregate totals to the configured AI provider. Email addresses and phone-like numbers are masked when detected.</p>
          <Button isLoading={summary.isPending} onClick={() => summary.mutate()}>Generate summary</Button>
        </> : <Button variant="outline" onClick={() => setShowAI(true)}>Review AI summary options</Button>}
        {summary.isError && <p role="alert" className="owner-error">{summary.error.message}</p>}
        {summary.data && <p className="owner-ai-result" role="status">{summary.data}</p>}
      </section>
    </div>
  </>;
}
