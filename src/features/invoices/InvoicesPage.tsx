import React, { useState, useEffect } from 'react';
import {
  Receipt,
  Search,
  Eye,
  Printer,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { storage } from '@/lib/storage';
import { Invoice } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatCurrency, calculateInvoiceBalance } from '@/lib/money';

export const InvoicesPage: React.FC = () => {
  const { currentOrg } = useOrg();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const loadInvoices = () => {
    if (currentOrg) {
      setInvoices(storage.getInvoices(currentOrg.id));
    }
  };

  useEffect(() => {
    loadInvoices();
  }, [currentOrg]);

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
        return <Badge variant="success" size="sm">Fully Paid</Badge>;
      case 'PARTIALLY_PAID':
        return <Badge variant="warning" size="sm">Partially Paid</Badge>;
      case 'ISSUED':
        return <Badge variant="info" size="sm">Issued</Badge>;
      case 'DRAFT':
        return <Badge variant="default" size="sm">Draft</Badge>;
      default:
        return <Badge size="sm">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              Tax Invoices
            </h1>
            <Badge variant="violet" size="sm">
              {invoices.length} Invoices
            </Badge>
          </div>
          <p className="text-xs text-content-secondary mt-0.5">
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
        />
      </Card>

      {/* Invoices Table */}
      {filteredInvoices.length === 0 ? (
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
                    <span className="font-mono font-bold text-xs text-atlas-800 bg-atlas-50 px-2 py-0.5 rounded border border-atlas-200">
                      {inv.invoiceNumber}
                    </span>
                  </TableCell>

                  <TableCell>
                    <div className="font-semibold text-content-primary">
                      {inv.customer?.companyName || inv.customer?.name}
                    </div>
                    {inv.customer?.gstin && (
                      <div className="text-[11px] font-mono text-content-muted">
                        GST: {inv.customer.gstin}
                      </div>
                    )}
                  </TableCell>

                  <TableCell>
                    <div className="text-xs font-mono text-content-primary">{inv.invoiceDate}</div>
                    <div className="text-[10px] text-content-secondary mt-0.5">
                      Due: {inv.dueDate}
                    </div>
                  </TableCell>

                  <TableCell>{getStatusBadge(inv.status)}</TableCell>

                  <TableCell className="text-right font-bold text-content-primary">
                    {formatCurrency(inv.totalAmount)}
                  </TableCell>

                  <TableCell className="text-right">
                    <span
                      className={`font-bold font-mono text-xs ${
                        balance > 0 ? 'text-amber-700' : 'text-emerald-700'
                      }`}
                    >
                      {formatCurrency(balance)}
                    </span>
                    <div className="text-[10px] text-content-muted">
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
                <div className="text-content-secondary text-[11px] mt-0.5">
                  {currentOrg?.addressLine1}, {currentOrg?.city}, {currentOrg?.state} - {currentOrg?.pincode}
                </div>
                <div className="text-content-secondary text-[11px] font-mono mt-0.5">
                  GSTIN: {currentOrg?.gstin || '29ABCDE1234F1Z5'} • Phone: {currentOrg?.phone}
                </div>
              </div>

              <div className="text-right">
                <span className="text-base font-bold font-mono text-atlas-800">
                  {selectedInvoice.invoiceNumber}
                </span>
                <div className="text-content-secondary text-[11px] mt-0.5">
                  Date: <span className="font-mono">{selectedInvoice.invoiceDate}</span>
                </div>
                <div className="text-content-secondary text-[11px]">
                  Payment Due: <span className="font-mono">{selectedInvoice.dueDate}</span>
                </div>
              </div>
            </div>

            {/* Bill To */}
            <div className="p-3 rounded-lg bg-surface-panel border border-border">
              <span className="text-[10px] uppercase font-bold text-content-muted block mb-1">
                Billed To Customer
              </span>
              <div className="font-bold text-content-primary text-sm">
                {selectedInvoice.customer?.companyName || selectedInvoice.customer?.name}
              </div>
              <div className="text-content-secondary text-[11px]">
                {selectedInvoice.customer?.billingAddress}
              </div>
              <div className="text-content-secondary text-[11px] font-mono mt-0.5">
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
                      <div className="font-semibold">{it.productName}</div>
                      <div className="text-[10px] font-mono text-atlas-700">{it.productSku}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{it.hsnCode || '8544'}</TableCell>
                    <TableCell className="text-center font-mono">
                      {it.quantity} {it.uom}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(it.unitPrice)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(it.lineSubtotal)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px]">
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
            <div className="flex flex-col items-end gap-1.5 pt-2 border-t border-border">
              <div className="flex justify-between w-64 text-content-secondary">
                <span>Taxable Value:</span>
                <span className="font-mono">{formatCurrency(selectedInvoice.subtotal)}</span>
              </div>
              <div className="flex justify-between w-64 text-content-secondary">
                <span>Total GST Amount:</span>
                <span className="font-mono">{formatCurrency(selectedInvoice.taxAmount)}</span>
              </div>
              <div className="flex justify-between w-64 font-bold text-sm text-content-primary border-t border-border pt-1">
                <span>Invoice Total:</span>
                <span className="font-mono text-atlas-800">
                  {formatCurrency(selectedInvoice.totalAmount)}
                </span>
              </div>
              <div className="flex justify-between w-64 text-emerald-700 font-medium">
                <span>Amount Paid:</span>
                <span className="font-mono">{formatCurrency(selectedInvoice.totalPaid)}</span>
              </div>
              <div className="flex justify-between w-64 font-bold text-sm text-amber-800 border-t border-border/80 pt-1">
                <span>Balance Due:</span>
                <span className="font-mono">
                  {formatCurrency(calculateInvoiceBalance(selectedInvoice.totalAmount, selectedInvoice.totalPaid))}
                </span>
              </div>
            </div>

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
