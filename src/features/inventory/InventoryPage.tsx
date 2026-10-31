import React, { useState, useEffect } from 'react';
import {
  Sliders,
  History,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { inventoryService } from '@/services/inventory.service';
import { productsService } from '@/services/products.service';
import { StockMovement, Product, MovementType } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

export const InventoryPage: React.FC = () => {
  const { currentOrg, isMockAuth } = useOrg();
  const { showToast } = useToast();

  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState('ALL');
  const [selectedType, setSelectedType] = useState('ALL');

  // Adjustment Modal
  const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
  const [adjustProductId, setAdjustProductId] = useState('');
  const [adjustQuantity, setAdjustQuantity] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadData = async () => {
    if (!currentOrg) return;
    setIsLoading(true);
    try {
      const [movs, prods] = await Promise.all([
        inventoryService.getStockMovements(currentOrg.id, undefined, isMockAuth),
        productsService.getProducts(currentOrg.id, isMockAuth),
      ]);
      setMovements(movs);
      setProducts(prods);
    } catch (err: any) {
      showToast('error', 'Failed to load inventory data', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [currentOrg, isMockAuth]);

  const handleOpenAdjustment = () => {
    if (products.length > 0) {
      setAdjustProductId(products[0].id);
    }
    setAdjustQuantity('');
    setAdjustReason('');
    setIsAdjustmentModalOpen(true);
  };

  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseInt(adjustQuantity, 10);
    if (!adjustProductId) {
      showToast('error', 'Product Required', 'Please select a product.');
      return;
    }
    if (isNaN(qty) || qty === 0) {
      showToast('error', 'Invalid Quantity', 'Adjustment quantity cannot be 0.');
      return;
    }
    if (!adjustReason.trim()) {
      showToast('error', 'Reason Required', 'An audit note is required for all manual inventory adjustments.');
      return;
    }

    if (!currentOrg) return;

    setIsSubmitting(true);
    try {
      await inventoryService.adjustStock(
        currentOrg.id,
        adjustProductId,
        qty,
        adjustReason.trim(),
        isMockAuth
      );
      showToast(
        'success',
        'Adjustment Recorded',
        `Recorded inventory adjustment of ${qty > 0 ? '+' : ''}${qty} units.`
      );
      setIsAdjustmentModalOpen(false);
      await loadData();
    } catch (err: any) {
      showToast('error', 'Adjustment Failed', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredMovements = movements.filter((m) => {
    const matchesProduct = selectedProduct === 'ALL' || m.productId === selectedProduct;
    const matchesType = selectedType === 'ALL' || m.movementType === selectedType;
    return matchesProduct && matchesType;
  });

  const getMovementBadge = (type: MovementType) => {
    switch (type) {
      case 'OPENING_STOCK':
        return <Badge variant="info" showDot size="sm">Opening Stock</Badge>;
      case 'GOODS_RECEIVED':
        return <Badge variant="success" showDot size="sm">Goods Received</Badge>;
      case 'SALES_DISPATCH':
        return <Badge variant="danger" showDot size="sm">Sales Dispatch</Badge>;
      case 'RETURN_INWARD':
        return <Badge variant="violet" showDot size="sm">Return Inward</Badge>;
      case 'ADJUSTMENT':
        return <Badge variant="warning" showDot size="sm">Manual Adjustment</Badge>;
      case 'REVERSAL':
        return <Badge variant="default" showDot size="sm">Reversal</Badge>;
      default:
        return <Badge showDot size="sm">{type}</Badge>;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              Inventory Movement Ledger
            </h1>
            <Badge variant="indigo" size="sm">
              Immutable Trail
            </Badge>
          </div>
          <p className="text-sm text-content-secondary mt-1">
            Double-entry stock movements: all additions and deductions are audited and tracked.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={handleOpenAdjustment}
          leftIcon={<Sliders className="w-4 h-4" />}
        >
          Adjust Stock
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="w-full sm:w-1/2">
            <label className="block text-xs font-medium text-content-secondary mb-1.5">
              Filter by Product
            </label>
            <select
              aria-label="Filter by product"
              value={selectedProduct}
              onChange={(e) => setSelectedProduct(e.target.value)}
              className="w-full h-10 rounded-lg border border-border bg-surface-card px-3.5 py-2 text-sm font-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 shadow-2xs"
            >
              <option value="ALL">All Products ({products.length} SKUs)</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku})
                </option>
              ))}
            </select>
          </div>

          <div className="w-full sm:w-1/2">
            <label className="block text-xs font-medium text-content-secondary mb-1.5">
              Filter by Movement Type
            </label>
            <select
              aria-label="Filter by movement type"
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full h-10 rounded-lg border border-border bg-surface-card px-3.5 py-2 text-sm font-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 shadow-2xs"
            >
              <option value="ALL">All Movement Types</option>
              <option value="OPENING_STOCK">Opening Stock</option>
              <option value="GOODS_RECEIVED">Goods Received</option>
              <option value="SALES_DISPATCH">Sales Dispatch</option>
              <option value="ADJUSTMENT">Manual Adjustment</option>
              <option value="RETURN_INWARD">Return Inward</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Movements Table */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : filteredMovements.length === 0 ? (
        <EmptyState
          icon={<History className="w-7 h-7" />}
          title="No stock movements found"
          description="There are no inventory ledger movements matching your selected filters."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date & Time</TableHead>
              <TableHead>Product SKU & Description</TableHead>
              <TableHead>Movement Type</TableHead>
              <TableHead className="text-right">Quantity Change</TableHead>
              <TableHead>Reference Document</TableHead>
              <TableHead>Notes / Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredMovements.map((m) => {
              const isPositive = m.quantityChange > 0;
              return (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-xs text-content-secondary whitespace-nowrap">
                    {new Date(m.createdAt).toLocaleString('en-IN', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </TableCell>

                  <TableCell>
                    <div className="font-semibold text-sm text-content-primary">
                      {m.product?.name || 'Product'}
                    </div>
                    {m.product?.sku && (
                      <span className="font-mono text-xs font-semibold text-atlas-700 bg-atlas-50 px-1.5 py-0.5 rounded border border-atlas-200/80 inline-block mt-0.5">
                        {m.product.sku}
                      </span>
                    )}
                  </TableCell>

                  <TableCell>{getMovementBadge(m.movementType)}</TableCell>

                  <TableCell className="text-right">
                    <span
                      className={`font-bold font-mono text-sm inline-flex items-center gap-0.5 tabular-nums ${
                        isPositive ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {isPositive ? '+' : ''}
                      {m.quantityChange} {m.product?.uom || 'Nos'}
                    </span>
                  </TableCell>

                  <TableCell className="text-xs text-content-secondary">
                    {m.referenceType ? (
                      <Badge variant="default" size="sm">
                        {m.referenceType}
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </TableCell>

                  <TableCell className="text-xs text-content-secondary max-w-xs truncate">
                    {m.notes || '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* Adjustment Modal */}
      <Modal
        isOpen={isAdjustmentModalOpen}
        onClose={() => setIsAdjustmentModalOpen(false)}
        title="Manual Stock Adjustment"
        description="Record verified physical inventory discrepancies. An audit log will be created."
        maxWidth="md"
      >
        <form onSubmit={handleSaveAdjustment} className="space-y-4">
          <Select
            label="Select Product"
            required
            value={adjustProductId}
            onChange={(e) => setAdjustProductId(e.target.value)}
            options={products.map((p) => ({
              value: p.id,
              label: `${p.name} (SKU: ${p.sku}) — Available: ${p.currentStock || 0} ${p.uom}`,
            }))}
          />

          <Input
            label="Quantity Change (+ to add, - to deduct)"
            required
            type="number"
            value={adjustQuantity}
            onChange={(e) => setAdjustQuantity(e.target.value)}
            placeholder="e.g. +10 or -3"
            helperText="Enter positive number for received stock, negative for damaged/missing stock."
          />

          <Input
            label="Reason / Audit Note"
            required
            value={adjustReason}
            onChange={(e) => setAdjustReason(e.target.value)}
            placeholder="e.g. Physical cycle count discrepancy in Peenya warehouse"
          />

          <div className="flex justify-end gap-2.5 pt-4 border-t border-border mt-5">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsAdjustmentModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              Record Adjustment
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
