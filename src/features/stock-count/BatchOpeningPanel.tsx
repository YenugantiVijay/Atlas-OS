import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { supabase } from '@/lib/supabase';
import { getBusinessDate } from '@/lib/dates';
import type { ProductIdentity } from '@/features/import-preview/import-preview';
import type { ReviewRow } from './stock-count';

interface BatchLine {
  godown: string;
  batch_number: string;
  expiry_date: string | null;
  quantity: number;
}

interface OpeningState {
  ledger_quantity: number;
  ledger_movement_count: number;
  approval: {
    id: string; counted_on: string; quantity: number; previous_quantity: number; quarantine_quantity: number;
    expiry_godown: string | null; sellable_quantity: number; current: boolean; lines: BatchLine[];
  } | null;
  opening: { counted_on: string; quantity: number; current: boolean; lines: BatchLine[] } | null;
}

interface BatchOpeningPanelProps {
  orgId: string;
  userId?: string;
  canSave: boolean;
  countDate: string;
  rows: ReviewRow[];
}

function requireSupabase() {
  if (!supabase) throw new Error('Connect to your workspace to use opening batch balances.');
  return supabase;
}

export function BatchOpeningPanel({ orgId, userId, canSave, countDate, rows }: BatchOpeningPanelProps) {
  const [productId, setProductId] = useState('');
  const [expiryGodown, setExpiryGodown] = useState('');
  const [confirmedReview, setConfirmedReview] = useState<{ rows: ReviewRow[]; date: string; version: number; approvalId?: string }>();
  const products = useMemo(() => {
    const groups = new Map<string, { product: ProductIdentity; rows: ReviewRow[] }>();
    for (const row of rows) {
      const product = row.matchedProduct;
      if (!product?.id) continue;
      const existing = groups.get(product.id);
      if (existing) existing.rows.push(row);
      else groups.set(product.id, { product, rows: [row] });
    }
    return groups;
  }, [rows]);
  const selected = products.get(productId);
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ['batch-opening', orgId, userId, productId],
    queryFn: async ({ signal }) => {
      const result = await requireSupabase().rpc('get_stock_count_approval', {
        p_org_id: orgId, p_product_id: productId,
      }).abortSignal(signal);
      if (result.error?.code === 'PGRST202') throw new Error('Opening batch balances are unavailable on this database.');
      if (result.error) throw new Error(result.error.message);
      return result.data as OpeningState;
    },
    enabled: !!selected,
    gcTime: 0,
    retry: false,
  });
  const save = useMutation({
    mutationFn: async ({ id, date, lines, ledgerVersion, approvalId, destination }: {
      id: string; date: string; lines: BatchLine[]; ledgerVersion: number; approvalId?: string | null; destination?: string;
    }) => {
      const params = { p_org_id: orgId, p_product_id: id, p_counted_on: date, p_lines: lines, p_expected_movement_count: ledgerVersion };
      const result = approvalId === undefined
        ? await requireSupabase().rpc('record_stock_batch_opening', params)
        : await requireSupabase().rpc('approve_stock_count', {
            ...params, p_expected_approval_id: approvalId, p_expiry_godown: destination || null,
          });
      if (result.error) throw new Error(result.error.message);
    },
    onSuccess: () => { setConfirmedReview(undefined); return refetch(); },
  });
  const positiveRows = selected?.rows.filter(row => (row.countedQuantity ?? 0) > 0) ?? [];
  const total = positiveRows.reduce((sum, row) => sum + (row.countedQuantity ?? 0), 0);
  const rowsToSave = data?.opening ? selected?.rows ?? [] : positiveRows;
  const expiredQuantity = positiveRows.reduce((sum, row) => sum + (row.status === 'Expired' ? row.countedQuantity ?? 0 : 0), 0);
  const destination = expiryGodown.trim() || data?.approval?.expiry_godown || '';
  const countIssue = selected && (
    selected.rows.some(row => row.status === 'Needs review') ? 'Resolve this product’s flagged rows before saving.' :
    countDate !== getBusinessDate() ? 'Use a physical count dated today.' :
    rowsToSave.length < 1 || rowsToSave.length > 1000 ? 'Use one to 1,000 count rows per product.' :
    positiveRows.some(row => !Number.isInteger(row.countedQuantity)) ? 'Use whole quantities, as required by the stock ledger.' :
    !data?.opening && data && total !== data.ledger_quantity ? 'The opening total must match the existing ledger balance.' :
    data?.opening && expiredQuantity > 0 && !destination ? 'Enter a separate expiry godown.' : ''
  );
  const recorded = data?.approval ?? data?.opening;
  const confirmed = confirmedReview?.rows === rows && confirmedReview.date === countDate &&
    confirmedReview.version === data?.ledger_movement_count && confirmedReview.approvalId === data?.approval?.id;

  return (
    <details className="rounded-xl border border-border bg-white p-4">
      <summary className="cursor-pointer font-semibold text-content-primary">Batch balances and count approval</summary>
      <div className="mt-3 space-y-3 text-sm text-content-secondary">
        <p>Record the opening allocation, then approve full-product counts and move expired stock to an expiry godown.</p>
        <div className="max-w-lg">
          <Select label="Product for batch balances" value={selected ? productId : ''} disabled={save.isPending}
            onChange={event => { setProductId(event.target.value); setExpiryGodown(''); setConfirmedReview(undefined); save.reset(); }}
            options={[
              { value: '', label: 'Select a matched product' },
              ...Array.from(products, ([id, { product }]) => ({ value: id, label: `${product.name} · ${product.sku}` })),
            ]} />
        </div>
        {selected && isFetching && <p role="status">Checking the stock ledger…</p>}
        {selected && error && (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert">{error.message}</p>
            <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching}>Retry ledger check</Button>
          </div>
        )}
        {selected && recorded && (
          <>
            <p role="status">Recorded on {recorded.counted_on} · {recorded.quantity} {selected.product.uom}.
              {' '}{recorded.current ? 'Matches the current ledger.' : 'Historical allocation. Stock has moved since this count was recorded.'}</p>
            <Table aria-label="Recorded batch balances">
              <TableHeader><TableRow>
                {['Godown', 'Batch', 'Expiry', 'Recorded quantity'].map(heading => <TableHead scope="col" key={heading}>{heading}</TableHead>)}
              </TableRow></TableHeader>
              <TableBody>
                {recorded.lines.map(line => <TableRow key={JSON.stringify([line.godown, line.batch_number])}>
                  <TableCell>{line.godown}</TableCell>
                  <TableCell>{line.batch_number || '—'}</TableCell>
                  <TableCell>{line.expiry_date ?? 'No expiry'}</TableCell>
                  <TableCell>{line.quantity}</TableCell>
                </TableRow>)}
              </TableBody>
            </Table>
          </>
        )}
        {selected && data?.approval && (
          <p>Sellable <strong>{data.approval.sellable_quantity}</strong> · In expiry godown <strong>{data.approval.quarantine_quantity}</strong> {selected.product.uom}</p>
        )}
        {selected && data && canSave && (
          <>
            <p>Counted <strong>{total}</strong> · Ledger balance <strong>{data.ledger_quantity}</strong> {selected.product.uom}</p>
            {data.opening && <>
              <p>Stock adjustment <strong>{total - data.ledger_quantity}</strong> · Expired count <strong>{expiredQuantity}</strong></p>
              {expiredQuantity > 0 && <Input label="Expiry godown" value={expiryGodown}
                placeholder={data.approval?.expiry_godown ?? undefined} maxLength={255} disabled={save.isPending}
                onChange={event => { setExpiryGodown(event.target.value); setConfirmedReview(undefined); }} />}
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1"
                checked={confirmed} onChange={event => setConfirmedReview(event.target.checked
                  ? { rows, date: countDate, version: data.ledger_movement_count, approvalId: data.approval?.id }
                  : undefined)} />
                <span>I verified this product’s full physical count across all godowns{expiredQuantity > 0 ? ' and moved the expired stock to the expiry godown.' : '.'}</span>
              </label>
            </>}
            {countIssue && <p>{countIssue}</p>}
            <Button size="sm" isLoading={save.isPending}
              disabled={!!countIssue || isFetching || !!error || (!!data.opening && !confirmed)}
              onClick={() => save.mutate({
                id: productId, date: countDate, ledgerVersion: data.ledger_movement_count,
                approvalId: data.opening ? data.approval?.id ?? null : undefined, destination,
                lines: rowsToSave.map(row => ({
                  godown: row.values.godown, batch_number: row.values.batch, quantity: row.countedQuantity ?? 0,
                  expiry_date: row.expiryText === 'No expiry' ? null : row.expiryText,
                })),
              })}>{data.opening ? 'Approve count' : 'Record opening balances'}</Button>
          </>
        )}
        {save.error && <div className="flex flex-wrap items-center gap-3">
          <p role="alert">{save.error.message}</p>
          <Button size="sm" variant="outline" disabled={isFetching} onClick={() => { save.reset(); void refetch(); }}>
            Refresh ledger
          </Button>
        </div>}
      </div>
    </details>
  );
}
