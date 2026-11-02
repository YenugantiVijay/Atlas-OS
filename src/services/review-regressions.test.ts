import { beforeEach, describe, expect, it, vi } from 'vitest';
import { productsService, mapDbProduct } from './products.service';
import { customersService, mapDbCustomer } from './customers.service';
import { ordersService } from './orders.service';
import { invoicesService } from './invoices.service';
import { paymentsService } from './payments.service';
import { storage } from '@/lib/storage';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from } }));

function queryResult(data: unknown, error: { message: string } | null = null) {
  const result = { data, error };
  return {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
}

const customer = { id: 'customer-1', organization_id: 'org-1', name: 'Cloud Customer', credit_days: 0 };

beforeEach(() => vi.clearAllMocks());

describe('Review: truthful cloud reads', () => {
  it('preserves zero-day credit terms and zero reorder thresholds', () => {
    expect(mapDbCustomer(customer).creditDays).toBe(0);
    expect(mapDbProduct({ reorder_threshold: 0 }).reorderThreshold).toBe(0);
    expect(mapDbProduct({ reorder_threshold: null }).reorderThreshold).toBe(10);
  });

  it('saves zero-day credit terms to the database', async () => {
    const query = queryResult(customer);
    from.mockReturnValue(query);
    await customersService.createCustomer('org-1', {
      name: 'Cloud Customer', creditDays: 0, creditLimit: 0, isActive: true,
    });
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ credit_days: 0 }));
  });

  it('does not turn a stock ledger failure into zero available stock', async () => {
    from.mockImplementation((table: string) => table === 'products'
      ? queryResult([{ id: 'product-1' }])
      : queryResult(null, { message: 'Ledger unavailable' }));
    await expect(productsService.getProducts('org-1')).rejects.toThrow('Failed to load stock totals');
  });

  it('does not turn an invoice failure into zero customer debt', async () => {
    from.mockImplementation((table: string) => table === 'customers'
      ? queryResult([customer])
      : queryResult(null, { message: 'Invoices unavailable' }));
    await expect(customersService.getCustomers('org-1')).rejects.toThrow('Failed to load customer receivables');
  });

  it.each([
    ['orders', ordersService.getSalesOrders, 'fk_sales_orders_customer_org'],
    ['quotations', ordersService.getQuotations, 'fk_quotations_customer_org'],
    ['invoices', invoicesService.getInvoices, 'fk_invoices_customer_org'],
    ['payments', paymentsService.getPayments, 'fk_payments_customer_org'],
  ] as const)('includes customer identity in cloud %s using the tenant relationship', async (_name, getRecords, relationship) => {
    const query = queryResult([{ id: 'record-1', customer_id: customer.id, customer }]);
    from.mockReturnValue(query);
    const records = await getRecords('org-1', false);
    expect(records[0].customer?.name).toBe('Cloud Customer');
    expect(query.select).toHaveBeenCalledWith(expect.stringContaining(`customer:customers!${relationship}(*)`));
    expect(query.eq).toHaveBeenCalledWith('organization_id', 'org-1');
  });
});

it('does not recognize draft orders as sales before confirmation', () => {
  localStorage.clear();
  storage.initialize(true);
  const orgId = storage.getOrganizations()[0].id;
  const before = storage.getDashboardMetrics(orgId).todaySales;
  const product = storage.getProducts(orgId)[0];
  storage.createSalesOrder(orgId, {
    customerId: storage.getCustomers(orgId)[0].id,
    orderDate: new Date().toISOString().split('T')[0],
    items: [{ productId: product.id, productName: product.name, productSku: product.sku,
      uom: product.uom, quantity: 1, unitPrice: 100, taxRate: 0, discountPercent: 0 }],
  });
  expect(storage.getDashboardMetrics(orgId).todaySales).toBe(before);
});
