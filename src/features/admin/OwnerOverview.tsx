import { useId, useState } from 'react';
import { Activity, ArrowUpRight, Bell, Building2, CircleHelp, CreditCard, IndianRupee, ReceiptText, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/lib/money';
import { supportAreaLabel } from '@/lib/support-reports';
import { editionLabel, type OwnerOverview, type PurchaseMonth } from '@/services/owner-console.service';

import { getOwnerInsights, monthName, type OwnerSection } from './owner-insights';

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

export function OwnerOverviewScreen({ snapshot, navigate, openAssistant }: {
  snapshot: OwnerOverview; navigate: (section: OwnerSection) => void; openAssistant: () => void;
}) {
  const lastMonth = snapshot.months.at(-1);
  const signals = getOwnerInsights(snapshot);
  const cards = [
    { label: 'Client workspaces', value: snapshot.clients, Icon: Building2, tone: 'violet', destination: 'clients' },
    { label: 'Active subscriptions', value: snapshot.active, Icon: CreditCard, tone: 'teal', destination: 'clients' },
    { label: 'Recorded this month', value: formatCurrency(lastMonth?.revenue ?? 0), Icon: IndianRupee, tone: 'amber', destination: 'purchases' },
    { label: 'Open client reports', value: snapshot.open_reports, Icon: CircleHelp, tone: 'rose', destination: 'tickets' },
  ] as const;
  const top = Math.max(1, ...snapshot.products.map(p => p.purchases));
  return <>
    <div className="owner-metrics">
      {cards.map(({ label, value, Icon, tone, destination }) => <button type="button"
        className={`owner-metric owner-metric-link tone-${tone}`} key={label} onClick={() => navigate(destination)}>
        <span className="owner-icon"><Icon size={21} aria-hidden="true" /></span>
        <span className="owner-metric-label">{label}</span><strong>{value}</strong>
        <ArrowUpRight className="owner-metric-arrow" size={17} aria-hidden="true" />
      </button>)}
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
        {signals.length ? <ul className="owner-signal-list">{signals.map(item => <li key={item.message}>
          <button type="button" className="owner-text-link" onClick={() => navigate(item.area)}>
            {item.message}<ArrowUpRight size={15} aria-hidden="true" />
          </button>
        </li>)}</ul>
          : <p className="owner-empty">No current warnings from the records available.</p>}
        {snapshot.recent_reports.length > 0 && <div className="owner-recent">
          <h3>Recent open reports</h3>
          <ul>{snapshot.recent_reports.map(report => <li key={report.id}>
            <span>{report.subject}</span><small>{supportAreaLabel(report.area)} · {report.source === 'erp' ? 'ERP' : 'Website'}</small>
          </li>)}</ul>
          <Button size="sm" variant="outline" onClick={() => navigate('tickets')}>Open support inbox</Button>
        </div>}
      </section>
      <section className="owner-panel owner-quick-panel">
        <div className="owner-panel-heading"><div><h2>Quick actions</h2><p>Open the console area you need.</p></div><Sparkles size={20} aria-hidden="true" /></div>
        <button className="owner-shortcut" type="button" onClick={() => navigate('clients')}><Building2 size={18} aria-hidden="true" /><span>Manage subscriptions</span><ArrowUpRight size={16} aria-hidden="true" /></button>
        <button className="owner-shortcut" type="button" onClick={() => navigate('purchases')}><ReceiptText size={18} aria-hidden="true" /><span>View purchase ledger</span><ArrowUpRight size={16} aria-hidden="true" /></button>
        <button className="owner-shortcut" type="button" onClick={openAssistant}><Sparkles size={18} aria-hidden="true" /><span>Open Atlas Assistant</span><ArrowUpRight size={16} aria-hidden="true" /></button>
      </section>
    </div>
  </>;
}
