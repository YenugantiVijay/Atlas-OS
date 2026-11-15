import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { productAlternativesService, type ConfiguredAlternative } from '@/services/product-alternatives.service';
import { productsService } from '@/services/products.service';
import type { Product } from '@/types';

interface Props {
  product: Product;
  onClose: () => void;
  onAliasesSaved: () => void;
}

export function ProductSearchSettings({ product, onClose, onAliasesSaved }: Props) {
  const { organizationId, id } = product;
  const [aliases, setAliases] = useState(product.searchAliases ?? '');
  const [configured, setConfigured] = useState<ConfiguredAlternative[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [term, setTerm] = useState('');
  const [matches, setMatches] = useState<{ term: string; products: Product[] }>({ term: '', products: [] });
  const [searchError, setSearchError] = useState('');
  const [target, setTarget] = useState<Product | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setListError('');
    void productAlternativesService.listConfigured(organizationId, id)
      .then((rows) => { if (active) setConfigured(rows); })
      .catch(() => { if (active) setListError('Could not load approved alternatives.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organizationId, id, revision]);

  useEffect(() => {
    setSearchError('');
    const search = term.trim();
    if (search.length < 2 || target) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void productsService.getProductsPaginated(organizationId, { search, pageSize: 8, isActive: true })
        .then((result) => { if (active) setMatches({ term, products: result.data }); })
        .catch(() => { if (active) setSearchError('Product search is unavailable.'); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [organizationId, term, target]);

  const save = async (action: () => Promise<void>, message: string) => {
    if (saving) return;
    setSaving(true);
    setError('');
    setFeedback('');
    try {
      await action();
      setFeedback(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  };

  const saveAliases = () => save(async () => {
    const normalized = Array.from(new Set(aliases.split('\n').map((alias) => alias.trim()).filter(Boolean))).join('\n');
    await productsService.updateProduct(organizationId, id, { searchAliases: normalized });
    setAliases(normalized);
    onAliasesSaved();
  }, 'Search names saved.');

  const approve = () => {
    if (!target) return;
    return save(async () => {
      await productAlternativesService.approve(organizationId, id, target.id, note);
      setTarget(null);
      setTerm('');
      setNote('');
      setRevision((value) => value + 1);
    }, 'Alternative approved.');
  };

  return (
    <Modal isOpen onClose={onClose} title="Search names and alternatives" description={product.name} maxWidth="xl">
      <div className="space-y-5">
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        {feedback && <p role="status" className="text-sm text-emerald-700">{feedback}</p>}
        <section className="space-y-2">
          <label htmlFor="product-aliases" className="block text-sm font-semibold text-content-primary">Search names</label>
          <p id="product-alias-help" className="text-xs text-content-secondary">Enter one nickname, supplier code or old model number per line.</p>
          <textarea id="product-aliases" aria-describedby="product-alias-help" maxLength={1000} rows={4}
            value={aliases} disabled={saving} onChange={(event) => setAliases(event.target.value)}
            className="w-full rounded-lg border border-border bg-surface-card p-2 text-sm" />
          <Button size="sm" disabled={saving} onClick={() => void saveAliases()}>Save search names</Button>
        </section>

        <section className="space-y-3 border-t border-border pt-4">
          <h2 className="text-sm font-semibold text-content-primary">Approved alternatives</h2>
          {loading && <p role="status" className="text-sm text-content-secondary">Loading alternatives…</p>}
          {listError && (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-rose-700">{listError}</p>
              <Button size="sm" variant="outline" onClick={() => setRevision((value) => value + 1)}>Retry</Button>
            </div>
          )}
          {!loading && !listError && configured.length === 0 && (
            <p className="text-sm text-content-secondary">No approved alternatives yet.</p>
          )}
          {!loading && !listError && configured.length > 0 && (
            <ul className="space-y-2">
              {configured.map((row) => (
                <li key={row.alternative_product_id} className="flex items-start justify-between gap-2 rounded-lg border border-border p-2 text-sm">
                  <div>
                    <strong>{row.product.name} · {row.product.sku}{!row.product.is_active && ' · Inactive'}</strong>
                    <p className="text-xs text-content-secondary">{row.comparison_note}</p>
                  </div>
                  <Button size="sm" variant="ghost" disabled={saving}
                    aria-label={'Remove alternative ' + row.product.name}
                    onClick={() => void save(async () => {
                      await productAlternativesService.remove(organizationId, id, row.alternative_product_id);
                      setRevision((value) => value + 1);
                    }, 'Alternative removed.')}>Remove</Button>
                </li>
              ))}
            </ul>
          )}
          {product.isActive && !listError && (
            <>
              <Input label="Find an alternative product" value={target ? target.name + ' · ' + target.sku : term}
                onChange={(event) => { setTarget(null); setTerm(event.target.value); }} disabled={saving} />
              {searchError && <p role="alert" className="text-sm text-rose-700">{searchError}</p>}
              {!target && matches.term === term && term.trim().length >= 2 && (
                <div aria-label="Alternative product matches" className="max-h-36 overflow-y-auto">
                  {matches.products.filter((candidate) =>
                    candidate.id !== id && !configured.some((row) => row.alternative_product_id === candidate.id),
                  ).map((candidate) => (
                    <button type="button" key={candidate.id} disabled={saving}
                      onClick={() => setTarget(candidate)}
                      className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-atlas-50">
                      {candidate.name} · {candidate.sku} · {candidate.uom}
                    </button>
                  ))}
                </div>
              )}
              {target && (
                <div className="space-y-2">
                  <Input label="Compatibility or specification differences" value={note} maxLength={240}
                    onChange={(event) => setNote(event.target.value)} disabled={saving}
                    placeholder="Same fit and rating. Warranty is 1 year." />
                  <Button size="sm" disabled={saving || note.trim().length < 3}
                    onClick={() => void approve()}>Approve alternative</Button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}
