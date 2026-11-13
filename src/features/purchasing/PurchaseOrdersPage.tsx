import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useOrg } from '@/features/organizations/OrgContext';
import { useActionPermission } from '@/hooks/useActionPermission';
import { formatDisplayDate } from '@/lib/dates';
import { purchaseOrdersService, type PurchaseOrder } from '@/services/purchase-orders.service';
import { PurchaseOrderEditor } from './PurchaseOrderEditor';

function PurchaseOrderWorkspace({ organizationId, scope, canWrite, writeMessage }: {
  organizationId: string; scope: string; canWrite: boolean; writeMessage?: string;
}) {
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<{ order?: PurchaseOrder } | null>(null);
  const client = useQueryClient();
  const key = ['purchase-orders', scope] as const;
  const orders = useQuery({
    queryKey: [...key, page],
    queryFn: ({ signal }) => purchaseOrdersService.list(organizationId, page, signal),
    staleTime: 0,
  });

  if (editor) {
    return <PurchaseOrderEditor organizationId={organizationId} scope={scope} initial={editor.order} canWrite={canWrite}
      onBack={() => { setEditor(null); void orders.refetch(); }} onChange={() => client.invalidateQueries({ queryKey: key })} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" disabled={orders.isFetching} onClick={() => void orders.refetch()}>Refresh</Button>
        <Button type="button" disabled={!canWrite || !orders.isSuccess} onClick={() => setEditor({})}>New purchase order</Button>
      </div>
      {!canWrite && writeMessage && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{writeMessage}</p>}
      {orders.isPending && <p role="status" className="text-sm text-slate-500">Loading purchase orders…</p>}
      {orders.isError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{orders.error.message}</p>}
      {orders.isSuccess && orders.data.rows.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        {page === 1 ? 'No purchase orders yet.' : 'There are no purchase orders on this page.'}
      </p>}
      {orders.isSuccess && orders.data.rows.length > 0 && <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white" aria-label="Purchase order history">
        {orders.data.rows.map((order) => <article key={order.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <h2 className="break-words font-semibold text-[#142B4D]">{order.order_number ?? 'Draft'} · {order.supplier_name}</h2>
            <p className="text-sm text-slate-600">
              {order.lines.length} {order.lines.length === 1 ? 'product' : 'products'}
              {order.expected_on && ' · Expected ' + formatDisplayDate(order.expected_on)}
              {order.ordered_at && ' · Ordered ' + formatDisplayDate(order.ordered_at)}
              {!order.ordered_at && ' · Updated ' + formatDisplayDate(order.updated_at)}
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" disabled={orders.isFetching} onClick={() => setEditor({ order })}
            aria-label={order.order_number ? 'View ' + order.order_number : 'Open draft for ' + order.supplier_name}>
            {order.status === 'DRAFT' ? 'Open draft' : 'View order'}
          </Button>
        </article>)}
      </div>}
      {(page > 1 || orders.data?.hasNext) && <nav className="flex items-center justify-between gap-2" aria-label="Purchase order pages">
        <Button type="button" size="sm" variant="outline" disabled={page === 1 || orders.isFetching} onClick={() => setPage((value) => value - 1)}>Previous</Button>
        <span className="text-xs text-slate-600">Page {page}</span>
        <Button type="button" size="sm" variant="outline" disabled={!orders.data?.hasNext || orders.isFetching} onClick={() => setPage((value) => value + 1)}>Next</Button>
      </nav>}
    </div>
  );
}

export function PurchaseOrdersPage() {
  const { currentOrg, currentUser, currentRole, isMockAuth } = useOrg();
  const { check } = useActionPermission();
  const read = check('data:read');
  const write = check('inventory:receive');
  const scope = [currentUser?.id, currentOrg?.id, currentRole].join(':');

  return (
    <section className="mx-auto max-w-5xl space-y-4" aria-label="Purchase orders">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#142B4D] sm:text-2xl">Purchase Orders</h1>
          <p className="mt-1 text-sm text-slate-600">Prepare supplier orders and record when they’re placed.</p>
        </div>
        <Link to="/receiving" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50">Goods Receiving</Link>
      </div>
      {isMockAuth ? (
        <p role="status" className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">Sign in to a cloud workspace to use Purchase Orders.</p>
      ) : read.allowed && currentOrg && currentUser ? (
        <PurchaseOrderWorkspace key={scope} scope={scope} organizationId={currentOrg.id} canWrite={write.allowed} writeMessage={write.message} />
      ) : (
        <p role="status" className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">{read.message ?? 'Select a workspace to view purchase orders.'}</p>
      )}
    </section>
  );
}
