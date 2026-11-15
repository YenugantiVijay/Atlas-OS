import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useOrg } from '@/features/organizations/OrgContext';
import { useActionPermission } from '@/hooks/useActionPermission';
import { formatCurrency } from '@/lib/money';
import {
  quotationRateReviewService, type QuotationRateImpact, type RateReviewScope,
  type RateReviewStatus,
} from '@/services/quotation-rate-review.service';

const statusLabels: Record<RateReviewStatus, string> = {
  OPEN: 'Needs review',
  REQUESTED: 'Review requested',
  REVIEWED: 'Reviewed',
};

const rowKey = (row: QuotationRateImpact) => `${row.item_id}:${row.rate_id}`;

interface Props {
  organizationId: string;
  scope: RateReviewScope;
  description?: string;
}

export function QuotationRateReview({ organizationId, scope, description }: Props) {
  const { currentRole } = useOrg();
  const { check } = useActionPermission();
  const canRequest = check('quotations:update').allowed;
  const canReview = canRequest && (currentRole === 'owner' || currentRole === 'admin');
  const { quotationId, rateId } = scope;

  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [rows, setRows] = useState<QuotationRateImpact[]>([]);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    setSaveError('');
    const filter = quotationId ? { quotationId } : { rateId: rateId! };
    void quotationRateReviewService.list(organizationId, filter, page)
      .then((result) => {
        if (!active) return;
        setRows(result.rows);
        setHasNext(result.hasNext);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : 'Could not load rate reviews.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organizationId, quotationId, rateId, page, refresh]);

  const save = async (row: QuotationRateImpact, status: Exclude<RateReviewStatus, 'OPEN'>) => {
    if (saving) return;
    setSaving(rowKey(row));
    setSaveError('');
    try {
      const savedStatus = await quotationRateReviewService.save(organizationId, row, status);
      setRows((current) => current.map((item) =>
        rowKey(item) === rowKey(row) ? { ...item, review_status: savedStatus } : item));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save the review.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface-panel p-4 text-sm"
      aria-label="Quotation rate review">
      <div>
        <h2 className="font-semibold text-content-primary">
          {rateId ? 'Affected quotations' : 'Supplier rate review'}
        </h2>
        {description && <p className="text-xs text-content-secondary">{description}</p>}
      </div>
      {loading && <p role="status" className="text-content-secondary">Checking current supplier rate increases…</p>}
      {loadError && (
        <div>
          <p role="alert" className="mb-2 text-rose-700">{loadError}</p>
          <Button variant="outline" size="sm" onClick={() => setRefresh((value) => value + 1)}>Retry</Button>
        </div>
      )}
      {saveError && <p role="alert" className="text-rose-700">{saveError}</p>}
      {!loading && !loadError && rows.length === 0 && (
        <p className="text-content-secondary">No open quotation lines match this supplier rate increase.</p>
      )}
      {!loading && !loadError && rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={rowKey(row)} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-surface-card p-3">
              <div className="space-y-1">
                {rateId && (
                  <Link className="font-semibold text-atlas-700 underline"
                    to={`/quotations?quotationId=${encodeURIComponent(row.quotation_id)}`}>
                    {row.quotation_number}
                  </Link>
                )}
                <p className="font-semibold text-content-primary">{row.product_name}</p>
                {row.previous_cost !== null && row.current_cost !== null && (
                  <div className="text-xs text-content-secondary">
                    <p>{row.supplier_name} · Unit rate {formatCurrency(row.previous_cost)} → {formatCurrency(row.current_cost)}</p>
                    <p>{row.previous_margin === null || row.current_margin === null
                      ? 'Estimated margin unavailable for this quotation line.'
                      : `Estimated margin before GST ${row.previous_margin}% → ${row.current_margin}%`}</p>
                  </div>
                )}
                <p role="status" className={row.review_status === 'REVIEWED' ? 'text-emerald-700' : 'text-amber-800'}>
                  {statusLabels[row.review_status]}
                </p>
              </div>
              {canReview && row.review_status !== 'REVIEWED' && (
                <Button size="sm" variant="outline" disabled={saving !== null}
                  isLoading={saving === rowKey(row)} onClick={() => void save(row, 'REVIEWED')}>
                  Mark reviewed
                </Button>
              )}
              {!canReview && canRequest && row.review_status === 'OPEN' && (
                <Button size="sm" variant="outline" disabled={saving !== null}
                  isLoading={saving === rowKey(row)} onClick={() => void save(row, 'REQUESTED')}>
                  Request review
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!loading && !loadError && (page > 0 || hasNext) && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={page === 0 || saving !== null}
            onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-xs text-content-secondary">Page {page + 1}</span>
          <Button variant="outline" size="sm" disabled={!hasNext || saving !== null}
            onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </section>
  );
}
