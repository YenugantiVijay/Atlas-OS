import { useState } from 'react';
import { Boxes, FileSpreadsheet, LayoutDashboard, Receipt, Users } from 'lucide-react';

const views = [
  { name: 'Executive Dashboard', title: 'Recognized Sales (FY)', empty: 'No sales recorded yet.', Icon: LayoutDashboard },
  { name: 'Commercial Invoicing', title: 'Statutory Tax Invoice Details', empty: 'No invoices created yet.', Icon: Receipt },
  { name: 'Multi-UOM Inventory', title: 'Available stock', empty: 'No products added yet.', Icon: Boxes },
  { name: 'Customer Receivables', title: 'Customer balances', empty: 'No customer balances yet.', Icon: Users },
  { name: '1-Click Excel Exports', title: 'Report exports', empty: 'No records available to export.', Icon: FileSpreadsheet },
];

export default function InteractivePreview() {
  const [active, setActive] = useState(0);
  const view = views[active];

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
      <p className="bg-[#142B4D] px-5 py-4 text-sm font-semibold text-white">Atlas OS Desktop Edition Preview</p>
      <div className="flex flex-wrap gap-2 border-b border-border bg-surface-secondary p-3" aria-label="Workspace views">
        {views.map(({ name, Icon }, index) => (
          <button key={name} type="button" aria-pressed={active === index}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-content-primary hover:bg-white aria-pressed:bg-[#142B4D] aria-pressed:text-white"
            onClick={() => setActive(index)}>
            <Icon size={16} aria-hidden="true" />
            {name}
          </button>
        ))}
      </div>
      <div className="grid min-h-48 place-content-center gap-2 px-5 py-8 text-center" aria-live="polite">
        <view.Icon className="mx-auto mb-1 text-brand-700" size={28} aria-hidden="true" />
        <h3 className="font-heading text-lg font-bold">{view.title}</h3>
        <p className="text-sm text-content-secondary">{view.empty}</p>
      </div>
    </div>
  );
}
