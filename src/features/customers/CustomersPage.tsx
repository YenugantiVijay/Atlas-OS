import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Users,
  Plus,
  Search,
  Phone,
  Mail,
  MapPin,
  Edit2,
  Loader2,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { useActionPermission } from '@/hooks/useActionPermission';
import { customersService } from '@/services/customers.service';
import { Customer } from '@/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { LoadError } from '@/components/ui/LoadError';
import { useToast } from '@/components/ui/Toast';
import { Pagination } from '@/components/ui/Pagination';
import { paginateArray } from '@/lib/pagination';
import { formatCurrency } from '@/lib/money';

function getInitials(name: string): string {
  if (!name) return 'C';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
}

export const CustomersPage: React.FC = () => {
  const { currentOrg, isMockAuth, canWriteOperations } = useOrg();
  const { check } = useActionPermission();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPreparingCreate, setIsPreparingCreate] = useState(false);
  const [pendingOpenCreate, setPendingOpenCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  // Form Fields
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('+91 ');
  const [email, setEmail] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [gstin, setGstin] = useState('');
  const [creditLimit, setCreditLimit] = useState('100000');
  const [creditDays, setCreditDays] = useState('30');
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const loadCustomers = useCallback(async (targetPage = page, targetPageSize = pageSize): Promise<Customer[] | null> => {
    if (!currentOrg) return null;
    setIsLoading(true);
    setLoadError(null);
    try {
      let res;
      if (typeof customersService.getCustomersPaginated === 'function') {
        res = await customersService.getCustomersPaginated(
          currentOrg.id,
          {
            page: targetPage,
            pageSize: targetPageSize,
            search: searchQuery,
          },
          isMockAuth
        );
      } else {
        const data = await customersService.getCustomers(currentOrg.id, isMockAuth);
        res = paginateArray(
          data,
          {
            page: targetPage,
            pageSize: targetPageSize,
            search: searchQuery,
          },
          (c, s) =>
            c.name.toLowerCase().includes(s) ||
            Boolean(c.companyName && c.companyName.toLowerCase().includes(s)) ||
            Boolean(c.phone && c.phone.toLowerCase().includes(s)) ||
            Boolean(c.email && c.email.toLowerCase().includes(s)) ||
            Boolean(c.gstin && c.gstin.toLowerCase().includes(s))
        );
      }
      setCustomers(res.data);
      setTotalCount(res.totalCount);
      setTotalPages(res.totalPages);
      return res.data;
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Unable to load customers. Check your connection and try again.';
      setLoadError(msg);
      showToast('error', 'Failed to load customers', msg);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [currentOrg, isMockAuth, page, pageSize, searchQuery, showToast]);

  const handleOpenCreate = useCallback(() => {
    const perm = check('customers:manage');
    if (!perm.allowed) {
      showToast('error', perm.title || 'Permission Denied', perm.message || 'Write operations are disabled.');
      clearActionParam();
      return;
    }
    setEditingCustomer(null);
    setName('');
    setCompanyName('');
    setPhone('+91 ');
    setEmail('');
    setBillingAddress('');
    setGstin('');
    setCreditLimit('100000');
    setCreditDays('30');
    setIsModalOpen(true);
    clearActionParam();
  }, [check, clearActionParam, showToast]);

  const checkRef = useRef(check);
  checkRef.current = check;
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const clearActionParamRef = useRef(clearActionParam);
  clearActionParamRef.current = clearActionParam;
  const handleOpenCreateRef = useRef(handleOpenCreate);
  handleOpenCreateRef.current = handleOpenCreate;
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  useEffect(() => {
    setSearchQuery(searchParams.get('search') || '');
  }, [searchParams]);

  useEffect(() => {
    const params = searchParamsRef.current;
    const requestedAction = params.get('action');

    if (requestedAction === 'create') {
      const perm = checkRef.current('customers:manage');
      if (!perm.allowed) {
        showToastRef.current('error', perm.title || 'Permission Denied', perm.message || 'Write operations are disabled.');
        clearActionParamRef.current();
        loadCustomers();
        return;
      }
      setIsPreparingCreate(true);
    }

    loadCustomers().then((res) => {
      setIsPreparingCreate(false);
      if (requestedAction === 'create' && res) {
        handleOpenCreateRef.current();
      }
    });
  }, [loadCustomers]);

  useEffect(() => {
    const action = searchParams.get('action');
    if (action === 'create' && !isLoading && !isPreparingCreate) {
      handleOpenCreate();
    }
  }, [searchParams, isLoading, isPreparingCreate, handleOpenCreate]);

  useEffect(() => {
    if (pendingOpenCreate && !isLoading && !loadError) {
      setPendingOpenCreate(false);
      handleOpenCreate();
    }
  }, [pendingOpenCreate, isLoading, loadError, handleOpenCreate]);

  const handleOpenEdit = (c: Customer) => {
    const perm = check('customers:manage');
    if (!perm.allowed) {
      showToast('error', perm.title || 'Permission Denied', perm.message || 'Write operations are disabled.');
      return;
    }
    setEditingCustomer(c);
    setName(c.name);
    setCompanyName(c.companyName || '');
    setPhone(c.phone || '+91 ');
    setEmail(c.email || '');
    setBillingAddress(c.billingAddress || '');
    setGstin(c.gstin || '');
    setCreditLimit(String(c.creditLimit));
    setCreditDays(String(c.creditDays));
    setIsModalOpen(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    const perm = check('customers:manage');
    if (!perm.allowed) {
      showToast('error', perm.title || 'Permission Denied', perm.message || 'Write operations are disabled.');
      return;
    }
    if (!name.trim()) {
      showToast('error', 'Validation Error', 'Customer Name is required.');
      return;
    }
    if (!currentOrg) return;

    setIsSubmitting(true);
    try {
      if (editingCustomer) {
        await customersService.updateCustomer(
          currentOrg.id,
          editingCustomer.id,
          {
            name: name.trim(),
            companyName: companyName.trim() || undefined,
            phone: phone.trim() || undefined,
            email: email.trim() || undefined,
            billingAddress: billingAddress.trim() || undefined,
            gstin: gstin.trim().toUpperCase() || undefined,
            creditLimit: parseFloat(creditLimit) || 0,
            creditDays: creditDays === '' ? 30 : Number(creditDays),
          },
          isMockAuth
        );
        showToast('success', 'Customer Updated', `Saved details for ${companyName || name}`);
      } else {
        await customersService.createCustomer(
          currentOrg.id,
          {
            name: name.trim(),
            companyName: companyName.trim() || undefined,
            phone: phone.trim() || undefined,
            email: email.trim() || undefined,
            billingAddress: billingAddress.trim() || undefined,
            gstin: gstin.trim().toUpperCase() || undefined,
            creditLimit: parseFloat(creditLimit) || 0,
            creditDays: creditDays === '' ? 30 : Number(creditDays),
            isActive: true,
          },
          isMockAuth
        );
        showToast('success', 'Customer Created', `Added ${companyName || name} to customer directory.`);
      }

      setIsModalOpen(false);
      await loadCustomers();
    } catch (err: any) {
      showToast('error', 'Operation Failed', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredCustomers = customers.filter((c) => {
    const q = searchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.companyName?.toLowerCase().includes(q) ||
      c.phone?.toLowerCase().includes(q) ||
      c.gstin?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              Customers & Contractors
            </h1>
            <Badge variant="teal" size="sm">
              {totalCount} Accounts
            </Badge>
          </div>
          <p className="text-sm text-content-secondary mt-1">
            Electrical contractors, builders, and retail dealers with credit terms and live balances.
          </p>
        </div>

        {(() => {
          const createPerm = check('customers:manage');
          return (
            <Button
              variant="primary"
              onClick={handleOpenCreate}
              leftIcon={<Plus className="w-4 h-4" />}
              disabled={!createPerm.allowed}
              title={!createPerm.allowed ? createPerm.message : undefined}
            >
              Add Customer
            </Button>
          );
        })()}
      </div>

      {/* Preparing Indicator */}
      {(isPreparingCreate || (pendingOpenCreate && isLoading)) && (
        <div role="status" className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-teal-50 border border-teal-200 text-teal-800 text-sm font-medium animate-in fade-in">
          <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
          <span>Preparing customer...</span>
        </div>
      )}

      {/* Recoverable Network Error */}
      {loadError && (
        <LoadError
          message={loadError}
          onRetry={() => loadCustomers()}
        />
      )}

      {/* Search */}
      <Card>
        <Input
          placeholder="Search customers by contractor name, firm name, phone, or GSTIN..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setPage(1);
          }}
          leftIcon={<Search className="w-4 h-4" />}
          aria-label="Search customers"
        />
      </Card>

      {/* Customers Table */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : filteredCustomers.length === 0 ? (
        <EmptyState
          icon={<Users className="w-7 h-7" />}
          title="No customers found"
          description={
            searchQuery
              ? 'No customer records match your search query.'
              : 'Add your first electrical contractor or dealer to start preparing quotations and sales orders.'
          }
          actionLabel={!check('customers:manage').allowed ? undefined : "Add Customer"}
          onAction={handleOpenCreate}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Firm & Contact</TableHead>
              <TableHead>Contact Info</TableHead>
              <TableHead>GSTIN / Tax</TableHead>
              <TableHead className="text-right">Credit Limit & Days</TableHead>
              <TableHead className="text-right">Current Receivable</TableHead>
              <TableHead className="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCustomers.map((c) => {
              const receivable = c.currentReceivable;
              const hasReceivableValue = receivable !== undefined;
              const hasBalance = hasReceivableValue && receivable > 0;
              return (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {c.avatarUrl ? (
                        <img
                          src={c.avatarUrl}
                          alt={c.companyName || c.name}
                          className="w-10 h-10 rounded-full object-cover border border-slate-200 shadow-xs shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-atlas-100 text-atlas-800 font-bold text-xs flex items-center justify-center border border-atlas-200 shrink-0">
                          {getInitials(c.name)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-content-primary truncate max-w-xs">
                          {c.companyName || c.name}
                        </div>
                        {c.companyName && (
                          <div className="text-xs text-content-secondary mt-0.5 truncate">
                            Prop: {c.name}
                          </div>
                        )}
                        {c.billingAddress && (
                          <div className="text-xs text-content-muted mt-1 truncate max-w-xs flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                            <span className="truncate">{c.billingAddress}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="text-xs font-mono text-content-primary flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-slate-400" />
                      <span>{c.phone || '—'}</span>
                    </div>
                    {c.email && (
                      <div className="text-xs text-content-secondary flex items-center gap-1.5 mt-1">
                        <Mail className="w-3.5 h-3.5 text-slate-400" />
                        <span>{c.email}</span>
                      </div>
                    )}
                  </TableCell>

                  <TableCell>
                    <div className="font-mono text-xs font-medium text-content-primary">
                      {c.gstin || 'Unregistered'}
                    </div>
                  </TableCell>

                  <TableCell className="text-right">
                    <div className="text-sm font-semibold text-content-primary tabular-nums">
                      {formatCurrency(c.creditLimit)}
                    </div>
                    <div className="text-xs text-content-muted mt-0.5">
                      {c.creditDays} Days Terms
                    </div>
                  </TableCell>

                  <TableCell className="text-right">
                    {hasReceivableValue ? (
                      <>
                        <div
                          className={`text-sm font-bold tabular-nums ${
                            hasBalance ? 'text-amber-700' : 'text-emerald-700'
                          }`}
                        >
                          {formatCurrency(receivable)}
                        </div>
                        <div className="text-xs text-content-muted mt-0.5">
                          {hasBalance ? 'Outstanding' : 'Settled'}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-sm font-medium text-content-muted">
                          —
                        </div>
                        <div className="text-xs text-content-muted mt-0.5">
                          Unavailable
                        </div>
                      </>
                    )}
                  </TableCell>

                  <TableCell className="text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenEdit(c)}
                      leftIcon={<Edit2 className="w-3.5 h-3.5" />}
                      disabled={!check('customers:manage').allowed}
                      title={!check('customers:manage').allowed ? check('customers:manage').message : undefined}
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

      {/* Pagination Controls */}
      {filteredCustomers.length > 0 && (
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

      {/* Add / Edit Customer Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingCustomer ? 'Edit Customer Record' : 'Add New Customer Account'}
        description="Register commercial electrical contractors, retail partners, or institutions."
        maxWidth="lg"
      >
        <form onSubmit={handleSaveCustomer} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Firm / Trade Name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Bangalore Electro Enterprises"
            />
            <Input
              label="Contact Person Name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ramesh Kumar"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Phone Number"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98765 43210"
            />
            <Input
              label="Email Address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="billing@customer.com"
            />
          </div>

          <Input
            label="GSTIN (15 Digits)"
            value={gstin}
            onChange={(e) => setGstin(e.target.value)}
            placeholder="29AAAAA0000A1Z5"
          />

          <Input
            label="Billing & Delivery Address"
            value={billingAddress}
            onChange={(e) => setBillingAddress(e.target.value)}
            placeholder="Site 48, Peenya Industrial Area 2nd Stage, Bengaluru"
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Credit Limit (₹)"
              type="number"
              step="1000"
              value={creditLimit}
              onChange={(e) => setCreditLimit(e.target.value)}
            />
            <Input
              label="Credit Period (Days)"
              type="number"
              value={creditDays}
              onChange={(e) => setCreditDays(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2.5 pt-4 border-t border-border mt-5">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsModalOpen(false)}
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
              {editingCustomer ? 'Update Customer' : 'Save Customer'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
