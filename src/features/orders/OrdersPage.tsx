import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useIndustryTool } from '@/hooks/useIndustryTool';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import {
  FileText,
  Plus,
  Search,
  CheckCircle2,
  Eye,
  Receipt,
  Trash2,
  Loader2,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { useActionPermission } from '@/hooks/useActionPermission';
import { ordersService } from '@/services/orders.service';
import { customersService } from '@/services/customers.service';
import { productsService } from '@/services/products.service';
import { invoicesService } from '@/services/invoices.service';
import { SalesOrder, Customer, Product, OrderStatus } from '@/types';
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
import { formatCurrency, calculateLineItem, calculateDocumentTotals, resolveDocumentPresentation } from '@/lib/money';
import { ONLINE_CHANNELS, onlineChannelLabel, validateOnlineReference, type OnlineChannel } from '@/lib/online-orders';
import { getBusinessDate } from '@/lib/dates';
import { validateQuantityInput, validateMoneyInput, parseStrictNumber } from '@/lib/validation';

interface LineItemDraft {
  productId: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxRate: number;
}

export const OrdersPage: React.FC<{ onlineOnly?: boolean }> = ({ onlineOnly = false }) => {
  const { currentOrg, currentRole, isMockAuth, canWriteOperations } = useOrg();
  const { check } = useActionPermission();
  const tool = useIndustryTool();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const createRequested = searchParams.get('action') === 'create';
  const [pendingOpenCreate, setPendingOpenCreate] = useState(false);
  const [prerequisite, setPrerequisite] = useState<PrerequisiteInfo | null>(null);
  const linkedSearch = searchParams.get('search') || '';
  const [searchQuery, setSearchQuery] = useState(linkedSearch);
  const [statusFilter, setStatusFilter] = useState<'ALL' | OrderStatus>('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  useEffect(() => { setSearchQuery(linkedSearch); setPage(1); }, [linkedSearch]);

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [dispatchFields, setDispatchFields] = useState({ carrier: '', tracking: '' });
  const [savingDispatch, setSavingDispatch] = useState(false);
  const [viewingOrder, setViewingOrder] = useState<SalesOrder | null>(null);
  const [orderToConfirm, setOrderToConfirm] = useState<SalesOrder | null>(null);

  // Form State
  const [customerId, setCustomerId] = useState('');
  const [orderDate, setOrderDate] = useState(getBusinessDate());
  const [notes, setNotes] = useState('');
  const [onlineChannel, setOnlineChannel] = useState<OnlineChannel>('storefront');
  const [onlineReference, setOnlineReference] = useState('');
  const [items, setItems] = useState<LineItemDraft[]>([]);
  const [orderIdempotencyKey, setOrderIdempotencyKey] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [invoicingOrderId, setInvoicingOrderId] = useState<string | null>(null);
  const [confirmingOrderId, setConfirmingOrderId] = useState<string | null>(null);

  // Searchable selection state for scalable order creation
  const [customerSearchText, setCustomerSearchText] = useState('');
  const [isSearchingCustomer, setIsSearchingCustomer] = useState(false);
  const [productSearchQueries, setProductSearchQueries] = useState<Record<number, string>>({});
  const [lineItemProductsMap, setLineItemProductsMap] = useState<Record<number, Product[]>>({});
  const [cachedProductsMap, setCachedProductsMap] = useState<Record<string, Product>>({});

  const activeOrgIdRef = useRef(currentOrg?.id);
  useEffect(() => {
    if (currentOrg?.id !== activeOrgIdRef.current) {
      activeOrgIdRef.current = currentOrg?.id;
      // Stale response guard and form reset on organization switch
      setIsCreateModalOpen(false);
      setViewingOrder(null);
      setOrderToConfirm(null);
      setConfirmingOrderId(null);
      setCustomerId('');
      setItems([]);
      setOrderIdempotencyKey('');
      setCustomerSearchText('');
      setProductSearchQueries({});
      setLineItemProductsMap({});
      setCachedProductsMap({});
      setPage(1);
    }
  }, [currentOrg?.id]);

  const loadData = useCallback(async (targetPage = page, targetPageSize = pageSize): Promise<{ customers: Customer[]; products: Product[] } | null> => {
    if (!currentOrg) return null;
    const orgIdAtCall = currentOrg.id;
    setIsLoading(true);
    setLoadError(null);
    try {
      const ordPromise = typeof ordersService.getSalesOrdersPaginated === 'function'
        ? ordersService.getSalesOrdersPaginated(
            currentOrg.id,
            {
              page: targetPage,
              pageSize: targetPageSize,
              search: searchQuery,
              ...(onlineOnly && { onlineOnly }),
              status: statusFilter === 'ALL' ? undefined : statusFilter,
            },
            isMockAuth
          )
        : ordersService.getSalesOrders(currentOrg.id, isMockAuth).then((data) =>
            paginateArray(onlineOnly ? data.filter(order => order.onlineOrder) : data, {
              page: targetPage,
              pageSize: targetPageSize,
              search: searchQuery,
              status: statusFilter === 'ALL' ? undefined : statusFilter,
            })
          );

      const custPromise = typeof customersService.getCustomersPaginated === 'function'
        ? customersService.getCustomersPaginated(currentOrg.id, { page: 1, pageSize: 25, isActive: true }, isMockAuth).then((r) => r.data)
        : customersService.getCustomers(currentOrg.id, isMockAuth);

      const prodPromise = typeof productsService.getProductsPaginated === 'function'
        ? productsService.getProductsPaginated(currentOrg.id, { page: 1, pageSize: 25, isActive: true }, isMockAuth).then((r) => r.data)
        : productsService.getProducts(currentOrg.id, isMockAuth);

      const [ordRes, custList, prodList] = await Promise.all([
        ordPromise,
        custPromise,
        prodPromise,
      ]);

      if (activeOrgIdRef.current !== orgIdAtCall) return null;

      setOrders(ordRes.data);
      setTotalCount(ordRes.totalCount);
      setTotalPages(ordRes.totalPages);
      setCustomers(custList);
      setProducts(prodList);

      setCachedProductsMap((prev) => {
        const next = { ...prev };
        for (const p of prodList) {
          next[p.id] = p;
        }
        return next;
      });

      return { customers: custList, products: prodList };
    } catch (err: any) {
      if (activeOrgIdRef.current !== orgIdAtCall) return null;
      const msg = err instanceof Error ? err.message : 'Unable to load the required records. Check your connection and try again.';
      setLoadError(msg);
      showToast('error', 'Failed to load orders', msg);
      return null;
    } finally {
      if (activeOrgIdRef.current === orgIdAtCall) {
        setIsLoading(false);
      }
    }
  }, [currentOrg, isMockAuth, page, pageSize, searchQuery, statusFilter, showToast, onlineOnly]);

  const initializeAndOpenCreate = useCallback((custList: Customer[], prodList: Product[]) => {
    const perm = check('orders:create');
    if (!perm.allowed) {
      showToast('error', perm.title || 'Permission Denied', perm.message || 'Write operations are disabled.');
      return;
    }

    if (custList.length === 0) {
      showToast('warning', 'No Customers Found', 'No customers found. Add a customer before creating this sales order.');
      setPrerequisite({
        type: 'customer',
        title: 'No Customers Found',
        message: 'No customers found. Add a customer before creating this sales order.',
        actionRoute: '/customers?action=create',
        actionLabel: 'Add Customer',
      });
      return;
    }

    if (prodList.length === 0) {
      showToast('warning', 'No Products Found', 'No products found. Add a product before creating this sales order.');
      setPrerequisite({
        type: 'product',
        title: 'No Products Found',
        message: 'No products found. Add a product before creating this sales order.',
        actionRoute: '/products?action=create',
        actionLabel: 'Add Product',
      });
      return;
    }

    setCustomerId(custList[0]?.id || '');
    setOrderDate(getBusinessDate());
    setNotes('');
    setOnlineChannel('storefront');
    setOnlineReference('');
    setOrderIdempotencyKey(typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '');

    setItems([
      {
        productId: prodList[0].id,
        quantity: 1,
        unitPrice: prodList[0].sellingPrice,
        discountPercent: 0,
        taxRate: prodList[0].taxRate,
      },
    ]);
    setIsCreateModalOpen(true);
  }, [check, showToast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handledCreateParams = useRef<URLSearchParams | null>(null);
  useEffect(() => {
    if (!createRequested) {
      handledCreateParams.current = null;
      return;
    }
    if (handledCreateParams.current === searchParams) return;

    const allowed = check('orders:create').allowed;
    if (allowed && (isLoading || loadError)) return;

    // Consume the URL action once, including when effects re-run before the
    // router commits the replacement. Button opens do not rewrite the URL.
    handledCreateParams.current = searchParams;
    const remaining = new URLSearchParams(searchParams);
    remaining.delete('action');
    setSearchParams(remaining, { replace: true });
    initializeAndOpenCreate(customers, products);
  }, [createRequested, searchParams, setSearchParams, isLoading, loadError, customers, products, check, initializeAndOpenCreate]);

  // Handle pending open if user clicked "New Sales Order" while initial load was running
  useEffect(() => {
    if (pendingOpenCreate && !isLoading && !loadError) {
      setPendingOpenCreate(false);
      initializeAndOpenCreate(customers, products);
    }
  }, [pendingOpenCreate, isLoading, loadError, customers, products, initializeAndOpenCreate]);

  const handleOpenCreate = () => {
    const perm = check('orders:create');
    if (!perm.allowed) {
      showToast('error', perm.title || 'Permission Denied', perm.message || 'Write operations are disabled.');
      return;
    }

    if (isLoading) {
      setPendingOpenCreate(true);
      showToast('info', 'Preparing Sales Order', 'Preparing sales order...');
      return;
    }

    if (loadError) {
      showToast('error', 'Unable to Load Records', 'Unable to load the required records. Check your connection and try again.');
      return;
    }

    initializeAndOpenCreate(customers, products);
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
        const prod = cachedProductsMap[val] || products.find((p) => p.id === val);
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

  const handleCustomerSearch = async (query: string) => {
    setCustomerSearchText(query);
    if (!currentOrg) return;
    setIsSearchingCustomer(true);
    try {
      if (typeof customersService.getCustomersPaginated === 'function') {
        const res = await customersService.getCustomersPaginated(
          currentOrg.id,
          { page: 1, pageSize: 25, search: query, isActive: true },
          isMockAuth
        );
        setCustomers((prev) => {
          const selected = prev.find((c) => c.id === customerId);
          const map = new Map<string, Customer>();
          if (selected) map.set(selected.id, selected);
          for (const c of res.data) map.set(c.id, c);
          return Array.from(map.values());
        });
      }
    } catch (e) {
      console.warn('Customer search error:', e);
    } finally {
      setIsSearchingCustomer(false);
    }
  };

  const handleProductSearch = async (itemIndex: number, query: string) => {
    setProductSearchQueries((prev) => ({ ...prev, [itemIndex]: query }));
    if (!currentOrg) return;
    try {
      if (typeof productsService.getProductsPaginated === 'function') {
        const res = await productsService.getProductsPaginated(
          currentOrg.id,
          { page: 1, pageSize: 25, search: query, isActive: true },
          isMockAuth
        );
        setCachedProductsMap((prev) => {
          const next = { ...prev };
          for (const p of res.data) next[p.id] = p;
          return next;
        });
        setLineItemProductsMap((prev) => ({ ...prev, [itemIndex]: res.data }));
      }
    } catch (e) {
      console.warn('Product search error:', e);
    }
  };

  const calculateTotals = () => {
    return calculateDocumentTotals(items);
  };

  const handleSaveOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    const perm = check('orders:create');
    if (!perm.allowed) {
      showToast('error', perm.title || 'Permission Denied', perm.message || 'Write operations are disabled.');
      return;
    }
    if (!customerId) {
      showToast('error', 'Customer Required', 'Please select a customer for the order.');
      return;
    }
    if (items.length === 0) {
      showToast('error', 'Items Required', 'At least one line item is required.');
      return;
    }

    // Strict Line Item Validation: Distinguish 0, negative values, non-integers, invalid characters
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      const qtyVal = validateQuantityInput(it.quantity, `Item ${idx + 1} Quantity`);
      if (!qtyVal.valid || qtyVal.value === undefined) {
        showToast('error', 'Validation Error', qtyVal.error || `Item ${idx + 1} quantity must be at least 1.`);
        return;
      }
      const priceVal = validateMoneyInput(it.unitPrice, `Item ${idx + 1} Unit Price`, { required: true, allowZero: true });
      if (!priceVal.valid || priceVal.value === undefined) {
        showToast('error', 'Validation Error', priceVal.error || `Item ${idx + 1} unit price cannot be negative.`);
        return;
      }
      const discVal = parseStrictNumber(it.discountPercent, {
        fieldName: `Item ${idx + 1} Discount`,
        min: 0,
        max: 100,
        required: false,
        defaultValue: 0,
      });
      if (!discVal.valid) {
        showToast('error', 'Validation Error', discVal.error || `Item ${idx + 1} discount must be between 0% and 100%.`);
        return;
      }
    }

    if (!currentOrg) return;

    setIsSubmitting(true);
    try {
      const formattedItems = items.map((it) => {
        const prod = cachedProductsMap[it.productId] || products.find((p) => p.id === it.productId);
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

      const keyToUse =
        orderIdempotencyKey ||
        (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '');
      if (!orderIdempotencyKey && keyToUse) {
        setOrderIdempotencyKey(keyToUse);
      }

      const order = await ordersService.createSalesOrder(
        currentOrg.id,
        {
          customerId,
          orderDate,
          notes: notes.trim() || undefined,
          ...(onlineOnly && { onlineOrder: validateOnlineReference({ channel: onlineChannel, reference: onlineReference }) }),
          idempotencyKey: keyToUse || undefined,
          items: formattedItems,
        },
        isMockAuth
      );

      showToast('success', 'Order Created', `Order ${order.orderNumber} saved as Draft.`);
      setIsCreateModalOpen(false);
      setOrderIdempotencyKey('');
      await loadData();
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
  const handleConfirmOrder = async (order: SalesOrder) => {
    const perm = check('orders:confirm');
    if (!perm.allowed) {
      showToast('error', perm.title || 'Permission Denied', perm.message || 'Write operations are disabled.');
      return;
    }
    if (!currentOrg) return;
    if (confirmingOrderId) return;
    setConfirmingOrderId(order.id);
    try {
      await ordersService.confirmSalesOrder(currentOrg.id, order.id, currentRole, isMockAuth);
      showToast(
        'success',
        'Order Confirmed & Stock Deducted',
        `Sales Order ${order.orderNumber} confirmed. Stock movements created in ledger.`
      );
      await loadData();
      if (viewingOrder?.id === order.id) {
        setViewingOrder(null);
      }
    } catch (err: any) {
      showToast('error', 'Confirmation Rejected', err.message);
    } finally {
      setConfirmingOrderId(null);
    }
  };

  const handleCreateInvoice = async (order: SalesOrder) => {
    const perm = check('invoices:create');
    if (!perm.allowed) {
      showToast('error', perm.title || 'Permission Denied', perm.message || 'Write operations are disabled.');
      return;
    }
    if (!currentOrg || invoicingOrderId) return;
    setInvoicingOrderId(order.id);
    try {
      const inv = await invoicesService.createInvoiceFromOrder(currentOrg.id, order.id, isMockAuth);
      showToast('success', 'Invoice Generated', `Generated Tax Invoice ${inv.invoiceNumber} for ${order.orderNumber}.`);
      navigate('/invoices');
    } catch (err: any) {
      showToast('error', 'Invoicing Failed', err.message);
    } finally {
      setInvoicingOrderId(null);
    }
  };

  const openOrder = (order: SalesOrder) => {
    setDispatchFields({ carrier: order.dispatch?.carrier ?? '', tracking: order.dispatch?.tracking ?? '' });
    setViewingOrder(order);
  };

  const saveDispatch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentOrg || !viewingOrder || savingDispatch || !check('orders:confirm').allowed) return;
    const order = viewingOrder;
    setSavingDispatch(true);
    try {
      const dispatch = await ordersService.recordOnlineDispatch(
        currentOrg.id, order, dispatchFields.carrier, dispatchFields.tracking, isMockAuth,
      );
      setViewingOrder(current => current?.id === order.id ? { ...current, dispatch } : current);
      showToast('success', 'Dispatch saved', 'The carrier and tracking reference are on this order.');
      await loadData();
    } catch (error) {
      showToast('error', 'Dispatch could not be saved', error instanceof Error ? error.message : 'Try opening the order again.');
    } finally {
      setSavingDispatch(false);
    }
  };

  const totals = calculateTotals();

  const filteredOrders = orders.filter((o) => {
    const s = searchQuery.toLowerCase();
    const matchesSearch =
      o.orderNumber.toLowerCase().includes(s) ||
      o.onlineOrder?.reference.toLowerCase().includes(s.trim()) ||
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
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              {onlineOnly ? 'E-commerce Orders' : 'Sales Orders'}
            </h1>
            <Badge variant="teal" size="sm">
              {totalCount} Orders
            </Badge>
          </div>
          <p className="text-sm text-content-secondary mt-1">
            {onlineOnly
              ? 'Record orders from your website, marketplaces, or chat. Confirm stock before invoicing.'
              : 'Create drafts, confirm available stock, and generate invoices.'}
          </p>
        </div>

        {(() => {
          const createPerm = check('orders:create');
          return (
            <Button
              variant="primary"
              onClick={handleOpenCreate}
              leftIcon={<Plus className="w-4 h-4" />}
              disabled={!createPerm.allowed}
              title={!createPerm.allowed ? createPerm.message : undefined}
            >
              {onlineOnly ? 'New Online Order' : 'New Sales Order'}
            </Button>
          );
        })()}
      </div>

      {onlineOnly && (
        <div className="rounded-xl border border-atlas-200 bg-atlas-50 p-4 text-sm">
          <h2 className="font-semibold text-atlas-800">Online order workflow</h2>
          <p className="mt-1 text-content-secondary">
            Add the order reference from your sales channel. Confirming the order checks and deducts stock.
            Create an invoice, record your carrier and tracking reference, and enter verified collections in Payments.
          </p>
          {!tool && <Link to="/orders" className="mt-2 inline-block font-semibold text-atlas-800 underline">View all sales orders</Link>}
        </div>
      )}

      {/* Preparing Indicator */}
      {((createRequested || pendingOpenCreate) && isLoading) && (
        <div role="status" className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-teal-50 border border-teal-200 text-teal-800 text-sm font-medium animate-in fade-in">
          <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
          <span>Preparing sales order...</span>
        </div>
      )}

      {/* Recoverable Network Error */}
      {loadError && (
        <LoadError
          message={loadError}
          onRetry={() => loadData()}
        />
      )}

      {/* Search & Status Filters */}
      <Card>
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          <div className="flex-1 max-w-md w-full">
            <Input
              placeholder={onlineOnly ? "Order number or external reference" : "Search orders by SO number or customer firm…"}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              leftIcon={<Search className="w-4 h-4" />}
              aria-label="Search sales orders"
            />
          </div>

          {/* Content-driven status filter pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
            {(
              [
                { id: 'ALL', label: 'All Orders' },
                { id: 'DRAFT', label: 'Draft' },
                { id: 'CONFIRMED', label: 'Confirmed' },
                { id: 'FULFILLED', label: onlineOnly ? 'Invoiced' : 'Fulfilled' },
                { id: 'CANCELLED', label: 'Cancelled' },
              ] as const
            ).map((tab) => {
              const active = statusFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setStatusFilter(tab.id as any);
                    setPage(1);
                  }}
                  className={`h-9 px-3.5 text-xs font-medium rounded-lg whitespace-nowrap transition-all duration-150 select-none ${
                    active
                      ? 'bg-atlas-50 text-atlas-900 border border-atlas-300 font-semibold shadow-2xs'
                      : 'bg-white text-content-secondary border border-border hover:bg-slate-50 hover:text-content-primary'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Orders Table */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : filteredOrders.length === 0 ? (
        <EmptyState
          icon={<FileText className="w-7 h-7" />}
          title={onlineOnly ? 'No online orders found' : 'No sales orders found'}
          description={onlineOnly
            ? 'Record a website, marketplace, or chat order to see it here.'
            : 'Create sales orders directly or convert accepted contractor quotations.'}
          actionLabel={!onlineOnly && check('orders:create').allowed ? 'New Sales Order' : undefined}
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
                  <span className="font-mono font-bold text-xs text-atlas-800 bg-atlas-50 px-2 py-0.5 rounded border border-atlas-200/80">
                    {o.orderNumber}
                  </span>
                  {o.onlineOrder && (
                    <div className="mt-1 max-w-52 break-words text-xs text-content-muted">
                      {onlineChannelLabel(o.onlineOrder.channel)} · {o.onlineOrder.reference}
                    </div>
                  )}
                  {o.quotationId && (
                    <div className="text-xs text-content-muted mt-1">
                      From Quote
                    </div>
                  )}
                </TableCell>

                <TableCell>
                  <div className="font-semibold text-sm text-content-primary">
                    {o.customer?.companyName || o.customer?.name}
                  </div>
                  {o.customer?.companyName && (
                    <div className="text-xs text-content-secondary mt-0.5">{o.customer.name}</div>
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
                    showDot
                    size="sm"
                  >
                    {onlineOnly && o.status === 'FULFILLED' ? 'Invoiced' : o.status}
                  </Badge>
                </TableCell>

                <TableCell className="text-right font-bold text-sm text-content-primary tabular-nums">
                  {formatCurrency(o.totalAmount)}
                </TableCell>

                <TableCell className="text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openOrder(o)}
                      leftIcon={<Eye className="w-3.5 h-3.5" />}
                    >
                      View
                    </Button>

                    {o.status === 'DRAFT' && (() => {
                      const confirmPerm = check('orders:confirm');
                      return (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setOrderToConfirm(o)}
                          leftIcon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                          disabled={!confirmPerm.allowed}
                          title={!confirmPerm.allowed ? confirmPerm.message : undefined}
                        >
                          Confirm
                        </Button>
                      );
                    })()}

                    {o.status === 'CONFIRMED' && (() => {
                      const invoicePerm = check('invoices:create');
                      return (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleCreateInvoice(o)}
                          leftIcon={<Receipt className="w-3.5 h-3.5" />}
                          isLoading={invoicingOrderId === o.id}
                          disabled={!!invoicingOrderId || !invoicePerm.allowed}
                          title={!invoicePerm.allowed ? invoicePerm.message : undefined}
                        >
                          Invoice
                        </Button>
                      );
                    })()}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Pagination Controls */}
      {filteredOrders.length > 0 && (
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

      {/* Create Order Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title={onlineOnly ? 'Create Online Order' : 'Create Sales Order'}
        description="Record commercial sales order. Stock will be verified upon confirmation."
        maxWidth="3xl"
      >
        <form onSubmit={handleSaveOrder} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-content-secondary">
                  Customer <span className="text-red-500">*</span>
                </label>
                {isSearchingCustomer && (
                  <span className="text-[10px] text-content-muted flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin text-atlas-600" /> Searching...
                  </span>
                )}
              </div>
              <div className="relative mb-1">
                <Search className="w-3 h-3 absolute left-2 top-2 text-content-muted" />
                <input
                  type="text"
                  aria-label="Find a customer"
                  placeholder="Type to search customers..."
                  value={customerSearchText}
                  onChange={(e) => handleCustomerSearch(e.target.value)}
                  className="w-full text-xs rounded-lg border border-border bg-surface-card pl-6 pr-2 py-1 text-content-primary placeholder-content-muted focus:ring-1 focus:ring-atlas-500 focus:outline-none"
                />
              </div>
              <Select
                aria-label="Customer"
                required
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                options={customers.map((c) => ({
                  value: c.id,
                  label: `${c.companyName || c.name} (${c.phone || ''})`,
                }))}
              />
            </div>
            <Input
              label="Order Date"
              type="date"
              required
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
            />
          </div>

          {onlineOnly && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Sales channel" value={onlineChannel} options={[...ONLINE_CHANNELS]}
                onChange={(event) => setOnlineChannel(event.target.value as OnlineChannel)} />
              <Input label="External order reference" required maxLength={100} value={onlineReference}
                onChange={(event) => setOnlineReference(event.target.value)} placeholder="e.g. WEB-1042" />
            </div>
          )}

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
                      <div className="relative mb-1">
                        <Search className="w-3 h-3 absolute left-1.5 top-1.5 text-content-muted" />
                        <input
                          type="text"
                          placeholder="Filter products..."
                          value={productSearchQueries[idx] || ''}
                          onChange={(e) => handleProductSearch(idx, e.target.value)}
                          className="w-full text-[11px] rounded border border-border/70 bg-surface-card pl-5 pr-1.5 py-0.5 text-content-primary placeholder-content-muted focus:outline-none focus:border-atlas-500"
                        />
                      </div>
                      <select
                        aria-label={`Product ${idx + 1}`}
                        value={item.productId}
                        onChange={(e) => handleItemChange(idx, 'productId', e.target.value)}
                        className="w-full text-xs rounded-lg border border-border bg-surface-card p-1.5 font-medium"
                      >
                        {(() => {
                          const list = lineItemProductsMap[idx] || products;
                          const hasSelected = list.some((p) => p.id === item.productId);
                          const finalOptions = hasSelected
                            ? list
                            : selectedProd
                            ? [selectedProd, ...list]
                            : list;
                          return finalOptions.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} ({p.sku}) — Available: {p.currentStock || 0} {p.uom}
                            </option>
                          ));
                        })()}
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
              <span>Total Order Value:</span>
              <span className="font-mono text-atlas-700">{formatCurrency(totals.totalAmount)}</span>
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
              onClick={() => {
                setIsCreateModalOpen(false);
                setOrderIdempotencyKey('');
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
              {onlineOnly ? 'Save Online Order' : 'Save Sales Order'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* View Order Modal */}
      {viewingOrder && (
        <Modal
          isOpen={Boolean(viewingOrder)}
          onClose={() => { if (!savingDispatch) setViewingOrder(null); }}
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

            {viewingOrder.onlineOrder && <section className="space-y-3 rounded-xl border border-atlas-200 bg-atlas-50 p-3">
              <h3 className="text-sm font-semibold">Online order and dispatch</h3>
              <p className="break-words">{onlineChannelLabel(viewingOrder.onlineOrder.channel)} · {viewingOrder.onlineOrder.reference}</p>
              {viewingOrder.dispatch && <p className="break-words">Dispatch recorded · {viewingOrder.dispatch.carrier} · {viewingOrder.dispatch.tracking}</p>}
              {['CONFIRMED', 'FULFILLED'].includes(viewingOrder.status) && check('orders:confirm').allowed ? (
                <form onSubmit={saveDispatch} className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <Input label="Carrier" maxLength={80} required value={dispatchFields.carrier}
                    onChange={event => setDispatchFields(fields => ({ ...fields, carrier: event.target.value }))} />
                  <Input label="Tracking reference" maxLength={100} required value={dispatchFields.tracking}
                    onChange={event => setDispatchFields(fields => ({ ...fields, tracking: event.target.value }))} />
                  <Button type="submit" isLoading={savingDispatch}>Save dispatch</Button>
                </form>
              ) : viewingOrder.status === 'DRAFT' && <p>Confirm this order before recording dispatch details.</p>}
            </section>}

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

            {/* Totals Summary */}
            {(() => {
              const presentation = resolveDocumentPresentation(viewingOrder);
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
              <Button variant="outline" disabled={savingDispatch} onClick={() => setViewingOrder(null)}>
                Close
              </Button>

              {viewingOrder.status === 'DRAFT' && (() => {
                const confirmPerm = check('orders:confirm');
                return (
                  <Button
                    variant="primary"
                    onClick={() => setOrderToConfirm(viewingOrder)}
                    leftIcon={<CheckCircle2 className="w-4 h-4" />}
                    disabled={!confirmPerm.allowed}
                    title={!confirmPerm.allowed ? confirmPerm.message : undefined}
                  >
                    Confirm Order & Deduct Stock
                  </Button>
                );
              })()}

              {viewingOrder.status === 'CONFIRMED' && (() => {
                const invoicePerm = check('invoices:create');
                return (
                  <Button
                    variant="primary"
                    onClick={() => handleCreateInvoice(viewingOrder)}
                    leftIcon={<Receipt className="w-4 h-4" />}
                    isLoading={invoicingOrderId === viewingOrder.id}
                    disabled={!!invoicingOrderId || !invoicePerm.allowed}
                    title={!invoicePerm.allowed ? invoicePerm.message : undefined}
                  >
                    Generate Tax Invoice
                  </Button>
                );
              })()}
            </div>
          </div>
        </Modal>
      )}

      {/* Confirmation Dialog for Irreversible Stock Deduction */}
      {orderToConfirm && (
        <Modal
          isOpen={Boolean(orderToConfirm)}
          onClose={() => setOrderToConfirm(null)}
          title="Confirm Order & Deduct Inventory"
          description={`Order #${orderToConfirm.orderNumber}`}
          maxWidth="md"
        >
          <div className="space-y-4">
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-900 text-sm">
              <p className="font-semibold">Verify inventory allocation</p>
              <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                Confirming order <strong>{orderToConfirm.orderNumber}</strong> will immediately deduct stock from your warehouse inventory ledger. This action cannot be reversed without an authorized return inward or stock adjustment.
              </p>
            </div>

            <div className="text-sm text-content-secondary space-y-2 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
              <div className="flex justify-between">
                <span>Customer:</span>
                <span className="font-semibold text-content-primary">
                  {orderToConfirm.customer?.companyName || orderToConfirm.customer?.name}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Total Items:</span>
                <span className="font-semibold text-content-primary">
                  {orderToConfirm.items?.length || 0} line items
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5">
                <span>Total Order Value:</span>
                <span className="font-bold text-content-primary tabular-nums">
                  {formatCurrency(orderToConfirm.totalAmount)}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-3 border-t border-border">
              <Button variant="outline" onClick={() => setOrderToConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  const target = orderToConfirm;
                  setOrderToConfirm(null);
                  await handleConfirmOrder(target);
                }}
                isLoading={confirmingOrderId === orderToConfirm.id}
                leftIcon={<CheckCircle2 className="w-4 h-4 text-emerald-300" />}
                disabled={!check('orders:confirm').allowed || Boolean(confirmingOrderId)}
                title={!check('orders:confirm').allowed ? check('orders:confirm').message : undefined}
              >
                Confirm & Allocate Stock
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Missing Customer / Product Prerequisite Modal */}
      <PrerequisiteModal
        prerequisite={prerequisite}
        onClose={() => setPrerequisite(null)}
      />
    </div>
  );
};
