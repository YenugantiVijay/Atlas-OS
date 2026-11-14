import React, { useState, useEffect } from 'react';
import {
  FileCode,
  QrCode,
  ShieldCheck,
  Send,
  Download,
  Copy,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { storage } from '@/lib/storage';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency } from '@/lib/money';
import { Invoice, Customer } from '@/types';
import {
  indiaComplianceService,
} from '@/services/india-compliance.service';
import { upiQr } from '@/lib/upi-qr';
import { messagingAdapter } from '@/lib/messaging-adapter';
import { accountingExportService } from '@/services/accounting-export.service';

export const IntegrationsPage: React.FC = () => {
  const { currentOrg, isMockAuth } = useOrg();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'gst' | 'upi' | 'tally' | 'whatsapp'>('gst');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>('');
  const [upiVpa, setUpiVpa] = useState<string>('srilakshmi@okaxis');

  useEffect(() => {
    if (!currentOrg) return;
    if (isMockAuth) {
      const invs = storage.getInvoices(currentOrg.id);
      const custs = storage.getCustomers(currentOrg.id);
      setInvoices(invs);
      setCustomers(custs);
      if (invs.length > 0) setSelectedInvoiceId(invs[0].id);
    }
  }, [currentOrg, isMockAuth]);

  if (!currentOrg) return null;

  const selectedInvoice = invoices.find((i) => i.id === selectedInvoiceId) || invoices[0];
  const selectedCustomer = customers.find((c) => c.id === selectedInvoice?.customerId);

  // E-Invoice & EWB calculation
  const eInvoiceResult = selectedInvoice
    ? indiaComplianceService.validateEInvoiceReadiness(currentOrg, selectedCustomer, selectedInvoice)
    : null;

  const eWayBillResult = selectedInvoice
    ? indiaComplianceService.validateEWayBillReadiness(
        currentOrg,
        selectedCustomer,
        selectedInvoice,
        { vehicleNo: 'TS09UB1234', distanceKm: 35 }
      )
    : null;

  // UPI calculation
  const upiUri = selectedInvoice
    ? upiQr.generateBharatUpiUri({
        payeeVpa: upiVpa,
        payeeName: currentOrg.name,
        amount: selectedInvoice.totalAmount - selectedInvoice.totalPaid,
        transactionRef: selectedInvoice.invoiceNumber.replace(/[^a-zA-Z0-9]/g, ''),
        transactionNote: `Payment for Inv ${selectedInvoice.invoiceNumber}`,
      })
    : '';

  // WhatsApp link
  const waLink = selectedInvoice && selectedCustomer?.phone
    ? messagingAdapter.generateWhatsAppInvoiceLink(selectedCustomer.phone, currentOrg.name, selectedInvoice, upiUri)
    : '';

  const handleDownloadTallyXml = () => {
    const xml = accountingExportService.exportSalesToTallyXml(currentOrg, invoices, customers);
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tally_sales_${currentOrg.name.toLowerCase().replace(/\s+/g, '_')}.xml`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('success', 'Export Complete', 'Tally Prime XML file downloaded successfully.');
  };

  const handleDownloadBusyCsv = () => {
    const csv = accountingExportService.exportSalesToBusyCsv(invoices, customers);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `busy_sales_${currentOrg.name.toLowerCase().replace(/\s+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('success', 'Export Complete', 'BUSY Accounting CSV file downloaded successfully.');
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast('info', 'Copied', `${label} copied to clipboard.`);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              India Ecosystem & Compliance Integrations
            </h1>
            <Badge variant="teal" size="sm">
              GST • Bharat UPI • Tally
            </Badge>
          </div>
          <p className="text-sm text-content-secondary mt-1">
            Standard adapters for Indian statutory compliance (NIC e-Invoicing, E-Way Bill), Bharat UPI payment QR, and Tally/BUSY cutover.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-medium text-slate-700 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>Sandbox Simulation Mode (Zero Live Creds)</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 space-x-1">
        <button
          type="button"
          onClick={() => setActiveTab('gst')}
          className={`pb-2.5 px-4 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'gst'
              ? 'border-teal-600 text-teal-800'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          GST E-Invoice & E-Way Bill
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('upi')}
          className={`pb-2.5 px-4 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'upi'
              ? 'border-teal-600 text-teal-800'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Bharat UPI QR & Links
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('tally')}
          className={`pb-2.5 px-4 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'tally'
              ? 'border-teal-600 text-teal-800'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Tally & BUSY Export
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('whatsapp')}
          className={`pb-2.5 px-4 text-sm font-semibold border-b-2 transition-colors cursor-pointer ${
            activeTab === 'whatsapp'
              ? 'border-teal-600 text-teal-800'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          WhatsApp Share
        </button>
      </div>

      {/* TAB 1: GST E-Invoice & E-Way Bill */}
      {activeTab === 'gst' && (
        <div className="space-y-4">
          <Card className="p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-navy-800">NIC E-Invoice Schema v1.03 Readiness</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Validates mandatory statutory fields: Seller GSTIN, Buyer GSTIN, HSN codes, and CGST/SGST/IGST tax splits.
                </p>
              </div>

              {invoices.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Test with Invoice:</span>
                  <select
                    value={selectedInvoiceId}
                    onChange={(e) => setSelectedInvoiceId(e.target.value)}
                    className="text-xs rounded-lg border border-slate-200 bg-white px-2 py-1"
                  >
                    {invoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoiceNumber} ({formatCurrency(inv.totalAmount)})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {selectedInvoice ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* E-Invoice Status */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-navy-800">E-Invoice Status</span>
                    <Badge variant={eInvoiceResult?.compliant ? 'success' : 'warning'} size="sm">
                      {eInvoiceResult?.compliant ? 'Schema Compliant' : 'Attention Needed'}
                    </Badge>
                  </div>

                  <p className="text-xs text-slate-600">{eInvoiceResult?.reason || 'Ready for JSON upload to NIC IRP Portal.'}</p>

                  {eInvoiceResult?.missingFields && eInvoiceResult.missingFields.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 p-2.5 rounded-lg text-xs space-y-1 text-amber-900">
                      <span className="font-semibold">Missing Statutory Information:</span>
                      <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                        {eInvoiceResult.missingFields.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {eInvoiceResult?.payload && (
                    <div className="pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(JSON.stringify(eInvoiceResult.payload, null, 2), 'NIC e-Invoice JSON')}
                        leftIcon={<Copy className="w-3.5 h-3.5" />}
                        className="text-xs w-full"
                      >
                        Copy NIC Schema JSON Payload
                      </Button>
                    </div>
                  )}
                </div>

                {/* E-Way Bill Status */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-navy-800">E-Way Bill (₹50k Threshold)</span>
                    <Badge variant={eWayBillResult?.required ? 'warning' : 'default'} size="sm">
                      {eWayBillResult?.required ? 'Mandatory (>= ₹50,000)' : 'Optional (< ₹50,000)'}
                    </Badge>
                  </div>

                  <p className="text-xs text-slate-600">{eWayBillResult?.reason}</p>

                  <div className="text-xs text-slate-500 bg-white p-2.5 rounded-lg border border-slate-200">
                    <div>Consignment Value: <strong>{formatCurrency(selectedInvoice.totalAmount)}</strong></div>
                    <div>Statutory Limit: <strong>₹50,000 (CGST Rule 138)</strong></div>
                  </div>

                  {eWayBillResult?.payload && (
                    <div className="pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(JSON.stringify(eWayBillResult.payload, null, 2), 'E-Way Bill JSON')}
                        leftIcon={<Copy className="w-3.5 h-3.5" />}
                        className="text-xs w-full"
                      >
                        Copy E-Way Bill Part A/B JSON
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-500">
                No invoices found in organization ledger to test.
              </div>
            )}
          </Card>
        </div>
      )}

      {/* TAB 2: Bharat UPI QR & Links */}
      {activeTab === 'upi' && (
        <Card className="p-4 sm:p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-navy-800">NPCI Bharat UPI Dynamic QR Generator</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Generates instant payment links for thermal counter slips, WhatsApp sharing, and A4 tax invoices.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Organization Payee UPI ID (VPA):
                </label>
                <input
                  type="text"
                  value={upiVpa}
                  onChange={(e) => setUpiVpa(e.target.value)}
                  placeholder="e.g. dealer@hdfcbank"
                  className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 font-mono"
                />
              </div>

              {selectedInvoice && (
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1 text-xs">
                  <div>Invoice: <strong>{selectedInvoice.invoiceNumber}</strong></div>
                  <div>Outstanding Amount: <strong>{formatCurrency(selectedInvoice.totalAmount - selectedInvoice.totalPaid)}</strong></div>
                  <div>Payee Name: <strong>{currentOrg.name}</strong></div>
                </div>
              )}

              <Button
                variant="primary"
                size="sm"
                onClick={() => copyToClipboard(upiUri, 'UPI Payment Link')}
                leftIcon={<Copy className="w-3.5 h-3.5" />}
                className="w-full text-xs bg-teal-600 hover:bg-teal-700 text-white"
              >
                Copy UPI Payment URI
              </Button>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col items-center justify-center text-center space-y-2">
              <QrCode className="w-16 h-16 text-teal-700" />
              <div className="font-bold text-xs text-navy-800">Scan to Pay via Any UPI App</div>
              <div className="text-[11px] text-slate-500 font-mono truncate max-w-xs">{upiUri}</div>
              <Badge variant="teal" size="sm">GPay • PhonePe • Paytm • BHIM</Badge>
            </div>
          </div>
        </Card>
      )}

      {/* TAB 3: Tally & BUSY Export */}
      {activeTab === 'tally' && (
        <Card className="p-4 sm:p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-navy-800">Accounting Software 1-Click Cutover</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Export sales vouchers, party ledgers, and tax heads directly into Indian SME accounting software without double entry.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-slate-200 bg-white flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <FileCode className="w-5 h-5 text-teal-600" />
                  <span className="font-bold text-sm text-navy-800">Tally Prime XML Export</span>
                </div>
                <p className="text-xs text-slate-600">
                  Generates native Tally XML format with Party Ledgers, Sales Account, and CGST/SGST/IGST tax allocation ledgers.
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={handleDownloadTallyXml}
                leftIcon={<Download className="w-3.5 h-3.5" />}
                className="w-full text-xs bg-teal-600 hover:bg-teal-700 text-white"
              >
                Download Tally XML ({invoices.length} Invoices)
              </Button>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <FileCode className="w-5 h-5 text-blue-600" />
                  <span className="font-bold text-sm text-navy-800">BUSY Accounting CSV</span>
                </div>
                <p className="text-xs text-slate-600">
                  Generates standard BUSY transaction CSV with HSN codes, quantity, rate, and tax values per line.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadBusyCsv}
                leftIcon={<Download className="w-3.5 h-3.5" />}
                className="w-full text-xs"
              >
                Download BUSY CSV ({invoices.length} Invoices)
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* TAB 4: WhatsApp Share */}
      {activeTab === 'whatsapp' && (
        <Card className="p-4 sm:p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-navy-800">WhatsApp Indian Business Message Dispatch</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Send professional WhatsApp messages with bill details, due date, and embedded UPI link to contractors and customers.
            </p>
          </div>

          {selectedInvoice && selectedCustomer ? (
            <div className="space-y-3 max-w-lg">
              <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/50 text-xs space-y-2">
                <div className="font-bold text-emerald-900">Message Preview:</div>
                <div className="bg-white p-3 rounded-lg border border-emerald-100 whitespace-pre-line text-slate-800 font-sans text-[11px] leading-relaxed">
                  *Tax Invoice from {currentOrg.name}*{'\n\n'}
                  Dear Customer,{'\n'}
                  Your tax invoice *#{selectedInvoice.invoiceNumber}* dated {selectedInvoice.invoiceDate} has been generated.{'\n\n'}
                  • *Total Amount:* {formatCurrency(selectedInvoice.totalAmount)}{'\n'}
                  • *Balance Due:* {formatCurrency(selectedInvoice.totalAmount - selectedInvoice.totalPaid)}{'\n'}
                  • *Payment Due Date:* {selectedInvoice.dueDate}{'\n\n'}
                  📲 *Pay instantly via UPI:*{'\n'}
                  {upiUri}{'\n\n'}
                  Thank you for your business!{'\n'}— {currentOrg.name}
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => window.open(waLink, '_blank')}
                  disabled={!selectedCustomer.phone}
                  leftIcon={<Send className="w-3.5 h-3.5" />}
                  className="flex-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  Send via WhatsApp ({selectedCustomer.phone || 'No phone set'})
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(waLink, 'WhatsApp share URL')}
                  className="text-xs"
                >
                  Copy Link
                </Button>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-slate-500">
              Select an invoice to generate WhatsApp share message.
            </div>
          )}
        </Card>
      )}
    </div>
  );
};
