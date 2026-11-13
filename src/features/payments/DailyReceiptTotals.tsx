import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { getBusinessDate } from '@/lib/dates';
import { formatCurrency, toPaise } from '@/lib/money';
import { paymentsService } from '@/services/payments.service';

export function DailyReceiptTotals({ organizationId, scope, currency, onClose }: {
  organizationId: string; scope: string; currency: string; onClose: () => void;
}) {
  const [day, setDay] = useState(getBusinessDate);
  const totals = useQuery({
    queryKey: ['daily-payment-receipts', scope, day],
    queryFn: ({ signal }) => paymentsService.getDailyReceiptTotals(organizationId, day, signal),
    enabled: Boolean(day), staleTime: 0,
  });
  return (
    <Modal isOpen onClose={onClose} title="Daily receipt totals" description="Recorded customer payments by method for the selected business date.">
      <div className="space-y-3">
        <label className="block text-sm font-medium">
          Receipt date
          <input type="date" value={day} onChange={(event) => setDay(event.target.value)}
            className="mt-1 block rounded-lg border border-border px-3 py-2" />
        </label>
        {day && totals.isPending && <p role="status" className="text-sm text-content-secondary">Loading receipt totals…</p>}
        {totals.isError && <p role="alert" className="text-sm text-rose-700">{totals.error.message}</p>}
        {day && totals.isSuccess && (totals.data.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="border-b border-border"><tr><th scope="col">Method</th><th scope="col" className="text-right">Receipts</th><th scope="col" className="text-right">Collected</th></tr></thead>
          <tbody className="divide-y divide-border">
            {totals.data.map((total) => <tr key={total.method}>
              <th scope="row" className="py-2 font-normal">{total.method.replace(/_/g, ' ')}</th>
              <td className="text-right">{total.count}</td><td className="whitespace-nowrap text-right">{formatCurrency(total.amount, currency)}</td>
            </tr>)}
          </tbody>
          <tfoot className="border-t border-border font-semibold"><tr><th scope="row" className="py-2">Total</th>
            <td className="text-right">{totals.data.reduce((sum, row) => sum + row.count, 0)}</td>
            <td className="text-right">{formatCurrency(totals.data.reduce((sum, row) => sum + toPaise(row.amount), 0) / 100, currency)}</td>
          </tr></tfoot>
        </table></div> : <p className="text-sm text-content-secondary">No payments recorded for this date.</p>)}
        <Button type="button" size="sm" variant="outline" disabled={!day || totals.isFetching} onClick={() => void totals.refetch()}>Refresh totals</Button>
      </div>
    </Modal>
  );
}
