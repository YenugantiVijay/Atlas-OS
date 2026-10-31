import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Boxes,
  Plus,
  Search,
  AlertTriangle,
  CheckCircle2,
  Edit2,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
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
import { useToast } from '@/components/ui/Toast';
import { formatCurrency } from '@/lib/money';

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

const UOM_OPTIONS: UOM[] = ['Nos', 'Coils', 'Meters', 'Boxes', 'Bundles', 'Sets', 'Rolls'];

export const ProductsPage: React.FC = () => {
  const { currentOrg, isMockAuth, canWriteOperations } = useOrg();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All Categories');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'in_stock'>('all');

  // Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Form Fields
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState('Wires & Cables');
  const [uom, setUom] = useState<UOM>('Nos');
  const [purchaseCost, setPurchaseCost] = useState('0');
  const [sellingPrice, setSellingPrice] = useState('0');
  const [taxRate, setTaxRate] = useState('18');
  const [hsnCode, setHsnCode] = useState('8544');
  const [reorderThreshold, setReorderThreshold] = useState('10');
  const [openingStock, setOpeningStock] = useState('0');
  const [imageUrl, setImageUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadProducts = async () => {
    if (!currentOrg) return;
    setIsLoading(true);
    try {
      const data = await productsService.getProducts(currentOrg.id, isMockAuth);
      setProducts(data);
    } catch (err: any) {
      showToast('error', 'Failed to load products', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProducts();
    if (searchParams.get('action') === 'create') {
      setIsCreateModalOpen(true);
      searchParams.delete('action');
      setSearchParams(searchParams);
    }
  }, [currentOrg, searchParams, isMockAuth]);

  const handleOpenCreate = () => {
    if (!canWriteOperations && !isMockAuth) {
      showToast('error', 'Operation Restricted', 'Write operations are disabled for your current subscription or eligibility status.');
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
    setHsnCode('8544');
    setReorderThreshold('10');
    setOpeningStock('0');
    setImageUrl('');
    setEditingProduct(null);
    setIsCreateModalOpen(true);
  };

  const handleOpenEdit = (p: Product) => {
    if (!canWriteOperations && !isMockAuth) {
      showToast('error', 'Operation Restricted', 'Write operations are disabled for your current subscription or eligibility status.');
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
    if (!canWriteOperations && !isMockAuth) {
      showToast('error', 'Operation Restricted', 'Write operations are disabled for your current subscription or eligibility status.');
      return;
    }
    if (!sku.trim() || !name.trim()) {
      showToast('error', 'Validation Error', 'SKU and Product Name are required.');
      return;
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
            purchaseCost: parseFloat(purchaseCost) || 0,
            sellingPrice: parseFloat(sellingPrice) || 0,
            taxRate: parseFloat(taxRate) || 0,
            hsnCode: hsnCode.trim() || undefined,
            reorderThreshold: parseInt(reorderThreshold, 10) || 0,
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
            purchaseCost: parseFloat(purchaseCost) || 0,
            sellingPrice: parseFloat(sellingPrice) || 0,
            taxRate: parseFloat(taxRate) || 0,
            hsnCode: hsnCode.trim() || undefined,
            reorderThreshold: parseInt(reorderThreshold, 10) || 0,
            imageUrl: imageUrl || undefined,
            isActive: true,
          },
          isMockAuth,
          parseInt(openingStock, 10) || 0
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
      p.brand?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory =
      selectedCategory === 'All Categories' || p.category === selectedCategory;

    const stock = p.currentStock || 0;
    const matchesStock =
      stockFilter === 'all' ||
      (stockFilter === 'low' && stock <= p.reorderThreshold) ||
      (stockFilter === 'in_stock' && stock > p.reorderThreshold);

    return matchesSearch && matchesCategory && matchesStock;
  });

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
              {products.length} SKUs
            </Badge>
          </div>
          <p className="text-sm text-content-secondary mt-1">
            Electrical components catalog with HSN codes, GST classification, and real-time inventory balances.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={handleOpenCreate}
          leftIcon={<Plus className="w-4 h-4" />}
          disabled={!canWriteOperations && !isMockAuth}
          title={!canWriteOperations && !isMockAuth ? 'Write operations are disabled for your account' : undefined}
        >
          Add Product
        </Button>
      </div>

      {/* Filters & Search */}
      <Card>
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
          <div className="flex-1 w-full">
            <Input
              placeholder="Search by product name, SKU, or manufacturer brand..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leftIcon={<Search className="w-4 h-4" />}
              aria-label="Search products"
            />
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full md:w-auto">
            <select
              aria-label="Filter by category"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
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
          actionLabel="Add Product"
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
              const stock = p.currentStock || 0;
              const isLowStock = stock <= p.reorderThreshold;

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
                  </TableCell>

                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenEdit(p)}
                      leftIcon={<Edit2 className="w-3.5 h-3.5" />}
                      disabled={!canWriteOperations && !isMockAuth}
                      title={!canWriteOperations && !isMockAuth ? 'Write operations are disabled for your account' : undefined}
                    >
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
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
              placeholder="e.g. 8544"
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
