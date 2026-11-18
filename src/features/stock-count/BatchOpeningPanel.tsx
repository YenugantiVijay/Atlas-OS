import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
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
      const result = await requireSupabase().rpc('get_stock_batch_opening', {
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
    mutationFn: async ({ id, date, lines, ledgerVersion }: { id: string; date: string; lines: BatchLine[]; ledgerVersion: number }) => {
      const { error } = await requireSupabase().rpc('record_stock_batch_opening', {
        p_org_id: orgId, p_product_id: id, p_counted_on: date, p_lines: lines, p_expected_movement_count: ledgerVersion,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => refetch(),
  });
  const positiveRows = selected?.rows.filter(row => (row.countedQuantity ?? 0) > 0) ?? [];
  const total = positiveRows.reduce((sum, row) => sum + (row.countedQuantity ?? 0), 0);
  const countIssue = selected && (
    selected.rows.some(row => row.status === 'Needs review') ? 'Resolve this product’s flagged rows before saving.' :
    countDate !== getBusinessDate() ? 'Use a physical count dated today to record an opening balance.' :
    positiveRows.length < 1 || positiveRows.length > 1000 ? 'Use one to 1,000 positive batch rows per product.' :
    positiveRows.some(row => !Number.isInteger(row.countedQuantity)) ? 'Opening balances use whole quantities, as required by the stock ledger.' :
    data && total !== data.ledger_quantity ? 'The counted total must match the existing ledger balance.' : ''
  );

  return (
    <details className="rounded-xl border border-border bg-white p-4">
      <summary className="cursor-pointer font-semibold text-content-primary">Opening batch balances</summary>
      <div className="mt-3 space-y-3 text-sm text-content-secondary">
        <p>Allocate a product’s existing stock to its batches and godowns. Include every godown holding that product.</p>
        <div className="max-w-lg">
          <Select label="Product for opening balance" value={selected ? productId : ''} disabled={save.isPending}
            onChange={event => { setProductId(event.target.value); save.reset(); }}
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
        {selected && data?.opening && (
          <>
            <p role="status">Recorded on {data.opening.counted_on} · {data.opening.quantity} {selected.product.uom}.
              {' '}{data.opening.current ? 'Matches the current ledger.' : 'Historical allocation. Stock has moved since this opening was recorded.'}</p>
            <Table aria-label="Recorded opening batch balances">
              <TableHeader><TableRow>
                {['Godown', 'Batch', 'Expiry', 'Opening quantity'].map(heading => <TableHead scope="col" key={heading}>{heading}</TableHead>)}
              </TableRow></TableHeader>
              <TableBody>
                {data.opening.lines.map(line => <TableRow key={JSON.stringify([line.godown, line.batch_number])}>
                  <TableCell>{line.godown}</TableCell>
                  <TableCell>{line.batch_number || '—'}</TableCell>
                  <TableCell>{line.expiry_date ?? 'No expiry'}</TableCell>
                  <TableCell>{line.quantity}</TableCell>
                </TableRow>)}
              </TableBody>
            </Table>
          </>
        )}
        {selected && data && !data.opening && (
          <>
            <p>Counted <strong>{total}</strong> · Ledger balance <strong>{data.ledger_quantity}</strong> {selected.product.uom}</p>
            {countIssue && <p>{countIssue}</p>}
            {canSave && (
              <Button size="sm" isLoading={save.isPending} disabled={!!countIssue || isFetching || !!error}
                onClick={() => save.mutate({
                  id: productId, date: countDate, ledgerVersion: data.ledger_movement_count,
                  lines: positiveRows.map(row => ({
                    godown: row.values.godown, batch_number: row.values.batch, quantity: row.countedQuantity ?? 0,
                    expiry_date: row.expiryText === 'No expiry' ? null : row.expiryText,
                  })),
                })}>Record opening balances</Button>
            )}
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
