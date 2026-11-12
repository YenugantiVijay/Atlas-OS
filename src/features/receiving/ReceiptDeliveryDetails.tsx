import type { ReceiptDeliveryLine } from '@/services/goods-receiving.service';
import { receiptDeliveryCounts } from './receiving-worksheet';

export function ReceiptDeliveryDetails({ invoice, lines }: { invoice: string; lines: ReceiptDeliveryLine[] }) {
  return (
    <div className="mt-2 max-w-full overflow-x-auto rounded-lg border border-slate-200">
      <table aria-label={'Delivery details for ' + invoice} className="w-full min-w-[600px] text-left text-xs tabular-nums">
        <thead className="bg-slate-50 text-slate-600">
          <tr>{['Product', 'Billed', 'Received', 'Damaged', 'Usable', 'Missing', 'Extra'].map((label) =>
            <th key={label} scope="col" className="px-2 py-2">{label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((line) => {
            const counts = receiptDeliveryCounts(line.totalUnits, line.billedUnits, line.damagedUnits);
            return <tr key={line.productId}>
              <th scope="row" className="px-2 py-2 font-medium">{line.productName} · {line.sku}</th>
              {[counts.billedUnits, line.totalUnits, counts.damagedUnits, counts.usableUnits,
                counts.billedUnits === null ? null : counts.missingUnits,
                counts.billedUnits === null ? null : counts.excessUnits,
              ].map((quantity, index) => <td key={index} className="px-2 py-2">{quantity?.toLocaleString('en-IN') ?? '—'}</td>)}
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}
