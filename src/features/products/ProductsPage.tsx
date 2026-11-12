import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Boxes,
  Plus,
  Search,
  AlertTriangle,
  CheckCircle2,
  Edit2,
  Loader2,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { useActionPermission } from '@/hooks/useActionPermission';
import { productsService } from '@/services/products.service';
import { Product, UOM } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { ImageUpload } from '@/components/ui/ImageUpload';
import { Skeleton } from '@/components/ui/Skeleton';
import { LoadError } from '@/components/ui/LoadError';
import { useToast } from '@/components/ui/Toast';
import { Pagination } from '@/components/ui/Pagination';
import { paginateArray } from '@/lib/pagination';
import { formatCurrency } from '@/lib/money';
import { validateMoneyInput, validateTaxRateInput, parseStrictNumber } from '@/lib/validation';
import { ProductSearchSettings } from './ProductSearchSettings';

const CATEGORIES = [
  'All Categories',
  'Wires & Cables',
  'Switchgear',
  'Modular Switches',
  'Lighting',
  'Distribution Boards',
  'Conduits & Pipes',
  'Fans & Appliances',
];

const UOM_OPTIONS: UOM[] = ['Nos', 'Bags', 'Kg', 'Litres', 'Packs', 'Coils', 'Meters', 'Boxes', 'Bundles', 'Sets', 'Rolls'];

export const ProductsPage: React.FC = () => {
  const { currentOrg, isMockAuth, canWriteOperations } = useOrg();
  const { check } = useActionPermission();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPreparingCreate, setIsPreparingCreate] = useState(false);
  const [pendingOpenCreate, setPendingOpenCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const latestCatalogRequest = useRef(0);
  const [selectedCategory, setSelectedCategory] = useState('All Categories');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'in_stock'>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [searchSettingsProduct, setSearchSettingsProduct] = useState<Product | null>(null);

  // Form Fields
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('Wires & Cables');
  const [uom, setUom] = useState<UOM>('Nos');
  const [purchaseCost, setPurchaseCost] = useState('0');
  const [sellingPrice, setSellingPrice] = useState('0');
  const [taxRate, setTaxRate] = useState('18');
  const [hsnCode, setHsnCode] = useState('');
  const [reorderThreshold, setReorderThreshold] = useState('10');
  const [openingStock, setOpeningStock] = useState('0');
  const [imageUrl, setImageUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeOrgIdRef = useRef(currentOrg?.id);
  useEffect(() => {
    if (currentOrg?.id !== activeOrgIdRef.current) {
      activeOrgIdRef.current = currentOrg?.id;
      // Stale response guard and form reset on organization switch
      setIsCreateModalOpen(false);
      setEditingProduct(null);
      setSearchSettingsProduct(null);
      setSku('');
      setName('');
      setBrand('');
      setPurchaseCost('0');
      setSellingPrice('0');
      setTaxRate('18');
      setHsnCode('');
      setReorderThreshold('10');
      setOpeningStock('0');
      setImageUrl('');
      setPage(1);
    }
  }, [currentOrg?.id]);

  const clearActionParam = useCallback(() => {
    setSearchParams((prev) => {
      const nextParams = new URLSearchParams(prev);
      if (nextParams.has('action')) {
        nextParams.delete('action');
        return nextParams;
      }
      return prev;
    }, { replace: true });
  }, [setSearchParams]);

  const loadProducts = useCallback(async (targetPage = page, targetPageSize = pageSize): Promise<Product[] | null> => {
    if (!currentOrg) return null;
    const orgIdAtCall = currentOrg.id;
    const requestId = ++latestCatalogRequest.current;
    setIsLoading(true);
    setLoadError(null);
    try {
      let res;
      if (typeof productsService.getProductsPaginated === 'function') {
        res = await productsService.getProductsPaginated(
          currentOrg.id,
          {
            page: targetPage,
            pageSize: targetPageSize,
            search: searchQuery,
            category: selectedCategory === 'All Categories' ? undefined : selectedCategory,
          },
          isMockAuth
        );
      } else {
        const data = await productsService.getProducts(currentOrg.id, isMockAuth);
        res = paginateArray(
          data,
          {
            page: targetPage,
            pageSize: targetPageSize,
            search: searchQuery,
            category: selectedCategory === 'All Categories' ? undefined : selectedCategory,
          },
          (p, s) =>
            p.name.toLowerCase().includes(s) ||
            p.sku.toLowerCase().includes(s) ||
            Boolean(p.brand && p.brand.toLowerCase().includes(s)) ||
            p.category.toLowerCase().includes(s)
        );
      }

      if (activeOrgIdRef.current !== orgIdAtCall || requestId !== latestCatalogRequest.current) {
        return null;
      }

      setProducts(res.data);
      setTotalCount(res.totalCount);
      setTotalPages(res.totalPages);
      return res.data;
    } catch (err: any) {
      if (activeOrgIdRef.current !== orgIdAtCall || requestId !== latestCatalogRequest.current) return null;
      const msg = err instanceof Error ? err.message : 'Unable to load products. Check your connection and try again.';
      setLoadError(msg);
      showToast('error', 'Failed to load products', msg);
      return null;
    } finally {
      if (activeOrgIdRef.current === orgIdAtCall && requestId === latestCatalogRequest.current) {
        setIsLoading(false);
      }
    }
  }, [currentOrg, isMockAuth, page, pageSize, searchQuery, selectedCategory, showToast]);

  const handleOpenCreate = useCallback(() => {
    const perm = check('products:create');
    if (!perm.allowed) {
      showToast('error', perm.title || 'Permission Denied', perm.message || 'Write operations are disabled.');
      clearActionParam();
      return;
    }
    setSku('');
    setName('');
    setBrand('');
    setCategory('Wires & Cables');
    setUom('Nos');
    setPurchaseCost('0');
    setSellingPrice('0');
    setTaxRate('18');
    setHsnCode('');
    setReorderThreshold('10');
    setOpeningStock('0');
    setImageUrl('');
    setEditingProduct(null);
    setIsCreateModalOpen(true);
    clearActionParam();
  }, [check, clearActionParam, showToast]);

  const checkRef = useRef(check);
  checkRef.current = check;
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const clearActionParamRef = useRef(clearActionParam);
  clearActionParamRef.current = clearActionParam;
  const handleOpenCreateRef = useRef(handleOpenCreate);
  handleOpenCreateRef.current = handleOpenCreate;
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  useEffect(() => {
    setSearchQuery(searchParams.get('search') || '');
  }, [searchParams]);

  useEffect(() => {
    const params = searchParamsRef.current;
    const requestedAction = params.get('action');

    if (requestedAction === 'create') {
      const perm = checkRef.current('products:create');
      if (!perm.allowed) {
        showToastRef.current('error', perm.title || 'Permission Denied', perm.message || 'Write operations are disabled.');
        clearActionParamRef.current();
        loadProducts();
        return;
      }
      setIsPreparingCreate(true);
    }

    loadProducts().then((res) => {
      setIsPreparingCreate(false);
      if (requestedAction === 'create' && res) {
        handleOpenCreateRef.current();
      }
    });
  }, [loadProducts]);

  useEffect(() => {
    const action = searchParams.get('action');
    if (action === 'create' && !isLoading && !isPreparingCreate) {
      handleOpenCreate();
    }
  }, [searchParams, isLoading, isPreparingCreate, handleOpenCreate]);

  useEffect(() => {
    if (pendingOpenCreate && !isLoading && !loadError) {
      setPendingOpenCreate(false);
      handleOpenCreate();
    }
  }, [pendingOpenCreate, isLoading, loadError, handleOpenCreate]);

  const handleOpenEdit = (p: Product) => {
    const perm = check('products:update');
    if (!perm.allowed) {
      showToast('error', perm.title || 'Permission Denied', perm.message || 'Write operations are disabled.');
      return;
    }
    setEditingProduct(p);
    setSku(p.sku);
    setName(p.name);
    setBrand(p.brand || '');
    setCategory(p.category);
    setUom(p.uom);
    setPurchaseCost(String(p.purchaseCost));
    setSellingPrice(String(p.sellingPrice));
    setTaxRate(String(p.taxRate));
    setHsnCode(p.hsnCode || '');
    setReorderThreshold(String(p.reorderThreshold));
    setImageUrl(p.imageUrl || '');
    setIsCreateModalOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const perm = check(editingProduct ? 'products:update' : 'products:create');
    if (!perm.allowed) {
      showToast('error', perm.title || 'Permission Denied', perm.message || 'Write operations are disabled.');
      return;
    }
    if (!sku.trim() || !name.trim()) {
      showToast('error', 'Validation Error', 'SKU and Product Name are required.');
      return;
    }

    const costVal = validateMoneyInput(purchaseCost, 'Purchase cost', { required: false, allowZero: true });
    if (!costVal.valid) {
      showToast('error', 'Validation Error', costVal.error || 'Invalid purchase cost.');
      return;
    }

    const priceVal = validateMoneyInput(sellingPrice, 'Selling price', { required: false, allowZero: true });
    if (!priceVal.valid) {
      showToast('error', 'Validation Error', priceVal.error || 'Invalid selling price.');
      return;
    }

    const taxVal = validateTaxRateInput(taxRate, 'Tax rate');
    if (!taxVal.valid) {
      showToast('error', 'Validation Error', taxVal.error || 'Invalid tax rate.');
      return;
    }

    const thresholdVal = parseStrictNumber(reorderThreshold, {
      fieldName: 'Reorder threshold',
      integer: true,
      min: 0,
      required: false,
      defaultValue: 10,
    });
    if (!thresholdVal.valid) {
      showToast('error', 'Validation Error', thresholdVal.error || 'Invalid reorder threshold.');
      return;
    }

    let parsedOpening = 0;
    if (!editingProduct) {
      const openingVal = parseStrictNumber(openingStock, {
        fieldName: 'Opening stock',
        integer: true,
        min: 0,
        required: false,
        defaultValue: 0,
      });
      if (!openingVal.valid) {
        showToast('error', 'Validation Error', openingVal.error || 'Invalid opening stock.');
        return;
      }
      parsedOpening = openingVal.value ?? 0;
    }

    if (!currentOrg) return;

    setIsSubmitting(true);
    try {
      if (editingProduct) {
        await productsService.updateProduct(
          currentOrg.id,
          editingProduct.id,
          {
            sku: sku.trim().toUpperCase(),
            name: name.trim(),
            brand: brand.trim() || undefined,
            category,
            uom,
            purchaseCost: costVal.value ?? 0,
            sellingPrice: priceVal.value ?? 0,
            taxRate: taxVal.value ?? 0,
            hsnCode: hsnCode.trim() || undefined,
            reorderThreshold: thresholdVal.value ?? 10,
            imageUrl: imageUrl || undefined,
          },
          isMockAuth
        );
        showToast('success', 'Product Updated', `Successfully updated product ${sku}`);
      } else {
        await productsService.createProduct(
          currentOrg.id,
          {
            sku: sku.trim().toUpperCase(),
            name: name.trim(),
            brand: brand.trim() || undefined,
            category,
            uom,
            purchaseCost: costVal.value ?? 0,
            sellingPrice: priceVal.value ?? 0,
            taxRate: taxVal.value ?? 0,
            hsnCode: hsnCode.trim() || undefined,
            reorderThreshold: thresholdVal.value ?? 10,
            imageUrl: imageUrl || undefined,
            isActive: true,
          },
          isMockAuth,
          parsedOpening
        );
        showToast('success', 'Product Created', `Added ${name} to organization catalog.`);
      }

      setIsCreateModalOpen(false);
      await loadProducts();
    } catch (err: any) {
      showToast('error', 'Action Failed', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.brand?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.hsnCode?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory =
      selectedCategory === 'All Categories' || p.category === selectedCategory;

    const stock = p.currentStock;
    const hasStock = stock !== undefined;
    const matchesStock =
      stockFilter === 'all' ||
      (stockFilter === 'low' && hasStock && stock <= p.reorderThreshold) ||
      (stockFilter === 'in_stock' && hasStock && stock > p.reorderThreshold);

    return matchesSearch && matchesCategory && matchesStock;
  });

  const suggestions = suggestionsOpen && searchQuery.trim().length >= 2 && !isLoading && !loadError
    ? filteredProducts.slice(0, 8) : [];
  const chooseSuggestion = (product: Product) => {
    setSearchQuery(product.sku);
    setPage(1);
    setSuggestionsOpen(false);
    setSuggestionIndex(0);
  };
  const createPermission = check('products:create');

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              Products & Catalog
            </h1>
            <Badge variant="teal" size="sm">
              {totalCount} SKUs
            </Badge>
          </div>
          <p className="text-sm text-content-secondary mt-1">
            Electrical components catalog with HSN codes, GST classification, and real-time inventory balances.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link to="/import-preview"
            className="inline-flex min-h-10 items-center rounded-lg border border-border bg-surface-card px-3.5 text-sm font-medium text-content-primary hover:bg-surface-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-atlas-600">
            BUSY import preview
          </Link>
          <Button
            variant="primary"
            onClick={handleOpenCreate}
            leftIcon={<Plus className="w-4 h-4" />}
            disabled={!createPermission.allowed}
            title={!createPermission.allowed ? createPermission.message : undefined}
          >
            Add Product
          </Button>
        </div>
      </div>

      {/* Preparing Indicator */}
      {(isPreparingCreate || (pendingOpenCreate && isLoading)) && (
        <div role="status" className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-teal-50 border border-teal-200 text-teal-800 text-sm font-medium animate-in fade-in">
          <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
          <span>Preparing product...</span>
        </div>
      )}

      {/* Recoverable Network Error */}
      {loadError && (
        <LoadError
          message={loadError}
          onRetry={() => loadProducts()}
        />
      )}

      {/* Filters & Search */}
      <Card>
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
          <div className="relative flex-1 w-full">
            <Input
              placeholder="Search name, SKU, company, or HSN..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSuggestionsOpen(true);
                setSuggestionIndex(0);
                setPage(1);
              }}
              onFocus={() => { if (searchQuery.trim().length >= 2) setSuggestionsOpen(true); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && suggestions.length) {
                  e.preventDefault();
                  setSuggestionIndex((n) => Math.min(n + 1, suggestions.length - 1));
                } else if (e.key === 'ArrowUp' && suggestions.length) {
                  e.preventDefault();
                  setSuggestionIndex((n) => Math.max(0, n - 1));
                } else if (e.key === 'Enter' && suggestions.length) {
                  e.preventDefault();
                  chooseSuggestion(suggestions[Math.min(suggestionIndex, suggestions.length - 1)]);
                } else if (e.key === 'Escape') {
                  setSuggestionsOpen(false);
                }
              }}
              leftIcon={<Search className="w-4 h-4" />}
              aria-label="Search products"
              autoComplete="off"
              role="combobox"
              aria-expanded={suggestions.length > 0}
              aria-controls="catalog-suggestions"
            />
            {suggestions.length > 0 && (
              <div id="catalog-suggestions" role="listbox" aria-label="Matching catalog products"
                className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                {suggestions.map((p, i) => (
                  <button type="button" role="option" aria-selected={i === suggestionIndex}
                    key={p.id} onClick={() => chooseSuggestion(p)}
                    className={'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-teal-50 ' +
                      (i === suggestionIndex ? 'bg-teal-50' : '')}>
                    <span className="min-w-0">
                      <strong className="block truncate text-slate-800">{p.name}</strong>
                      <span className="block truncate text-xs text-slate-500">{p.sku} · {p.brand || 'No brand'} · {p.uom}</span>
                    </span>
                    <span className="shrink-0 text-right text-xs">
                      <span className="block font-medium text-slate-600">Stock {p.currentStock ?? '—'} {p.uom}</span>
                      <span className="block font-semibold text-teal-700">{formatCurrency(p.sellingPrice)}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {searchQuery.trim().length >= 2 && !suggestions.length && isLoading &&
              <p className="mt-1 text-xs text-slate-500">Searching the current business catalog…</p>}
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full md:w-auto">
            <select
              aria-label="Filter by category"
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value);
                setPage(1);
              }}
              className="w-full sm:w-auto h-10 rounded-lg border border-border bg-surface-card px-3.5 py-2 text-sm font-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 shadow-2xs"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by stock status"
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value as any)}
              className="w-full sm:w-auto h-10 rounded-lg border border-border bg-surface-card px-3.5 py-2 text-sm font-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 shadow-2xs"
            >
              <option value="all">All Stock Statuses</option>
              <option value="low">Low Stock (At/Below Threshold)</option>
              <option value="in_stock">Healthy Stock</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Products Table */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : filteredProducts.length === 0 ? (
        <EmptyState
          icon={<Boxes className="w-7 h-7" />}
          title="No products found"
          description={
            searchQuery || selectedCategory !== 'All Categories'
              ? 'No products match your current search and filter criteria.'
              : 'Your product catalog is empty. Add your first electrical SKU to begin tracking inventory and issuing quotations.'
          }
          actionLabel={!check('products:create').allowed ? undefined : "Add Product"}
          onAction={handleOpenCreate}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU & Details</TableHead>
              <TableHead>Category / Brand</TableHead>
              <TableHead>HSN & GST</TableHead>
              <TableHead className="text-right">Purchase Cost</TableHead>
              <TableHead className="text-right">Selling Price</TableHead>
              <TableHead className="text-right">Available Stock</TableHead>
              <TableHead className="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredProducts.map((p) => {
              const stock = p.currentStock;
              const hasStock = stock !== undefined;
              const isLowStock = hasStock && stock <= p.reorderThreshold;

              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {p.imageUrl ? (
                        <img
                          src={p.imageUrl}
                          alt={p.name}
                          className="w-10 h-10 rounded-lg object-cover border border-slate-200 shadow-xs shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 shrink-0">
                          <Boxes className="w-5 h-5 text-atlas-500" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-content-primary truncate max-w-sm">{p.name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="font-mono text-xs font-semibold text-atlas-700 bg-atlas-50 px-2 py-0.5 rounded border border-atlas-200/80">
                            {p.sku}
                          </span>
                          <span className="text-xs text-content-muted">UOM: {p.uom}</span>
                        </div>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="text-sm font-medium text-content-primary">{p.category}</div>
                    <div className="text-xs text-content-secondary mt-0.5">{p.brand || 'Generic'}</div>
                  </TableCell>

                  <TableCell>
                    <div className="font-mono text-xs text-content-primary font-medium">
                      {p.hsnCode || '—'}
                    </div>
                    <div className="text-xs text-content-secondary mt-0.5">{p.taxRate}% GST</div>
                  </TableCell>

                  <TableCell className="text-right font-medium text-sm text-content-secondary tabular-nums">
                    {formatCurrency(p.purchaseCost)}
                  </TableCell>

                  <TableCell className="text-right font-bold text-sm text-content-primary tabular-nums">
                    {formatCurrency(p.sellingPrice)}
                  </TableCell>

                  <TableCell className="text-right">
                    {hasStock ? (
                      <>
                        <div className="flex items-center justify-end gap-1.5">
                          <span
                            className={`font-bold text-sm tabular-nums ${
                              isLowStock ? 'text-rose-700' : 'text-emerald-700'
                            }`}
                          >
                            {stock.toLocaleString()} {p.uom}
                          </span>
                          {isLowStock ? (
                            <span title={`Below reorder threshold (${p.reorderThreshold})`} className="inline-flex">
                              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" aria-label="Low stock warning" />
                            </span>
                          ) : (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" aria-label="Healthy stock level" />
                          )}
                        </div>
                        <div className="text-xs text-content-muted mt-0.5">
                          Min reorder: {p.reorderThreshold}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-sm font-medium text-content-muted">
                          —
                        </div>
                        <div className="text-xs text-content-muted mt-0.5">
                          Unavailable
                        </div>
                      </>
                    )}
                  </TableCell>

                  <TableCell className="text-center">
                    <div className="flex flex-wrap justify-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenEdit(p)}
                        leftIcon={<Edit2 className="w-3.5 h-3.5" />}
                        disabled={!check('products:update').allowed}
                        title={!check('products:update').allowed ? check('products:update').message : undefined}
                      >
                        Edit
                      </Button>
                      {!isMockAuth && check('products:update').allowed && (
                        <Button variant="ghost" size="sm" onClick={() => setSearchSettingsProduct(p)}
                          aria-label={'Search names and alternatives for ' + p.name}>
                          Search settings
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {searchSettingsProduct && !isMockAuth && check('products:update').allowed &&
        searchSettingsProduct.organizationId === currentOrg?.id && (
          <ProductSearchSettings key={searchSettingsProduct.id} product={searchSettingsProduct}
            onClose={() => setSearchSettingsProduct(null)}
            onAliasesSaved={() => {
              if (activeOrgIdRef.current === searchSettingsProduct.organizationId) void loadProducts();
            }} />
        )}

      {/* Pagination Controls */}
      {filteredProducts.length > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          totalPages={totalPages}
          isLoading={isLoading}
          onPageChange={(newPage) => setPage(newPage)}
          onPageSizeChange={(newPageSize) => {
            setPageSize(newPageSize);
            setPage(1);
          }}
        />
      )}

      {/* Add / Edit Product Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title={editingProduct ? 'Edit Product SKU' : 'Add New Electrical SKU'}
        description="Configure product specifications, tax classification, and inventory thresholds."
        maxWidth="xl"
      >
        <form onSubmit={handleSaveProduct} className="space-y-4">
          <ImageUpload
            label="Product Photo"
            value={imageUrl}
            onChange={setImageUrl}
            shape="square"
            helperText="Upload catalog thumbnail or component image (Optional)"
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="SKU Code"
              required
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="e.g. POL-W-2.5-RD"
            />
            <Input
              label="Brand / Manufacturer"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="e.g. Polycab, Havells, Schneider"
            />
          </div>

          <Input
            label="Product Title & Description"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 2.5 sq mm FR PVC Insulated Copper Wire (90m Red)"
          />

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={CATEGORIES.filter((c) => c !== 'All Categories').map((c) => ({
                value: c,
                label: c,
              }))}
            />
            <Select
              label="Unit of Measurement (UOM)"
              value={uom}
              onChange={(e) => setUom(e.target.value as UOM)}
              options={UOM_OPTIONS.map((u) => ({ value: u, label: u }))}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Purchase Cost (₹)"
              type="number"
              step="0.01"
              required
              value={purchaseCost}
              onChange={(e) => setPurchaseCost(e.target.value)}
            />
            <Input
              label="Selling Price (₹)"
              type="number"
              step="0.01"
              required
              value={sellingPrice}
              onChange={(e) => setSellingPrice(e.target.value)}
            />
            <Input
              label="GST Tax Rate (%)"
              type="number"
              required
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Input
              label="HSN Code"
              value={hsnCode}
              onChange={(e) => setHsnCode(e.target.value)}
              placeholder="e.g. 8544, 8536"
            />
            <Input
              label="Reorder Threshold"
              type="number"
              required
              value={reorderThreshold}
              onChange={(e) => setReorderThreshold(e.target.value)}
            />
            {!editingProduct && (
              <Input
                label="Opening Stock"
                type="number"
                value={openingStock}
                onChange={(e) => setOpeningStock(e.target.value)}
                placeholder="Initial count"
              />
            )}
          </div>

          <div className="flex justify-end gap-2.5 pt-4 border-t border-border mt-5">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsCreateModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              isLoading={isSubmitting}
              disabled={isSubmitting || (!canWriteOperations && !isMockAuth)}
            >
              {editingProduct ? 'Save Changes' : 'Create Product'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
