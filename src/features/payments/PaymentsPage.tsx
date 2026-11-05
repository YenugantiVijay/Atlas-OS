import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CreditCard,
  Plus,
  Search,
  Loader2,
  AlertCircle,
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
  const [summary, setSummary] = useState<PaymentsSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
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

  // Modal State — bounded & searchable lookup
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [eligibleInvoices, setEligibleInvoices] = useState<Invoice[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [customerSearchText, setCustomerSearchText] = useState('');
  const [invoiceSearchText, setInvoiceSearchText] = useState('');
  const [isSearchingCustomer, setIsSearchingCustomer] = useState(false);
  const [isSearchingInvoice, setIsSearchingInvoice] = useState(false);
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('UPI');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [paymentDate, setPaymentDate] = useState(getBusinessDate());
  const [notes, setNotes] = useState('');
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeOrgIdRef = useRef(currentOrg?.id);
  const searchCustSeqRef = useRef(0);
  const searchInvSeqRef = useRef(0);

  useEffect(() => {
    if (currentOrg?.id !== activeOrgIdRef.current) {
      activeOrgIdRef.current = currentOrg?.id;
      // Stale response guard and form reset on organization switch
      setIsModalOpen(false);
      setCustomerId('');
      setInvoiceId('');
      setCustomers([]);
      setEligibleInvoices([]);
      setCustomerSearchText('');
      setInvoiceSearchText('');
      setAmount('');
      setPaymentIdempotencyKey('');
      setPage(1);
      setSummary(null);
      setSummaryError(null);
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

  const loadData = useCallback(async (targetPage = page, targetPageSize = pageSize) => {
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

      const [payRes, sumRes] = await Promise.all([
        payPromise,
        summaryPromise ? summaryPromise.catch((err) => {
          if (activeOrgIdRef.current === orgIdAtCall) {
            setSummaryError(err instanceof Error ? err.message : 'Unable to load summary metrics');
            setSummary(null);
          }
          return null;
        }) : null,
      ]);

      if (activeOrgIdRef.current !== orgIdAtCall) {
        // Discard stale response if organization changed during async fetch
        return null;
      }

      setPayments(payRes.data);
      setTotalCount(payRes.totalCount);
      setTotalPages(payRes.totalPages);
      if (sumRes) {
        setSummary(sumRes);
        setSummaryError(null);
      }
      return payRes;
    } catch (err: any) {
      if (activeOrgIdRef.current !== orgIdAtCall) return null;
      const msg = err instanceof Error ? err.message : 'Unable to load payments. Check your connection and try again.';
      setLoadError(msg);
      showToast('error', 'Failed to load payments', msg);
      return null;
    } finally {
      if (activeOrgIdRef.current === orgIdAtCall) {
        setIsLoading(false);
      }
    }
  }, [currentOrg, isMockAuth, page, pageSize, searchQuery, showToast]);

  const loadEligibleInvoices = useCallback(
    async (targetCustId: string, search = '', retainId = '') => {
      if (!currentOrg || !targetCustId) {
        setEligibleInvoices([]);
        return;
      }
      const seq = ++searchInvSeqRef.current;
      const orgIdAtCall = currentOrg.id;
      setIsSearchingInvoice(true);
      try {
        const res = await invoicesService.getEligiblePaymentInvoices(
          orgIdAtCall,
          targetCustId,
          { page: 1, pageSize: 25, search, exactInvoiceId: retainId || undefined },
          isMockAuth
        );
        if (seq !== searchInvSeqRef.current || activeOrgIdRef.current !== orgIdAtCall) return;
        setEligibleInvoices(res.data);
      } catch (e) {
        if (seq === searchInvSeqRef.current && activeOrgIdRef.current === orgIdAtCall) {
          console.warn('Eligible invoices search error:', e);
        }
      } finally {
        if (seq === searchInvSeqRef.current && activeOrgIdRef.current === orgIdAtCall) {
          setIsSearchingInvoice(false);
        }
      }
    },
    [currentOrg, isMockAuth]
  );

  const handleCustomerSearch = async (query: string) => {
    setCustomerSearchText(query);
    if (!currentOrg) return;
    const seq = ++searchCustSeqRef.current;
    const orgIdAtCall = currentOrg.id;
    setIsSearchingCustomer(true);
    try {
      const res = await customersService.getCustomersPaginated(
        orgIdAtCall,
        { page: 1, pageSize: 25, search: query, isActive: true },
        isMockAuth
      );
      if (seq !== searchCustSeqRef.current || activeOrgIdRef.current !== orgIdAtCall) return;
      setCustomers((prev) => {
        const selected = prev.find((c) => c.id === customerId);
        const map = new Map<string, Customer>();
        if (selected) map.set(selected.id, selected);
        for (const c of res.data) map.set(c.id, c);
        return Array.from(map.values());
      });
    } catch (e) {
      if (seq === searchCustSeqRef.current && activeOrgIdRef.current === orgIdAtCall) {
        console.warn('Customer search error:', e);
      }
    } finally {
      if (seq === searchCustSeqRef.current && activeOrgIdRef.current === orgIdAtCall) {
        setIsSearchingCustomer(false);
      }
    }
  };

  const handleInvoiceSearch = (query: string) => {
    setInvoiceSearchText(query);
    if (customerId) {
      loadEligibleInvoices(customerId, query, invoiceId);
    }
  };

  const initializeAndOpenRecord = useCallback(
    async (preselectedInvoice?: Invoice) => {
      const perm = check('payments:record');
      if (!perm.allowed) {
        showToast('error', perm.title || 'Permission Denied', perm.message || 'Write operations are disabled.');
        clearActionParam();
        return;
      }
      if (!currentOrg) return;

      setIsPreparingRecord(true);
      try {
        const custRes = await customersService.getCustomersPaginated(
          currentOrg.id,
          { page: 1, pageSize: 25, isActive: true },
          isMockAuth
        );

        let custList = custRes.data;

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

        let initialCustId = custList[0]?.id || '';
        let initialInvId = '';
        let initialAmount = '';

        if (preselectedInvoice) {
          initialCustId = preselectedInvoice.customerId;
          initialInvId = preselectedInvoice.id;
          const rem = calculateInvoiceBalance(preselectedInvoice.totalAmount, preselectedInvoice.totalPaid);
          initialAmount = String(rem);

          if (!custList.some((c) => c.id === initialCustId)) {
            const singleCust = await customersService.getCustomerById(currentOrg.id, initialCustId, isMockAuth);
            if (singleCust) {
              custList = [singleCust, ...custList];
            }
          }
        }

        setCustomers(custList);
        setCustomerId(initialCustId);
        setInvoiceId(initialInvId);
        setAmount(initialAmount);
        setCustomerSearchText('');
        setInvoiceSearchText('');
        setPaymentMethod('UPI');
        setReferenceNumber('');
        setPaymentDate(getBusinessDate());
        setNotes('');
        setPaymentIdempotencyKey(typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '');

        if (initialCustId) {
          await loadEligibleInvoices(initialCustId, '', initialInvId);
        } else {
          setEligibleInvoices([]);
        }

        setIsModalOpen(true);
        clearActionParam();
      } catch (err: any) {
        showToast('error', 'Unable to Prepare Payment', err.message || 'Failed to initialize payment form');
      } finally {
        setIsPreparingRecord(false);
      }
    },
    [check, clearActionParam, currentOrg, isMockAuth, loadEligibleInvoices, showToast]
  );

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
        initializeAndOpenRecordRef.current();
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
        showToast('error', 'Loading Error', 'Unable to load payments. Check your connection and try again.');
        return;
      }
      initializeAndOpenRecord();
    }
  }, [searchParams, isLoading, isPreparingRecord, loadError, initializeAndOpenRecord, showToast]);

  // Handle pending open if user clicked "Record Payment" while initial load was running
  useEffect(() => {
    if (pendingOpenRecord && !isLoading && !loadError) {
      setPendingOpenRecord(false);
      initializeAndOpenRecord();
    }
  }, [pendingOpenRecord, isLoading, loadError, initializeAndOpenRecord]);

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
      showToast('error', 'Unable to Load Records', 'Unable to load payments. Check your connection and try again.');
      return;
    }

    initializeAndOpenRecord(preselectedInvoice);
  };

  const handleSelectCustomer = (newCustId: string) => {
    setCustomerId(newCustId);
    setInvoiceId('');
    setAmount('');
    setInvoiceSearchText('');
    if (newCustId) {
      loadEligibleInvoices(newCustId, '', '');
    } else {
      setEligibleInvoices([]);
    }
  };

  const handleSelectInvoice = (selectedId: string) => {
    setInvoiceId(selectedId);
    if (selectedId) {
      const inv = eligibleInvoices.find((i) => i.id === selectedId);
      if (inv) {
        const rem = calculateInvoiceBalance(inv.totalAmount, inv.totalPaid);
        setAmount(String(rem));
      }
    }
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

    // Real-time outstanding balance verification if invoice specified
    if (invoiceId) {
      try {
        const freshInv = await invoicesService.getInvoiceById(currentOrg.id, invoiceId, isMockAuth);
        if (!freshInv) {
          showToast('error', 'Invoice Not Found', 'Target invoice could not be verified.');
          return;
        }
        if (freshInv.status !== 'ISSUED' && freshInv.status !== 'PARTIALLY_PAID') {
          showToast(
            'error',
            'Ineligible Invoice',
            `Selected invoice is not eligible for payment (current status: ${freshInv.status}). Only issued or partially paid invoices can be settled.`
          );
          return;
        }
        const remainingBalance = calculateInvoiceBalance(freshInv.totalAmount, freshInv.totalPaid);
        if (remainingBalance <= 0) {
          showToast('error', 'Invoice Settled', 'This invoice has already been fully settled.');
          return;
        }
        if (payAmount > remainingBalance) {
          showToast(
            'error',
            'Overpayment Violation',
            `Payment amount (${formatCurrency(payAmount)}) exceeds outstanding balance (${formatCurrency(remainingBalance)}). Overpayment policy prevents excess credit without customer advance authorization.`
          );
          return;
        }
      } catch (invErr: any) {
        showToast('error', 'Invoice Verification Failed', invErr.message || 'Could not verify target invoice');
        return;
      }
    }

    setIsSubmitting(true);
    const keyToUse =
      paymentIdempotencyKey ||
      (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '');
    if (!paymentIdempotencyKey && keyToUse) {
      setPaymentIdempotencyKey(keyToUse);
    }

    try {
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
      // Ambiguous network outcome recovery: check if payment committed under keyToUse
      if (keyToUse) {
        try {
          const recovery = await paymentsService.checkPaymentStatusByIdempotencyKey(
            currentOrg.id,
            keyToUse,
            isMockAuth
          );
          if (recovery.committed && recovery.payment) {
            showToast(
              'success',
              'Payment Recovered & Verified',
              `Payment was successfully recorded on the server as receipt ${recovery.payment.paymentNumber}.`
            );
            setIsModalOpen(false);
            setPaymentIdempotencyKey('');
            await loadData();
            return;
          }
        } catch (checkErr) {
          console.warn('Idempotency recovery check warning:', checkErr);
        }
      }

      showToast(
        'error',
        'Payment Failed',
        err.message || 'Payment submission failed. You may retry safely with the preserved transaction key.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

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
      {summaryError ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <div>
              <div className="font-semibold">Authoritative Financial Totals Unavailable</div>
              <div className="text-xs text-amber-800 mt-0.5">{summaryError}</div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => loadData()}>
            Retry Summary
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5">
          <Card hover>
            <div className="text-xs font-medium text-content-secondary mb-1.5">
              Total Receivables Outstanding
            </div>
            <div className="text-2xl font-bold text-amber-800 tabular-nums">
              {summary ? formatCurrency(summary.totalReceivables) : '—'}
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
              {summary ? formatCurrency(summary.totalCollected) : '—'}
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
              {summary ? summary.openInvoicesCount : '—'}
            </div>
            <div className="text-xs text-content-muted mt-1">
              Awaiting payment settlement
            </div>
          </Card>
        </div>
      )}

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
          {/* Customer Lookup with Search & Stable Retention */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-content-secondary">
                Customer <span className="text-red-500">*</span>
              </label>
              {isSearchingCustomer && (
                <span className="text-[11px] text-content-muted flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin text-atlas-600" /> Searching...
                </span>
              )}
            </div>
            <div className="relative mb-1">
              <Search className="w-3 h-3 absolute left-2 top-2 text-content-muted" />
              <input
                type="text"
                placeholder="Type to search customers by name, company, phone..."
                value={customerSearchText}
                onChange={(e) => handleCustomerSearch(e.target.value)}
                className="w-full text-xs rounded-lg border border-border bg-surface-card pl-6 pr-2 py-1 text-content-primary placeholder-content-muted focus:ring-1 focus:ring-atlas-500 focus:outline-none"
              />
            </div>
            <Select
              label=""
              required
              value={customerId}
              onChange={(e) => handleSelectCustomer(e.target.value)}
              options={customers.map((c) => ({
                value: c.id,
                label: `${c.companyName || c.name} — Outstanding: ${formatCurrency(c.currentReceivable || 0)}`,
              }))}
            />
          </div>

          {/* Eligible Invoices Lookup with Search & Balance Display */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-content-secondary">
                Target Invoice to Settle (Optional)
              </label>
              {isSearchingInvoice && (
                <span className="text-[11px] text-content-muted flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin text-atlas-600" /> Searching...
                </span>
              )}
            </div>
            <div className="relative mb-1">
              <Search className="w-3 h-3 absolute left-2 top-2 text-content-muted" />
              <input
                type="text"
                placeholder="Type to search eligible invoices by invoice #..."
                value={invoiceSearchText}
                onChange={(e) => handleInvoiceSearch(e.target.value)}
                className="w-full text-xs rounded-lg border border-border bg-surface-card pl-6 pr-2 py-1 text-content-primary placeholder-content-muted focus:ring-1 focus:ring-atlas-500 focus:outline-none"
              />
            </div>
            <Select
              label=""
              value={invoiceId}
              onChange={(e) => handleSelectInvoice(e.target.value)}
              options={[
                { value: '', label: 'None — General Account Credit' },
                ...eligibleInvoices.map((inv) => {
                  const balance = calculateInvoiceBalance(inv.totalAmount, inv.totalPaid);
                  return {
                    value: inv.id,
                    label: `${inv.invoiceNumber} (Due: ${inv.dueDate}) — Rem: ${formatCurrency(balance)}`,
                  };
                }),
              ]}
            />
          </div>

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
