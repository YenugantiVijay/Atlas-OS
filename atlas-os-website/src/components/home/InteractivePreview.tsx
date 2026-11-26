import { useState } from 'react';
import { Boxes, FileSpreadsheet, LayoutDashboard, Receipt, Users } from 'lucide-react';

const views = [
  { name: 'Executive Dashboard', title: 'Sales and collections', text: 'Review what was billed and what customers have paid.', Icon: LayoutDashboard, details: [['Invoiced', '₹11,800'], ['Received', '₹8,000'], ['Outstanding', '₹3,800']] },
  { name: 'Commercial Invoicing', title: 'GST invoice', text: 'Review item value, GST, and the total before issuing the invoice.', Icon: Receipt, details: [['Taxable value', '₹10,000'], ['GST at 18%', '₹1,800'], ['Invoice total', '₹11,800']] },
  { name: 'Multi-UOM Inventory', title: 'Stock availability', text: 'Check stock in the selling unit before committing to an order.', Icon: Boxes, details: [['Product', 'Copper wire'], ['On hand', '28 coils'], ['Reserved', '4 coils']] },
  { name: 'Customer Receivables', title: 'Customer balances', text: 'See how a payment changes the balance on an invoice.', Icon: Users, details: [['Invoice total', '₹11,800'], ['Payment applied', '₹8,000'], ['Balance due', '₹3,800']] },
  { name: '1-Click Excel Exports', title: 'Report exports', text: 'Prepare a workbook for reviewing sales and payments for a selected period.', Icon: FileSpreadsheet, details: [['Report', 'Sales and payments'], ['Period', 'November 2026'], ['Format', 'Excel (.xlsx)']] },
];

export default function InteractivePreview() {
  const [active, setActive] = useState(0);
  const view = views[active];

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4 sm:px-6">
        <p className="font-heading text-base font-bold">Atlas OS workflow preview</p>
        <p className="text-sm font-medium text-content-secondary">Sample data</p>
      </header>
      <div className="grid md:grid-cols-[15rem_minmax(0,1fr)]">
        <div role="group" aria-label="Workspace views" className="grid gap-1 border-b border-border bg-surface-secondary p-3 sm:grid-cols-2 md:block md:space-y-1 md:border-b-0 md:border-r">
          {views.map(({ name, Icon }, index) => (
            <button key={name} type="button" aria-pressed={active === index}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-content-primary hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 aria-pressed:bg-brand-50 aria-pressed:text-brand-800"
              onClick={() => setActive(index)}>
              <Icon size={17} className="shrink-0" aria-hidden="true" />
              {name}
            </button>
          ))}
        </div>
        <div className="min-w-0 p-5 sm:p-7" aria-live="polite">
          <h3 className="font-heading text-xl font-bold">{view.title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-content-secondary">{view.text}</p>
          <dl className="mt-5 grid gap-3 sm:grid-cols-3">
            {view.details.map(([label, value]) => (
              <div key={label} className="min-w-0 rounded-xl border border-border bg-surface-secondary p-3 sm:p-4">
                <dt className="text-xs font-medium text-content-secondary">{label}</dt>
                <dd className="mt-1.5 break-words text-sm font-semibold tabular-nums text-content-primary">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
