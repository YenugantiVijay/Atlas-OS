import React, { useState, useEffect } from 'react';
import {
  Receipt,
  Search,
  Eye,
  Printer,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { invoicesService } from '@/services/invoices.service';
import { Invoice } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatCurrency, calculateInvoiceBalance, resolveDocumentPresentation } from '@/lib/money';

export const InvoicesPage: React.FC = () => {
  const { currentOrg, isMockAuth } = useOrg();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const loadInvoices = async () => {
    if (!currentOrg) return;
    setIsLoading(true);
    try {
      const data = await invoicesService.getInvoices(currentOrg.id, isMockAuth);
      setInvoices(data);
    } catch (err: any) {
      console.error('Failed to load invoices:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInvoices();
  }, [currentOrg, isMockAuth]);

  const filteredInvoices = invoices.filter((i) => {
    const s = searchQuery.toLowerCase();
    return (
      i.invoiceNumber.toLowerCase().includes(s) ||
      i.customer?.companyName?.toLowerCase().includes(s) ||
      i.customer?.name.toLowerCase().includes(s)
    );
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PAID':
        return <Badge variant="success" showDot size="sm">Fully Paid</Badge>;
      case 'PARTIALLY_PAID':
        return <Badge variant="warning" showDot size="sm">Partially Paid</Badge>;
      case 'ISSUED':
        return <Badge variant="info" showDot size="sm">Issued</Badge>;
      case 'DRAFT':
        return <Badge variant="default" showDot size="sm">Draft</Badge>;
      default:
        return <Badge showDot size="sm">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              Tax Invoices
            </h1>
            <Badge variant="teal" size="sm">
              {invoices.length} Invoices
            </Badge>
          </div>
          <p className="text-sm text-content-secondary mt-1">
            Indian GST-compliant tax invoices with commercial snapshots, HSN codes, and balance tracking.
          </p>
        </div>
      </div>

      {/* Search */}
      <Card>
        <Input
          placeholder="Search invoices by invoice number or customer name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={<Search className="w-4 h-4" />}
          aria-label="Search tax invoices"
        />
      </Card>

      {/* Invoices Table */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : filteredInvoices.length === 0 ? (
        <EmptyState
          icon={<Receipt className="w-7 h-7" />}
          title="No invoices issued yet"
          description="Invoices are generated directly from confirmed sales orders to guarantee price snapshots and stock movements."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Date / Due Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Invoice Value</TableHead>
              <TableHead className="text-right">Balance Due</TableHead>
              <TableHead className="text-center">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredInvoices.map((inv) => {
              const balance = calculateInvoiceBalance(inv.totalAmount, inv.totalPaid);
              return (
                <TableRow key={inv.id}>
                  <TableCell>
                    <span className="font-mono font-bold text-xs text-atlas-800 bg-atlas-50 px-2 py-0.5 rounded border border-atlas-200/80">
                      {inv.invoiceNumber}
                    </span>
                  </TableCell>

                  <TableCell>
                    <div className="font-semibold text-sm text-content-primary">
                      {inv.customer?.companyName || inv.customer?.name}
                    </div>
                    {inv.customer?.gstin && (
                      <div className="text-xs font-mono text-content-muted mt-0.5">
                        GST: {inv.customer.gstin}
                      </div>
                    )}
                  </TableCell>

                  <TableCell>
                    <div className="text-xs font-mono text-content-primary">{inv.invoiceDate}</div>
                    <div className="text-xs text-content-secondary mt-0.5">
                      Due: {inv.dueDate}
                    </div>
                  </TableCell>

                  <TableCell>{getStatusBadge(inv.status)}</TableCell>

                  <TableCell className="text-right font-bold text-sm text-content-primary tabular-nums">
                    {formatCurrency(inv.totalAmount)}
                  </TableCell>

                  <TableCell className="text-right">
                    <span
                      className={`font-bold font-mono text-sm tabular-nums ${
                        balance > 0 ? 'text-amber-700' : 'text-emerald-700'
                      }`}
                    >
                      {formatCurrency(balance)}
                    </span>
                    <div className="text-xs text-content-muted mt-0.5 tabular-nums">
                      Paid: {formatCurrency(inv.totalPaid)}
                    </div>
                  </TableCell>

                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedInvoice(inv)}
                      leftIcon={<Eye className="w-3.5 h-3.5" />}
                    >
                      View Invoice
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* Invoice Document Modal */}
      {selectedInvoice && (
        <Modal
          isOpen={Boolean(selectedInvoice)}
          onClose={() => setSelectedInvoice(null)}
          title={`Tax Invoice — ${selectedInvoice.invoiceNumber}`}
          description="GST Commercial Tax Invoice & Delivery Dispatch Snapshot"
          maxWidth="3xl"
        >
          <div className="p-4 border border-border rounded-xl bg-surface-card space-y-5 text-xs text-content-primary">
            {/* Header / Distributor info */}
            <div className="flex justify-between items-start border-b border-border pb-4">
              <div>
                <h3 className="text-base font-bold text-content-primary">
                  {currentOrg?.legalName || currentOrg?.name}
                </h3>
                <div className="text-content-secondary text-xs mt-0.5">
                  {currentOrg?.addressLine1}, {currentOrg?.city}, {currentOrg?.state} - {currentOrg?.pincode}
                </div>
                <div className="text-content-secondary text-xs font-mono mt-0.5">
                  GSTIN: {currentOrg?.gstin || '29ABCDE1234F1Z5'} • Phone: {currentOrg?.phone}
                </div>
              </div>

              <div className="text-right">
                <span className="text-base font-bold font-mono text-atlas-800">
                  {selectedInvoice.invoiceNumber}
                </span>
                <div className="text-content-secondary text-xs mt-0.5">
                  Date: <span className="font-mono">{selectedInvoice.invoiceDate}</span>
                </div>
                <div className="text-content-secondary text-xs">
                  Payment Due: <span className="font-mono">{selectedInvoice.dueDate}</span>
                </div>
              </div>
            </div>

            {/* Bill To */}
            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-xs uppercase font-bold text-content-muted block mb-1 tracking-wider">
                Billed To Customer
              </span>
              <div className="font-bold text-content-primary text-sm">
                {selectedInvoice.customer?.companyName || selectedInvoice.customer?.name}
              </div>
              <div className="text-content-secondary text-xs mt-0.5">
                {selectedInvoice.customer?.billingAddress}
              </div>
              <div className="text-content-secondary text-xs font-mono mt-1">
                GSTIN: {selectedInvoice.customer?.gstin || 'Unregistered'} • Phone: {selectedInvoice.customer?.phone}
              </div>
            </div>

            {/* Line items */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item / Description</TableHead>
                  <TableHead>HSN</TableHead>
                  <TableHead className="text-center">Qty</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="text-right">GST</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedInvoice.items?.map((it, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      <div className="font-semibold text-content-primary text-xs">{it.productName}</div>
                      <div className="text-xs font-mono text-atlas-700 mt-0.5">{it.productSku}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{it.hsnCode || '8544'}</TableCell>
                    <TableCell className="text-center font-mono text-xs">
                      {it.quantity} {it.uom}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatCurrency(it.unitPrice)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatCurrency(it.lineSubtotal)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {it.taxRate}%
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold">
                      {formatCurrency(it.lineTotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

              {/* Totals & Balances */}
              {(() => {
                const presentation = resolveDocumentPresentation(selectedInvoice);
                return (
                  <div className="space-y-3 pt-2 border-t border-border">
                    {presentation.statusNotice && (
                      <div className="p-3 rounded-lg bg-amber-50 border border-amber-200/80 text-amber-900 text-xs leading-relaxed">
                        <div className="font-semibold flex items-center gap-1.5">
                          <span>Notice:</span>
                          <span>{presentation.format === 'UNRESOLVED_HISTORICAL' ? 'Historical Calculation Discrepancy' : 'Historical Document Format'}</span>
                        </div>
                        <p className="mt-0.5 text-amber-800">{presentation.statusNotice}</p>
                      </div>
                    )}
                    <div className="flex flex-col items-end gap-1.5">
                      <div className="flex justify-between w-64 text-content-secondary">
                        <span>{presentation.subtotalLabel}:</span>
                        <span className="font-mono">{formatCurrency(presentation.subtotalAmount)}</span>
                      </div>
                      {presentation.showDiscount && (
                        <div className="flex justify-between w-64 text-emerald-600">
                          <span>{presentation.discountLabel || 'Discount Total'}:</span>
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
                        <span className="font-mono text-atlas-800">
                          {formatCurrency(presentation.totalAmount)}
                        </span>
                      </div>
                      <div className="flex justify-between w-64 text-emerald-700 font-medium">
                        <span>Amount Paid:</span>
                        <span className="font-mono">{formatCurrency(selectedInvoice.totalPaid)}</span>
                      </div>
                      <div className="flex justify-between w-64 font-bold text-sm text-amber-800 border-t border-border/80 pt-1">
                        <span>Balance Due:</span>
                        <span className="font-mono">
                          {formatCurrency(calculateInvoiceBalance(presentation.totalAmount, selectedInvoice.totalPaid))}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}

            {/* Print & Close */}
            <div className="flex justify-end gap-2.5 pt-4 border-t border-border">
              <Button variant="outline" onClick={() => setSelectedInvoice(null)}>
                Close
              </Button>
              <Button
                variant="primary"
                onClick={() => window.print()}
                leftIcon={<Printer className="w-4 h-4" />}
              >
                Print Invoice
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
