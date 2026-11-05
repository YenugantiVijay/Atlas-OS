import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CreditCard,
  Plus,
  Search,
  Loader2,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { useActionPermission } from '@/hooks/useActionPermission';
import { paymentsService } from '@/services/payments.service';
import { customersService } from '@/services/customers.service';
import { invoicesService } from '@/services/invoices.service';
import { Payment, Customer, Invoice, PaymentMethod, PaymentsSummary } from '@/types';
import { validateMoneyInput } from '@/lib/validation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { LoadError } from '@/components/ui/LoadError';
import { PrerequisiteModal, PrerequisiteInfo } from '@/components/ui/PrerequisiteModal';
import { useToast } from '@/components/ui/Toast';
import { Pagination } from '@/components/ui/Pagination';
import { paginateArray } from '@/lib/pagination';
import { formatCurrency, calculateInvoiceBalance } from '@/lib/money';
import { getBusinessDate } from '@/lib/dates';

const PAYMENT_METHODS: PaymentMethod[] = [
  'UPI',
  'NEFT',
  'RTGS',
  'CHEQUE',
  'CASH',
  'BANK_TRANSFER',
];

export const PaymentsPage: React.FC = () => {
  const { currentOrg, isMockAuth, currentRole, canWriteOperations } = useOrg();
  const { check } = useActionPermission();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [payments, setPayments] = useState<Payment[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [summary, setSummary] = useState<PaymentsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPreparingRecord, setIsPreparingRecord] = useState(false);
  const [pendingOpenRecord, setPendingOpenRecord] = useState(false);
  const [prerequisite, setPrerequisite] = useState<PrerequisiteInfo | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('UPI');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [paymentDate, setPaymentDate] = useState(getBusinessDate());
  const [notes, setNotes] = useState('');
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeOrgIdRef = useRef(currentOrg?.id);
  useEffect(() => {
    if (currentOrg?.id !== activeOrgIdRef.current) {
      activeOrgIdRef.current = currentOrg?.id;
      // Stale response guard and form reset on organization switch
      setIsModalOpen(false);
      setCustomerId('');
      setInvoiceId('');
      setAmount('');
      setPaymentIdempotencyKey('');
      setPage(1);
      setSummary(null);
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

  const loadData = useCallback(async (targetPage = page, targetPageSize = pageSize): Promise<{ customers: Customer[]; invoices: Invoice[] } | null> => {
    if (!currentOrg) return null;
    const orgIdAtCall = currentOrg.id;
    setIsLoading(true);
    setLoadError(null);
    try {
      const payPromise = typeof paymentsService.getPaymentsPaginated === 'function'
        ? paymentsService.getPaymentsPaginated(
            currentOrg.id,
            {
              page: targetPage,
              pageSize: targetPageSize,
              search: searchQuery,
            },
            isMockAuth
          )
        : paymentsService.getPayments(currentOrg.id, isMockAuth).then((data) =>
            paginateArray(
              data,
              {
                page: targetPage,
                pageSize: targetPageSize,
                search: searchQuery,
              },
              (p, s) =>
                p.paymentNumber.toLowerCase().includes(s) ||
                Boolean(p.customer?.companyName && p.customer.companyName.toLowerCase().includes(s)) ||
                Boolean(p.customer?.name && p.customer.name.toLowerCase().includes(s)) ||
                Boolean(p.referenceNumber && p.referenceNumber.toLowerCase().includes(s))
            )
          );

      const summaryPromise = typeof paymentsService.getPaymentsSummary === 'function'
        ? paymentsService.getPaymentsSummary(currentOrg.id, isMockAuth)
        : null;

      const [payRes, custList, invList, sumRes] = await Promise.all([
        payPromise,
        customersService.getCustomers(currentOrg.id, isMockAuth),
        invoicesService.getInvoices(currentOrg.id, isMockAuth),
        summaryPromise,
      ]);

      if (activeOrgIdRef.current !== orgIdAtCall) {
        // Discard stale response if organization changed during async fetch
        return null;
      }

      setPayments(payRes.data);
      setTotalCount(payRes.totalCount);
      setTotalPages(payRes.totalPages);
      setCustomers(custList);
      setInvoices(invList);
      if (sumRes) {
        setSummary(sumRes);
      } else {
        // Fallback summary
        const openInvoices = invList.filter(
          (i) => (i.status === 'ISSUED' || i.status === 'PARTIALLY_PAID') && calculateInvoiceBalance(i.totalAmount, i.totalPaid) > 0
        );
        setSummary({
          totalCollected: payRes.data.reduce((s, p) => s + p.amount, 0),
          paymentCount: payRes.totalCount,
          totalReceivables: openInvoices.reduce((s, i) => s + calculateInvoiceBalance(i.totalAmount, i.totalPaid), 0),
          openInvoicesCount: openInvoices.length,
        });
      }
      return { customers: custList, invoices: invList };
    } catch (err: any) {
      if (activeOrgIdRef.current !== orgIdAtCall) return null;
      const msg = err instanceof Error ? err.message : 'Unable to load the required records. Check your connection and try again.';
      setLoadError(msg);
      showToast('error', 'Failed to load payments', msg);
      return null;
    } finally {
      if (activeOrgIdRef.current === orgIdAtCall) {
        setIsLoading(false);
      }
    }
  }, [currentOrg, isMockAuth, page, pageSize, searchQuery, showToast]);

  const initializeAndOpenRecord = useCallback((custList: Customer[], preselectedInvoice?: Invoice) => {
    const perm = check('payments:record');
    if (!perm.allowed) {
      showToast('error', perm.title || 'Permission Denied', perm.message || 'Write operations are disabled.');
      clearActionParam();
      return;
    }

    if (custList.length === 0) {
      showToast('warning', 'No Customers Found', 'No customers found. Add a customer before recording a payment.');
      setPrerequisite({
        type: 'customer',
        title: 'No Customers Found',
        message: 'No customers found. Add a customer before recording a payment.',
        actionRoute: '/customers?action=create',
        actionLabel: 'Add Customer',
      });
      clearActionParam();
      return;
    }

    if (preselectedInvoice) {
      setCustomerId(preselectedInvoice.customerId);
      setInvoiceId(preselectedInvoice.id);
      const rem = calculateInvoiceBalance(preselectedInvoice.totalAmount, preselectedInvoice.totalPaid);
      setAmount(String(rem));
    } else {
      setCustomerId(custList[0]?.id || '');
      setInvoiceId('');
      setAmount('');
    }

    setPaymentMethod('UPI');
    setReferenceNumber('');
    setPaymentDate(getBusinessDate());
    setNotes('');
    setPaymentIdempotencyKey(typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '');
    setIsModalOpen(true);
    clearActionParam();
  }, [check, clearActionParam, showToast]);

  const checkRef = useRef(check);
  checkRef.current = check;
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const clearActionParamRef = useRef(clearActionParam);
  clearActionParamRef.current = clearActionParam;
  const initializeAndOpenRecordRef = useRef(initializeAndOpenRecord);
  initializeAndOpenRecordRef.current = initializeAndOpenRecord;
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  // Initial load effect
  useEffect(() => {
    let active = true;
    const params = searchParamsRef.current;
    const requestedAction = params.get('action');

    if (requestedAction === 'record') {
      const perm = checkRef.current('payments:record');
      if (!perm.allowed) {
        showToastRef.current('error', perm.title || 'Permission Denied', perm.message || 'Write operations are disabled.');
        clearActionParamRef.current();
        loadData();
        return;
      }
      setIsPreparingRecord(true);
    }

    loadData().then((result) => {
      if (!active) return;
      setIsPreparingRecord(false);
      if (requestedAction === 'record') {
        if (!result) {
          showToastRef.current('error', 'Loading Error', 'Unable to load the required records. Check your connection and try again.');
          return;
        }
        initializeAndOpenRecordRef.current(result.customers);
      }
    });

    return () => {
      active = false;
    };
  }, [loadData]);

  // Listen for action=record if navigation happens while component is already mounted
  useEffect(() => {
    const action = searchParams.get('action');
    if (action === 'record' && !isLoading && !isPreparingRecord) {
      if (loadError) {
        showToast('error', 'Loading Error', 'Unable to load the required records. Check your connection and try again.');
        return;
      }
      initializeAndOpenRecord(customers);
    }
  }, [searchParams, isLoading, isPreparingRecord, loadError, customers, initializeAndOpenRecord, showToast]);

  // Handle pending open if user clicked "Record Payment" while initial load was running
  useEffect(() => {
    if (pendingOpenRecord && !isLoading && !loadError) {
      setPendingOpenRecord(false);
      initializeAndOpenRecord(customers);
    }
  }, [pendingOpenRecord, isLoading, loadError, customers, initializeAndOpenRecord]);

  const handleOpenRecord = (preselectedInvoice?: Invoice) => {
    const perm = check('payments:record');
    if (!perm.allowed) {
      showToast('error', perm.title || 'Permission Denied', perm.message || 'Write operations are disabled.');
      return;
    }

    if (isLoading) {
      setPendingOpenRecord(true);
      showToast('info', 'Preparing Payment', 'Preparing payment...');
      return;
    }

    if (loadError) {
      showToast('error', 'Unable to Load Records', 'Unable to load the required records. Check your connection and try again.');
      return;
    }

    initializeAndOpenRecord(customers, preselectedInvoice);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const perm = check('payments:record');
    if (!perm.allowed) {
      showToast('error', perm.title || 'Permission Denied', perm.message || 'Write operations are disabled.');
      return;
    }

    if (!customerId) {
      showToast('error', 'Customer Required', 'Please select a customer.');
      return;
    }

    const amountValidation = validateMoneyInput(amount, 'Payment amount', { required: true, allowZero: false });
    if (!amountValidation.valid || !amountValidation.value) {
      showToast('error', 'Invalid Amount', amountValidation.error || 'Payment amount must be greater than 0.');
      return;
    }
    const payAmount = amountValidation.value;

    if (!currentOrg) return;

    // Validate target invoice eligibility & balance if invoice specified
    if (invoiceId) {
      const targetInvoice = customerUnpaidInvoices.find((i) => i.id === invoiceId);
      if (!targetInvoice) {
        showToast(
          'error',
          'Ineligible Invoice',
          'Selected invoice is not eligible for payment. Only issued or partially paid invoices with positive balances can be settled.'
        );
        return;
      }
      const remainingBalance = calculateInvoiceBalance(targetInvoice.totalAmount, targetInvoice.totalPaid);
      if (payAmount > remainingBalance) {
        showToast(
          'error',
          'Overpayment Violation',
          `Payment amount (${formatCurrency(payAmount)}) exceeds outstanding balance (${formatCurrency(remainingBalance)}). Overpayment policy prevents excess credit without customer advance authorization.`
        );
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const keyToUse =
        paymentIdempotencyKey ||
        (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '');
      if (!paymentIdempotencyKey && keyToUse) {
        setPaymentIdempotencyKey(keyToUse);
      }

      const p = await paymentsService.recordPayment(
        currentOrg.id,
        {
          customerId,
          invoiceId: invoiceId || undefined,
          amount: payAmount,
          paymentMethod,
          referenceNumber: referenceNumber.trim() || undefined,
          paymentDate,
          idempotencyKey: keyToUse || undefined,
          notes: notes.trim() || undefined,
        },
        isMockAuth,
        currentRole
      );

      showToast(
        'success',
        'Payment Recorded',
        `Recorded receipt ${p.paymentNumber} for ${formatCurrency(payAmount)}.`
      );
      setIsModalOpen(false);
      setPaymentIdempotencyKey('');
      await loadData();
    } catch (err: any) {
      showToast('error', 'Payment Failed', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Eligible unpaid invoices for selected customer: strictly ISSUED or PARTIALLY_PAID with balance > 0
  const customerUnpaidInvoices = invoices.filter(
    (inv) =>
      inv.organizationId === currentOrg?.id &&
      inv.customerId === customerId &&
      (inv.status === 'ISSUED' || inv.status === 'PARTIALLY_PAID') &&
      calculateInvoiceBalance(inv.totalAmount, inv.totalPaid) > 0
  );

  const totalCollected = summary ? summary.totalCollected : payments.reduce((sum, p) => sum + p.amount, 0);
  const totalReceivables = summary ? summary.totalReceivables : customers.reduce((sum, c) => sum + (c.currentReceivable || 0), 0);
  const openInvoicesCount = summary
    ? summary.openInvoicesCount
    : invoices.filter((i) => (i.status === 'ISSUED' || i.status === 'PARTIALLY_PAID') && calculateInvoiceBalance(i.totalAmount, i.totalPaid) > 0).length;

  const filteredPayments = payments.filter((p) => {
    const s = searchQuery.toLowerCase();
    return (
      p.paymentNumber.toLowerCase().includes(s) ||
      p.customer?.companyName?.toLowerCase().includes(s) ||
      p.customer?.name.toLowerCase().includes(s) ||
      p.referenceNumber?.toLowerCase().includes(s)
    );
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              Payments & Receivables Ledger
            </h1>
            <Badge variant="teal" size="sm">
              Collections
            </Badge>
          </div>
          <p className="text-sm text-content-secondary mt-1">
            Record customer receipts via UPI, NEFT, Cheque, and allocate balances to open invoices.
          </p>
        </div>

        {(() => {
          const recordPerm = check('payments:record');
          return (
            <Button
              variant="primary"
              onClick={() => handleOpenRecord()}
              leftIcon={<Plus className="w-4 h-4" />}
              disabled={!recordPerm.allowed}
              title={!recordPerm.allowed ? recordPerm.message : undefined}
            >
              Record Payment
            </Button>
          );
        })()}
      </div>

      {/* Preparing Indicator */}
      {(isPreparingRecord || (pendingOpenRecord && isLoading)) && (
        <div role="status" className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-teal-50 border border-teal-200 text-teal-800 text-sm font-medium animate-in fade-in">
          <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
          <span>Preparing payment...</span>
        </div>
      )}

      {/* Recoverable Network Error */}
      {loadError && (
        <LoadError
          message={loadError}
          onRetry={() => loadData()}
        />
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5">
        <Card hover>
          <div className="text-xs font-medium text-content-secondary mb-1.5">
            Total Receivables Outstanding
          </div>
          <div className="text-2xl font-bold text-amber-800 tabular-nums">
            {formatCurrency(totalReceivables)}
          </div>
          <div className="text-xs text-content-muted mt-1">
            Across active issued invoices
          </div>
        </Card>

        <Card hover>
          <div className="text-xs font-medium text-content-secondary mb-1.5">
            Total Collections Logged
          </div>
          <div className="text-2xl font-bold text-emerald-700 tabular-nums">
            {formatCurrency(totalCollected)}
          </div>
          <div className="text-xs text-content-muted mt-1">
            {summary ? summary.paymentCount : totalCount} verified payment receipts
          </div>
        </Card>

        <Card hover>
          <div className="text-xs font-medium text-content-secondary mb-1.5">
            Open Invoices
          </div>
          <div className="text-2xl font-bold text-content-primary tabular-nums">
            {openInvoicesCount}
          </div>
          <div className="text-xs text-content-muted mt-1">
            Awaiting payment settlement
          </div>
        </Card>
      </div>

      {/* Search */}
      <Card>
        <Input
          placeholder="Search payments by receipt #, customer, or transaction reference (UTR / UPI)..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setPage(1);
          }}
          leftIcon={<Search className="w-4 h-4" />}
          aria-label="Search payment records"
        />
      </Card>

      {/* Payments Table */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : filteredPayments.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="w-7 h-7" />}
          title="No payments recorded"
          description="Log customer payments against outstanding tax invoices."
          actionLabel={!check('payments:record').allowed ? undefined : "Record Payment"}
          onAction={() => handleOpenRecord()}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Receipt #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Method & Reference</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Amount Received</TableHead>
              <TableHead>Allocation Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredPayments.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <span className="font-mono font-bold text-xs text-atlas-800 bg-atlas-50 px-2 py-0.5 rounded border border-atlas-200/80">
                    {p.paymentNumber}
                  </span>
                </TableCell>

                <TableCell>
                  <div className="font-semibold text-sm text-content-primary">
                    {p.customer?.companyName || p.customer?.name}
                  </div>
                  {p.customer?.phone && (
                    <div className="text-xs text-content-secondary mt-0.5">
                      {p.customer.phone}
                    </div>
                  )}
                </TableCell>

                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="info" size="sm">
                      {p.paymentMethod}
                    </Badge>
                  </div>
                  {p.referenceNumber && (
                    <div className="text-xs font-mono text-content-secondary mt-1">
                      Ref: {p.referenceNumber}
                    </div>
                  )}
                </TableCell>

                <TableCell className="text-xs font-mono text-content-secondary">
                  {p.paymentDate}
                </TableCell>

                <TableCell className="text-right font-bold font-mono text-sm text-emerald-700 tabular-nums">
                  {formatCurrency(p.amount)}
                </TableCell>

                <TableCell className="text-xs text-content-secondary max-w-xs truncate">
                  {p.notes || (p.allocations?.length ? `Allocated to invoice` : 'Direct credit')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Pagination Controls */}
      {filteredPayments.length > 0 && (
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

      {/* Record Payment Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Record Customer Payment"
        description="Verify and record payment remittance against customer receivables."
        maxWidth="lg"
      >
        <form onSubmit={handleRecordPayment} className="space-y-4">
          <Select
            label="Customer"
            required
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              setInvoiceId('');
            }}
            options={customers.map((c) => ({
              value: c.id,
              label: `${c.companyName || c.name} — Outstanding: ${formatCurrency(c.currentReceivable || 0)}`,
            }))}
          />

          <Select
            label="Target Invoice to Settle (Optional)"
            value={invoiceId}
            onChange={(e) => {
              setInvoiceId(e.target.value);
              const inv = invoices.find((i) => i.id === e.target.value);
              if (inv) {
                setAmount(String(calculateInvoiceBalance(inv.totalAmount, inv.totalPaid)));
              }
            }}
          >
            <option value="">General Payment / Account Credit</option>
            {customerUnpaidInvoices.map((inv) => {
              const balance = calculateInvoiceBalance(inv.totalAmount, inv.totalPaid);
              return (
                <option key={inv.id} value={inv.id}>
                  {inv.invoiceNumber} — Due: {inv.dueDate} — Balance: {formatCurrency(balance)}
                </option>
              );
            })}
          </Select>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Amount Received (₹)"
              type="number"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
            <Select
              label="Payment Method"
              required
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Reference / Transaction ID"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="e.g. UPI Txn ID, UTR #, Cheque #"
            />
            <Input
              label="Payment Date"
              type="date"
              required
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </div>

          <Input
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Settled via HDFC Current Account"
          />

          <div className="flex justify-end gap-2.5 pt-4 border-t border-border mt-5">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsModalOpen(false);
                setPaymentIdempotencyKey('');
              }}
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
              Record Payment Receipt
            </Button>
          </div>
        </form>
      </Modal>

      {/* Missing Customer Prerequisite Modal */}
      <PrerequisiteModal
        prerequisite={prerequisite}
        onClose={() => setPrerequisite(null)}
      />
    </div>
  );
};
