import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { useOrg } from '@/features/organizations/OrgContext';
import { useActionPermission } from '@/hooks/useActionPermission';
import { formatDisplayDate } from '@/lib/dates';
import { goodsReceiptFollowUpService, type FollowUpCursor } from '@/services/goods-receipt-follow-up.service';
import type { Role } from '@/types';
import { ReceiptDeliveryDetails } from './ReceiptDeliveryDetails';

interface QueueProps {
  organizationId: string;
  userId: string;
  role: Role | null;
  canResolve: boolean;
  resolveMessage?: string;
}

function FollowUpQueue({ organizationId, userId, role, canResolve, resolveMessage }: QueueProps) {
  const [resolved, setResolved] = useState(false);
  const [cursors, setCursors] = useState<FollowUpCursor[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState('');
  const queryClient = useQueryClient();
  const queryKey = ['goods-receipt-follow-ups', userId, organizationId, role] as const;
  const after = cursors[cursors.length - 1];
  const list = useQuery({
    queryKey: [...queryKey, resolved, after],
    queryFn: ({ signal }) => goodsReceiptFollowUpService.list(organizationId, resolved, after, signal),
    staleTime: 0,
  });
  const resolution = useMutation({
    mutationFn: ({ receiptId, resolutionNote }: { receiptId: string; invoice: string; resolutionNote: string }) =>
      goodsReceiptFollowUpService.resolve(organizationId, receiptId, resolutionNote),
    onSuccess: async (_, { invoice }) => {
      setEditing(null);
      setNote('');
      setNotice('Follow-up resolved for ' + invoice + '.');
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  const closeEditor = () => {
    setEditing(null);
    setNote('');
    resolution.reset();
  };

  const switchView = (next: boolean) => {
    if (next === resolved) return;
    closeEditor();
    setNotice('');
    setCursors([]);
    setResolved(next);
  };

  const changePage = (next: FollowUpCursor[]) => {
    closeEditor();
    setCursors(next);
  };

  const next = list.data?.next;
  const noteReady = note.trim().length >= 3;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2" role="group" aria-label="Follow-up status">
          <Button type="button" size="sm" variant={resolved ? 'outline' : 'secondary'} aria-pressed={!resolved}
            disabled={resolution.isPending} onClick={() => switchView(false)}>Open</Button>
          <Button type="button" size="sm" variant={resolved ? 'secondary' : 'outline'} aria-pressed={resolved}
            disabled={resolution.isPending} onClick={() => switchView(true)}>Resolved</Button>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={list.isFetching || resolution.isPending}
          onClick={() => void list.refetch()}>Refresh</Button>
      </div>
      {!resolved && !canResolve && resolveMessage && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{resolveMessage}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {list.isPending && <p role="status" className="text-sm text-slate-500">Loading supplier follow-ups…</p>}
      {list.isError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{list.error.message}</p>}
      {list.isSuccess && list.data.rows.length === 0 && (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          {cursors.length > 0 ? 'There are no follow-ups on this page.' : resolved ? 'No resolved supplier follow-ups yet.' : 'No open supplier follow-ups.'}
        </p>
      )}
      {list.isSuccess && list.data.rows.map((entry) => {
        const receiptId = entry.receipt_id;
        const invoice = entry.supplier_invoice_number;
        const isEditing = canResolve && editing === receiptId;
        return (
          <article key={receiptId} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby={'follow-up-' + receiptId}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id={'follow-up-' + receiptId} className="break-words font-semibold text-[#142B4D]">{invoice}</h2>
                <p className="break-words text-sm text-slate-600">{entry.supplier_name} · Received {formatDisplayDate(entry.received_on)}</p>
              </div>
              {!resolved && canResolve && !isEditing && (
                <Button type="button" size="sm" variant="outline" disabled={resolution.isPending} onClick={() => {
                  closeEditor();
                  setNotice('');
                  setEditing(receiptId);
                }}>Record resolution</Button>
              )}
            </div>
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-teal-800">
                View delivery details · {entry.lines.length} affected {entry.lines.length === 1 ? 'product' : 'products'}
              </summary>
              <ReceiptDeliveryDetails invoice={invoice} lines={entry.lines} />
            </details>
            {resolved && <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-semibold">Resolved {formatDisplayDate(entry.resolved_at)}</p>
              <p className="whitespace-pre-wrap break-words">{entry.resolution_note}</p>
            </div>}
            {isEditing && <form className="space-y-2 border-t border-slate-100 pt-3" onSubmit={(event) => {
              event.preventDefault();
              if (noteReady && !resolution.isPending) resolution.mutate({ receiptId, invoice, resolutionNote: note.trim() });
            }}>
              <label htmlFor={'resolution-note-' + receiptId} className="block text-sm font-medium text-slate-700">Resolution note</label>
              <textarea id={'resolution-note-' + receiptId} value={note} onChange={(event) => setNote(event.target.value)}
                maxLength={500} rows={3} required autoFocus disabled={resolution.isPending}
                placeholder="What did the supplier do? Include a reference if available."
                className="w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600" />
              {resolution.isError && <p role="alert" className="text-sm text-rose-800">{resolution.error.message}</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" isLoading={resolution.isPending} disabled={!noteReady}>Mark resolved</Button>
                <Button type="button" size="sm" variant="ghost" disabled={resolution.isPending} onClick={closeEditor}>Cancel</Button>
              </div>
            </form>}
          </article>
        );
      })}
      {(cursors.length > 0 || next) && <nav aria-label="Supplier follow-up pages" className="flex items-center justify-between gap-2">
        <Button type="button" size="sm" variant="outline" disabled={cursors.length === 0 || list.isFetching || resolution.isPending}
          onClick={() => changePage(cursors.slice(0, -1))}>Previous</Button>
        <span className="text-xs text-slate-500">Page {cursors.length + 1}</span>
        <Button type="button" size="sm" variant="outline" disabled={!next || list.isFetching || resolution.isPending}
          onClick={() => next && changePage([...cursors, next])}>Next</Button>
      </nav>}
    </div>
  );
}

export function SupplierFollowUpPage() {
  const { currentOrg, currentUser, currentRole, isMockAuth } = useOrg();
  const { check } = useActionPermission();
  const read = check('data:read');
  const resolve = check('inventory:receive');
  return (
    <section className="mx-auto max-w-5xl space-y-4" aria-label="Supplier follow-up">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#142B4D] sm:text-2xl">Supplier Follow-up</h1>
          <p className="mt-1 text-sm text-slate-600">Track missing, damaged and extra units from posted deliveries.</p>
        </div>
        <Link to="/receiving" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50">Back to Goods Receiving</Link>
      </div>
      {isMockAuth ? (
        <p role="status" className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">Sign in to a cloud workspace to see supplier follow-ups.</p>
      ) : read.allowed && currentOrg && currentUser ? (
        <FollowUpQueue key={currentUser.id + ':' + currentOrg.id + ':' + currentRole} organizationId={currentOrg.id}
          userId={currentUser.id} role={currentRole} canResolve={resolve.allowed} resolveMessage={resolve.message} />
      ) : (
        <p role="status" className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">{read.message ?? 'Select a workspace to view supplier follow-ups.'}</p>
      )}
    </section>
  );
}
