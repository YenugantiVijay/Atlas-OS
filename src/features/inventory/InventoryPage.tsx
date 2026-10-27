import React, { useState, useEffect } from 'react';
import {
  Sliders,
  History,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { storage } from '@/lib/storage';
import { StockMovement, Product, MovementType } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';

export const InventoryPage: React.FC = () => {
  const { currentOrg } = useOrg();
  const { showToast } = useToast();

  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState('ALL');
  const [selectedType, setSelectedType] = useState('ALL');

  // Adjustment Modal
  const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
  const [adjustProductId, setAdjustProductId] = useState('');
  const [adjustQuantity, setAdjustQuantity] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadData = () => {
    if (currentOrg) {
      setMovements(storage.getStockMovements(currentOrg.id));
      setProducts(storage.getProducts(currentOrg.id));
    }
  };

  useEffect(() => {
    loadData();
  }, [currentOrg]);

  const handleOpenAdjustment = () => {
    if (products.length > 0) {
      setAdjustProductId(products[0].id);
    }
    setAdjustQuantity('');
    setAdjustReason('');
    setIsAdjustmentModalOpen(true);
  };

  const handleSaveAdjustment = (e: React.FormEvent) => {
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
      storage.adjustStock(currentOrg.id, adjustProductId, qty, adjustReason.trim());
      showToast('success', 'Adjustment Recorded', `Recorded inventory adjustment of ${qty > 0 ? '+' : ''}${qty} units.`);
      setIsAdjustmentModalOpen(false);
      loadData();
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
        return <Badge variant="info" size="sm">Opening Stock</Badge>;
      case 'GOODS_RECEIVED':
        return <Badge variant="success" size="sm">Goods Received</Badge>;
      case 'SALES_DISPATCH':
        return <Badge variant="danger" size="sm">Sales Dispatch</Badge>;
      case 'RETURN_INWARD':
        return <Badge variant="violet" size="sm">Return Inward</Badge>;
      case 'ADJUSTMENT':
        return <Badge variant="warning" size="sm">Manual Adjustment</Badge>;
      case 'REVERSAL':
        return <Badge variant="default" size="sm">Reversal</Badge>;
      default:
        return <Badge size="sm">{type}</Badge>;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              Inventory Movement Ledger
            </h1>
            <Badge variant="violet" size="sm">
              Immutable Trail
            </Badge>
          </div>
          <p className="text-xs text-content-secondary mt-0.5">
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
            <label className="block text-[11px] font-semibold text-content-secondary mb-1">
              Filter by Product
            </label>
            <select
              value={selectedProduct}
              onChange={(e) => setSelectedProduct(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-card px-3 py-2 text-xs font-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-atlas-100"
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
            <label className="block text-[11px] font-semibold text-content-secondary mb-1">
              Filter by Movement Type
            </label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-card px-3 py-2 text-xs font-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-atlas-100"
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
      {filteredMovements.length === 0 ? (
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
                    <div className="font-semibold text-content-primary">
                      {m.product?.name || 'Product'}
                    </div>
                    <div className="font-mono text-xs text-atlas-700">
                      {m.product?.sku}
                    </div>
                  </TableCell>

                  <TableCell>{getMovementBadge(m.movementType)}</TableCell>

                  <TableCell className="text-right">
                    <span
                      className={`font-bold font-mono text-sm inline-flex items-center gap-0.5 ${
                        isPositive ? 'text-emerald-600' : 'text-red-600'
                      }`}
                    >
                      {isPositive ? '+' : ''}
                      {m.quantityChange} {m.product?.uom || 'Nos'}
                    </span>
                  </TableCell>

                  <TableCell className="text-xs text-content-secondary">
                    {m.referenceType ? (
                      <span className="font-medium">
                        {m.referenceType}
                      </span>
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
