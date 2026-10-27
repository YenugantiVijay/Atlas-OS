import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  FileText,
  Plus,
  Search,
  CheckCircle2,
  Eye,
  Receipt,
  Trash2,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { storage } from '@/lib/storage';
import { SalesOrder, Customer, Product, OrderStatus } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency, calculateLineItem } from '@/lib/money';

interface LineItemDraft {
  productId: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
}

export const OrdersPage: React.FC = () => {
  const { currentOrg, currentRole } = useOrg();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | OrderStatus>('ALL');

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [viewingOrder, setViewingOrder] = useState<SalesOrder | null>(null);

  // Form State
  const [customerId, setCustomerId] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<LineItemDraft[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadData = () => {
    if (currentOrg) {
      setOrders(storage.getSalesOrders(currentOrg.id));
      setCustomers(storage.getCustomers(currentOrg.id));
      setProducts(storage.getProducts(currentOrg.id));
    }
  };

  useEffect(() => {
    loadData();
    if (searchParams.get('action') === 'create') {
      handleOpenCreate();
      searchParams.delete('action');
      setSearchParams(searchParams);
    }
  }, [currentOrg, searchParams]);

  const handleOpenCreate = () => {
    const custs = storage.getCustomers(currentOrg?.id || '');
    const prods = storage.getProducts(currentOrg?.id || '');

    setCustomerId(custs[0]?.id || '');
    setOrderDate(new Date().toISOString().split('T')[0]);
    setNotes('');

    if (prods.length > 0) {
      setItems([
        {
          productId: prods[0].id,
          quantity: 1,
          unitPrice: prods[0].sellingPrice,
          discountPercent: 0,
          taxRate: prods[0].taxRate,
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
          unitPrice: prod?.sellingPrice || updated[index].unitPrice,
          taxRate: prod?.taxRate || updated[index].taxRate,
        };
      } else {
        updated[index] = { ...updated[index], [field]: val };
      }
      return updated;
    });
  };

  const calculateTotals = () => {
    let subtotal = 0;
    let tax = 0;
    let total = 0;

    items.forEach((it) => {
      const c = calculateLineItem(it.quantity, it.unitPrice, it.discountPercent, it.taxRate);
      subtotal += c.taxableAmount;
      tax += c.taxAmount;
      total += c.totalAmount;
    });

    return { subtotal, tax, total };
  };

  const handleSaveOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId) {
      showToast('error', 'Customer Required', 'Please select a customer for the order.');
      return;
    }
    if (items.length === 0) {
      showToast('error', 'Items Required', 'At least one line item is required.');
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

      const order = storage.createSalesOrder(currentOrg.id, {
        customerId,
        orderDate,
        notes: notes.trim() || undefined,
        items: formattedItems,
      });

      showToast('success', 'Order Created', `Order ${order.orderNumber} saved as Draft.`);
      setIsCreateModalOpen(false);
      loadData();
    } catch (err: any) {
      showToast('error', 'Failed to Create', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * ATOMIC ORDER CONFIRMATION
   * Validates available stock, prevents overselling, writes movements, updates status.
   */
  const handleConfirmOrder = (order: SalesOrder) => {
    if (!currentOrg) return;
    try {
      storage.confirmSalesOrder(currentOrg.id, order.id, currentRole);
      showToast(
        'success',
        'Order Confirmed & Stock Deducted',
        `Sales Order ${order.orderNumber} confirmed. Stock movements created in ledger.`
      );
      loadData();
      if (viewingOrder?.id === order.id) {
        setViewingOrder(null);
      }
    } catch (err: any) {
      showToast('error', 'Confirmation Rejected', err.message);
    }
  };

  const handleCreateInvoice = (order: SalesOrder) => {
    if (!currentOrg) return;
    try {
      const inv = storage.createInvoiceFromOrder(currentOrg.id, order.id);
      showToast('success', 'Invoice Generated', `Generated Tax Invoice ${inv.invoiceNumber} for ${order.orderNumber}.`);
      navigate('/invoices');
    } catch (err: any) {
      showToast('error', 'Invoicing Failed', err.message);
    }
  };

  const totals = calculateTotals();

  const filteredOrders = orders.filter((o) => {
    const s = searchQuery.toLowerCase();
    const matchesSearch =
      o.orderNumber.toLowerCase().includes(s) ||
      o.customer?.companyName?.toLowerCase().includes(s) ||
      o.customer?.name.toLowerCase().includes(s);

    const matchesStatus = statusFilter === 'ALL' || o.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              Sales Orders
            </h1>
            <Badge variant="violet" size="sm">
              {orders.length} Orders
            </Badge>
          </div>
          <p className="text-xs text-content-secondary mt-0.5">
            Atomic lifecycle management: Draft → Confirmed (stock verification & deduction) → Invoiced.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={handleOpenCreate}
          leftIcon={<Plus className="w-4 h-4" />}
        >
          New Sales Order
        </Button>
      </div>

      {/* Search & Status Filters */}
      <Card>
        <div className="flex flex-col md:flex-row items-center gap-3">
          <div className="flex-1 w-full">
            <Input
              placeholder="Search orders by SO number or customer firm..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leftIcon={<Search className="w-4 h-4" />}
            />
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="rounded-lg border border-border bg-surface-card px-3 py-2 text-xs font-medium text-content-primary focus:outline-none focus:ring-2 focus:ring-atlas-100"
            >
              <option value="ALL">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="FULFILLED">Fulfilled</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Orders Table */}
      {filteredOrders.length === 0 ? (
        <EmptyState
          icon={<FileText className="w-7 h-7" />}
          title="No sales orders found"
          description="Create sales orders directly or convert accepted contractor quotations."
          actionLabel="New Sales Order"
          onAction={handleOpenCreate}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total Amount</TableHead>
              <TableHead className="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredOrders.map((o) => (
              <TableRow key={o.id}>
                <TableCell>
                  <span className="font-mono font-bold text-xs text-atlas-800 bg-atlas-50 px-2 py-0.5 rounded border border-atlas-200">
                    {o.orderNumber}
                  </span>
                  {o.quotationId && (
                    <div className="text-[10px] text-content-muted mt-0.5">
                      From Quote
                    </div>
                  )}
                </TableCell>

                <TableCell>
                  <div className="font-semibold text-content-primary">
                    {o.customer?.companyName || o.customer?.name}
                  </div>
                  {o.customer?.companyName && (
                    <div className="text-xs text-content-secondary">{o.customer.name}</div>
                  )}
                </TableCell>

                <TableCell className="text-xs text-content-secondary font-mono">
                  {o.orderDate}
                </TableCell>

                <TableCell>
                  <Badge
                    variant={
                      o.status === 'CONFIRMED'
                        ? 'success'
                        : o.status === 'DRAFT'
                        ? 'warning'
                        : o.status === 'FULFILLED'
                        ? 'info'
                        : 'danger'
                    }
                    size="sm"
                  >
                    {o.status}
                  </Badge>
                </TableCell>

                <TableCell className="text-right font-bold text-content-primary">
                  {formatCurrency(o.totalAmount)}
                </TableCell>

                <TableCell className="text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setViewingOrder(o)}
                      leftIcon={<Eye className="w-3.5 h-3.5" />}
                    >
                      View
                    </Button>

                    {o.status === 'DRAFT' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleConfirmOrder(o)}
                        leftIcon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                      >
                        Confirm
                      </Button>
                    )}

                    {o.status === 'CONFIRMED' && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleCreateInvoice(o)}
                        leftIcon={<Receipt className="w-3.5 h-3.5" />}
                      >
                        Invoice
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Create Order Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create Sales Order"
        description="Record commercial sales order. Stock will be verified upon confirmation."
        maxWidth="3xl"
      >
        <form onSubmit={handleSaveOrder} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Customer"
              required
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              options={customers.map((c) => ({
                value: c.id,
                label: `${c.companyName || c.name} (${c.phone || ''})`,
              }))}
            />
            <Input
              label="Order Date"
              type="date"
              required
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
            />
          </div>

          {/* Line items table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-content-secondary">
                Order Items
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
                const selectedProd = products.find((p) => p.id === item.productId);
                const availableStock = selectedProd?.currentStock || 0;
                const hasSufficientStock = availableStock >= item.quantity;

                return (
                  <div
                    key={idx}
                    className="flex flex-col sm:flex-row items-center gap-2 p-2 rounded-lg bg-surface-card border border-border/80"
                  >
                    <div className="flex-1 w-full">
                      <select
                        value={item.productId}
                        onChange={(e) => handleItemChange(idx, 'productId', e.target.value)}
                        className="w-full text-xs rounded-lg border border-border bg-surface-card p-1.5 font-medium"
                      >
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.sku}) — Available: {p.currentStock || 0} {p.uom}
                          </option>
                        ))}
                      </select>
                      <div className="text-[10px] mt-0.5">
                        <span className={hasSufficientStock ? 'text-emerald-600' : 'text-red-600 font-semibold'}>
                          Stock in warehouse: {availableStock} {selectedProd?.uom}
                        </span>
                      </div>
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
              <span>Subtotal:</span>
              <span className="font-mono">{formatCurrency(totals.subtotal)}</span>
            </div>
            <div className="flex justify-between w-64 text-content-secondary">
              <span>GST Tax Amount:</span>
              <span className="font-mono">{formatCurrency(totals.tax)}</span>
            </div>
            <div className="flex justify-between w-64 font-bold text-sm text-content-primary border-t border-border pt-1">
              <span>Total Order Value:</span>
              <span className="font-mono text-atlas-700">{formatCurrency(totals.total)}</span>
            </div>
          </div>

          <Input
            label="Internal Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Delivery via Chickpet local freight tempo"
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
            <Button type="submit" variant="primary" isLoading={isSubmitting}>
              Save Sales Order
            </Button>
          </div>
        </form>
      </Modal>

      {/* View Order Modal */}
      {viewingOrder && (
        <Modal
          isOpen={Boolean(viewingOrder)}
          onClose={() => setViewingOrder(null)}
          title={`Sales Order ${viewingOrder.orderNumber}`}
          description={`Customer: ${viewingOrder.customer?.companyName || viewingOrder.customer?.name}`}
          maxWidth="2xl"
        >
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-4 p-3 rounded-xl bg-surface-panel border border-border">
              <div>
                <span className="text-content-muted block text-[10px] uppercase font-semibold">
                  Customer
                </span>
                <span className="font-bold text-content-primary">
                  {viewingOrder.customer?.companyName || viewingOrder.customer?.name}
                </span>
                <div className="text-content-secondary">{viewingOrder.customer?.phone}</div>
                <div className="text-content-secondary">{viewingOrder.customer?.billingAddress}</div>
              </div>
              <div>
                <span className="text-content-muted block text-[10px] uppercase font-semibold">
                  Order Details
                </span>
                <div>Date: {viewingOrder.orderDate}</div>
                <div className="mt-1">
                  Status:{' '}
                  <Badge
                    variant={viewingOrder.status === 'CONFIRMED' ? 'success' : 'warning'}
                    size="sm"
                  >
                    {viewingOrder.status}
                  </Badge>
                </div>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-center">Qty</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead>
                  <TableHead className="text-right">GST</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {viewingOrder.items?.map((it, idx) => (
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

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button variant="outline" onClick={() => setViewingOrder(null)}>
                Close
              </Button>

              {viewingOrder.status === 'DRAFT' && (
                <Button
                  variant="primary"
                  onClick={() => handleConfirmOrder(viewingOrder)}
                  leftIcon={<CheckCircle2 className="w-4 h-4" />}
                >
                  Confirm Order & Deduct Stock
                </Button>
              )}

              {viewingOrder.status === 'CONFIRMED' && (
                <Button
                  variant="primary"
                  onClick={() => handleCreateInvoice(viewingOrder)}
                  leftIcon={<Receipt className="w-4 h-4" />}
                >
                  Generate Tax Invoice
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
