import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ClipboardList,
  Plus,
  Search,
  Trash2,
  ArrowRight,
  Eye,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { ordersService } from '@/services/orders.service';
import { customersService } from '@/services/customers.service';
import { productsService } from '@/services/products.service';
import { Quotation, Product, Customer } from '@/types';
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
import { formatCurrency, calculateLineItem, calculateDocumentTotals, resolveDocumentPresentation } from '@/lib/money';

interface LineItemDraft {
  productId: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
}

export const QuotationsPage: React.FC = () => {
  const { currentOrg, isMockAuth, canWriteOperations } = useOrg();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [viewingQuotation, setViewingQuotation] = useState<Quotation | null>(null);

  // Form
  const [customerId, setCustomerId] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<LineItemDraft[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadData = async () => {
    if (!currentOrg) return;
    setIsLoading(true);
    try {
      const [quotList, custList, prodList] = await Promise.all([
        ordersService.getQuotations(currentOrg.id, isMockAuth),
        customersService.getCustomers(currentOrg.id, isMockAuth),
        productsService.getProducts(currentOrg.id, isMockAuth),
      ]);
      setQuotations(quotList);
      setCustomers(custList);
      setProducts(prodList);
    } catch (err: any) {
      showToast('error', 'Failed to load quotations', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    if (searchParams.get('action') === 'create') {
      handleOpenCreate();
      searchParams.delete('action');
      setSearchParams(searchParams);
    }
  }, [currentOrg, searchParams, isMockAuth]);

  const handleOpenCreate = () => {
    if (!canWriteOperations && !isMockAuth) {
      showToast('error', 'Operation Restricted', 'Write operations are disabled for your current subscription or eligibility status.');
      return;
    }
    setCustomerId(customers[0]?.id || '');
    // Default valid until 15 days from now
    const d = new Date();
    d.setDate(d.getDate() + 15);
    setValidUntil(d.toISOString().split('T')[0]);
    setNotes('');

    if (products.length > 0) {
      setItems([
        {
          productId: products[0].id,
          quantity: 1,
          unitPrice: products[0].sellingPrice,
          discountPercent: 0,
          taxRate: products[0].taxRate,
        },
      ]);
    } else {
      setItems([]);
    }
    setIsCreateModalOpen(true);
  };

  const handleAddItem = () => {
    if (products.length === 0) return;
    setItems((prev) => [
      ...prev,
      {
        productId: products[0].id,
        quantity: 1,
        unitPrice: products[0].sellingPrice,
        discountPercent: 0,
        taxRate: products[0].taxRate,
      },
    ]);
  };

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof LineItemDraft, val: any) => {
    setItems((prev) => {
      const updated = [...prev];
      if (field === 'productId') {
        const prod = products.find((p) => p.id === val);
        updated[index] = {
          ...updated[index],
          productId: val,
          unitPrice: prod?.sellingPrice ?? updated[index].unitPrice,
          taxRate: prod?.taxRate ?? updated[index].taxRate,
        };
      } else {
        updated[index] = { ...updated[index], [field]: val };
      }
      return updated;
    });
  };

  const calculateTotals = () => {
    return calculateDocumentTotals(items);
  };

  const handleSaveQuotation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWriteOperations && !isMockAuth) {
      showToast('error', 'Operation Restricted', 'Write operations are disabled for your current subscription or eligibility status.');
      return;
    }
    if (!customerId) {
      showToast('error', 'Customer Required', 'Please select a customer for the quotation.');
      return;
    }
    if (items.length === 0) {
      showToast('error', 'Line Items Required', 'Please add at least one product item.');
      return;
    }

    if (!currentOrg) return;

    setIsSubmitting(true);
    try {
      const formattedItems = items.map((it) => {
        const prod = products.find((p) => p.id === it.productId);
        return {
          productId: it.productId,
          productName: prod?.name || 'Product',
          productSku: prod?.sku || 'SKU',
          uom: prod?.uom || 'Nos',
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          discountPercent: it.discountPercent,
          taxRate: it.taxRate,
        };
      });

      const q = await ordersService.createQuotation(
        currentOrg.id,
        {
          customerId,
          validUntil,
          notes: notes.trim() || undefined,
          items: formattedItems,
        },
        isMockAuth
      );

      showToast('success', 'Quotation Created', `Quotation ${q.quotationNumber} has been generated.`);
      setIsCreateModalOpen(false);
      await loadData();
    } catch (err: any) {
      showToast('error', 'Failed to Create', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConvertToOrder = async (q: Quotation) => {
    if (!canWriteOperations && !isMockAuth) {
      showToast('error', 'Operation Restricted', 'Write operations are disabled for your current subscription or eligibility status.');
      return;
    }
    if (!currentOrg) return;
    try {
      const order = await ordersService.convertQuotationToOrder(currentOrg.id, q.id, isMockAuth);
      showToast('success', 'Converted to Sales Order', `Sales Order ${order.orderNumber} created from quotation.`);
      await loadData();
    } catch (err: any) {
      showToast('error', 'Conversion Failed', err.message);
    }
  };

  const totals = calculateTotals();

  const filteredQuotations = quotations.filter((q) => {
    const s = searchQuery.toLowerCase();
    return (
      q.quotationNumber.toLowerCase().includes(s) ||
      q.customer?.companyName?.toLowerCase().includes(s) ||
      q.customer?.name.toLowerCase().includes(s)
    );
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              Quotations & Estimates
            </h1>
            <Badge variant="teal" size="sm">
              {quotations.length} Quotations
            </Badge>
          </div>
          <p className="text-sm text-content-secondary mt-1">
            Prepare commercial pricing proposals with line-item discounts, GST computation, and 1-click order conversion.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={handleOpenCreate}
          leftIcon={<Plus className="w-4 h-4" />}
          disabled={!canWriteOperations && !isMockAuth}
          title={!canWriteOperations && !isMockAuth ? 'Write operations are disabled for your account' : undefined}
        >
          Create Quotation
        </Button>
      </div>

      {/* Search */}
      <Card>
        <Input
          placeholder="Search quotations by number, customer, or contractor..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={<Search className="w-4 h-4" />}
          aria-label="Search quotations"
        />
      </Card>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : filteredQuotations.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="w-7 h-7" />}
          title="No quotations found"
          description="Prepare quotation estimates for electrical contractors and institutional buyers."
          actionLabel={!canWriteOperations && !isMockAuth ? undefined : "Create Quotation"}
          onAction={handleOpenCreate}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quotation #</TableHead>
              <TableHead>Customer / Contractor</TableHead>
              <TableHead>Valid Until</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total (Incl. GST)</TableHead>
              <TableHead className="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredQuotations.map((q) => (
              <TableRow key={q.id}>
                <TableCell>
                  <span className="font-mono font-bold text-xs text-atlas-800 bg-atlas-50 px-2 py-0.5 rounded border border-atlas-200/80">
                    {q.quotationNumber}
                  </span>
                  <div className="text-xs text-content-muted mt-1">
                    {new Date(q.createdAt).toLocaleDateString('en-IN')}
                  </div>
                </TableCell>

                <TableCell>
                  <div className="font-semibold text-sm text-content-primary">
                    {q.customer?.companyName || q.customer?.name}
                  </div>
                  {q.customer?.companyName && (
                    <div className="text-xs text-content-secondary mt-0.5">{q.customer.name}</div>
                  )}
                </TableCell>

                <TableCell className="text-xs text-content-secondary font-mono">
                  {q.validUntil}
                </TableCell>

                <TableCell>
                  <Badge
                    variant={
                      q.status === 'CONVERTED'
                        ? 'success'
                        : q.status === 'ACCEPTED'
                        ? 'info'
                        : 'warning'
                    }
                    showDot
                    size="sm"
                  >
                    {q.status}
                  </Badge>
                </TableCell>

                <TableCell className="text-right font-bold text-sm text-content-primary tabular-nums">
                  {formatCurrency(q.totalAmount)}
                </TableCell>

                <TableCell className="text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setViewingQuotation(q)}
                      leftIcon={<Eye className="w-3.5 h-3.5" />}
                    >
                      View
                    </Button>
                    {q.status !== 'CONVERTED' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleConvertToOrder(q)}
                        rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                        disabled={!canWriteOperations && !isMockAuth}
                        title={!canWriteOperations && !isMockAuth ? 'Write operations are disabled for your account' : undefined}
                      >
                        To Order
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Create Quotation Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create Customer Quotation"
        description="Add product SKUs with quantities, discounts, and GST rates."
        maxWidth="3xl"
      >
        <form onSubmit={handleSaveQuotation} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Select Customer"
              required
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              options={customers.map((c) => ({
                value: c.id,
                label: `${c.companyName || c.name} (${c.phone || ''})`,
              }))}
            />
            <Input
              label="Valid Until"
              type="date"
              required
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </div>

          {/* Line items table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-content-secondary">
                Quotation Line Items
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddItem}
                leftIcon={<Plus className="w-3.5 h-3.5" />}
              >
                Add Item
              </Button>
            </div>

            <div className="space-y-2 border border-border rounded-xl p-3 bg-surface-panel/40">
              {items.map((item, idx) => {
                const calc = calculateLineItem(
                  item.quantity,
                  item.unitPrice,
                  item.discountPercent,
                  item.taxRate
                );
                return (
                  <div
                    key={idx}
                    className="flex flex-col sm:flex-row items-center gap-2 p-2 rounded-lg bg-surface-card border border-border/80"
                  >
                    <div className="flex-1 w-full">
                      <select
                        aria-label={`Product ${idx + 1}`}
                        value={item.productId}
                        onChange={(e) => handleItemChange(idx, 'productId', e.target.value)}
                        className="w-full text-xs rounded-lg border border-border bg-surface-card p-1.5 font-medium"
                      >
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.sku}) — ₹{p.sellingPrice}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <div className="w-20">
                        <input
                          type="number"
                          min="1"
                          title="Quantity"
                          value={item.quantity}
                          onChange={(e) =>
                            handleItemChange(idx, 'quantity', parseInt(e.target.value, 10) || 1)
                          }
                          className="w-full text-xs rounded-lg border border-border p-1.5 text-center font-mono"
                          placeholder="Qty"
                        />
                      </div>

                      <div className="w-24">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          title="Unit Price"
                          value={item.unitPrice}
                          onChange={(e) =>
                            handleItemChange(idx, 'unitPrice', parseFloat(e.target.value) || 0)
                          }
                          className="w-full text-xs rounded-lg border border-border p-1.5 text-right font-mono"
                          placeholder="Price"
                        />
                      </div>

                      <div className="w-16">
                        <input
                          type="number"
                          title="Discount %"
                          min="0"
                          max="100"
                          value={item.discountPercent}
                          onChange={(e) =>
                            handleItemChange(idx, 'discountPercent', parseFloat(e.target.value) || 0)
                          }
                          className="w-full text-xs rounded-lg border border-border p-1.5 text-center font-mono"
                          placeholder="Disc %"
                        />
                      </div>

                      <div className="w-24 text-right font-mono text-xs font-bold text-content-primary">
                        {formatCurrency(calc.totalAmount)}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveItem(idx)}
                        className="p-1 text-red-500 hover:bg-red-50 rounded"
                        title="Remove Item"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Totals Summary */}
          <div className="flex flex-col items-end gap-1 pt-2 text-xs">
            <div className="flex justify-between w-64 text-content-secondary">
              <span>Gross Subtotal:</span>
              <span className="font-mono">{formatCurrency(totals.grossSubtotal)}</span>
            </div>
            {totals.discountTotal > 0 && (
              <div className="flex justify-between w-64 text-emerald-600">
                <span>Discount:</span>
                <span className="font-mono">-{formatCurrency(totals.discountTotal)}</span>
              </div>
            )}
            <div className="flex justify-between w-64 text-content-secondary">
              <span>Taxable Amount:</span>
              <span className="font-mono">{formatCurrency(totals.taxableAmount)}</span>
            </div>
            <div className="flex justify-between w-64 text-content-secondary">
              <span>GST Tax Amount:</span>
              <span className="font-mono">{formatCurrency(totals.taxAmount)}</span>
            </div>
            <div className="flex justify-between w-64 font-bold text-sm text-content-primary border-t border-border pt-1">
              <span>Total Payable:</span>
              <span className="font-mono text-atlas-700">{formatCurrency(totals.totalAmount)}</span>
            </div>
          </div>

          <Input
            label="Internal Notes / Commercial Terms"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Prices valid for 15 days. Delivery within 48 hours."
          />

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
              Generate Quotation
            </Button>
          </div>
        </form>
      </Modal>

      {/* View Quotation Detail Modal */}
      {viewingQuotation && (
        <Modal
          isOpen={Boolean(viewingQuotation)}
          onClose={() => setViewingQuotation(null)}
          title={`Quotation ${viewingQuotation.quotationNumber}`}
          description={`Issued to ${viewingQuotation.customer?.companyName || viewingQuotation.customer?.name}`}
          maxWidth="2xl"
        >
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-4 p-3 rounded-xl bg-surface-panel border border-border">
              <div>
                <span className="text-content-muted block text-[10px] uppercase font-semibold">
                  Customer
                </span>
                <span className="font-bold text-content-primary">
                  {viewingQuotation.customer?.companyName || viewingQuotation.customer?.name}
                </span>
                <div className="text-content-secondary">{viewingQuotation.customer?.phone}</div>
                <div className="text-content-secondary">{viewingQuotation.customer?.gstin}</div>
              </div>
              <div>
                <span className="text-content-muted block text-[10px] uppercase font-semibold">
                  Details
                </span>
                <div>Date: {new Date(viewingQuotation.createdAt).toLocaleDateString('en-IN')}</div>
                <div>Valid Until: {viewingQuotation.validUntil}</div>
                <div className="mt-1">
                  Status: <Badge variant="warning" size="sm">{viewingQuotation.status}</Badge>
                </div>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-center">Qty</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">GST</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {viewingQuotation.items?.map((it, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      <div className="font-semibold">{it.productName}</div>
                      <div className="font-mono text-[11px] text-atlas-700">{it.productSku}</div>
                    </TableCell>
                    <TableCell className="text-center font-mono">
                      {it.quantity} {it.uom}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(it.unitPrice)}
                    </TableCell>
                    <TableCell className="text-right font-mono">{it.taxRate}%</TableCell>
                    <TableCell className="text-right font-mono font-bold">
                      {formatCurrency(it.lineTotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Totals Summary */}
            {(() => {
              const presentation = resolveDocumentPresentation(viewingQuotation);
              return (
                <div className="space-y-2 pt-2 border-t border-border">
                  {presentation.statusNotice && (
                    <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200/80 text-amber-900 text-xs leading-relaxed">
                      <div className="font-semibold flex items-center gap-1.5">
                        <span>Notice:</span>
                        <span>{presentation.format === 'UNRESOLVED_HISTORICAL' ? 'Historical Calculation Discrepancy' : 'Historical Document Format'}</span>
                      </div>
                      <p className="mt-0.5 text-amber-800">{presentation.statusNotice}</p>
                    </div>
                  )}
                  <div className="flex flex-col items-end gap-1 text-xs">
                    <div className="flex justify-between w-64 text-content-secondary">
                      <span>{presentation.subtotalLabel}:</span>
                      <span className="font-mono">{formatCurrency(presentation.subtotalAmount)}</span>
                    </div>
                    {presentation.showDiscount && (
                      <div className="flex justify-between w-64 text-emerald-600">
                        <span>{presentation.discountLabel || 'Discount'}:</span>
                        <span className="font-mono">-{formatCurrency(presentation.discountAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between w-64 text-content-secondary">
                      <span>{presentation.taxableLabel}:</span>
                      <span className="font-mono">
                        {formatCurrency(presentation.taxableAmount)}
                      </span>
                    </div>
                    <div className="flex justify-between w-64 text-content-secondary">
                      <span>{presentation.taxLabel}:</span>
                      <span className="font-mono">{formatCurrency(presentation.taxAmount)}</span>
                    </div>
                    <div className="flex justify-between w-64 font-bold text-sm text-content-primary border-t border-border pt-1">
                      <span>{presentation.totalLabel}:</span>
                      <span className="font-mono text-atlas-700">
                        {formatCurrency(presentation.totalAmount)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button variant="outline" onClick={() => setViewingQuotation(null)}>
                Close
              </Button>
              {viewingQuotation.status !== 'CONVERTED' && (
                <Button
                  variant="primary"
                  onClick={() => {
                    handleConvertToOrder(viewingQuotation);
                    setViewingQuotation(null);
                  }}
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                  disabled={!canWriteOperations && !isMockAuth}
                  title={!canWriteOperations && !isMockAuth ? 'Write operations are disabled for your account' : undefined}
                >
                  Convert to Sales Order
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
