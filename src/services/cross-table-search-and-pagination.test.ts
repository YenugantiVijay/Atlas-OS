import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabase';
import { invoicesService } from './invoices.service';
import { ordersService } from './orders.service';
import { paymentsService } from './payments.service';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

const ORG_ID = '11111111-1111-1111-1111-111111111111';

describe('Phase 2: Cloud Cross-Table Search & Quotation Pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Cloud Invoices Search', () => {
    it('queries matching customer IDs and searches by both invoice_number and customer_id', async () => {
      const customerBuilder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockResolvedValue({
          data: [{ id: 'cust-uuid-1' }, { id: 'cust-uuid-2' }],
          error: null,
        }),
      };

      const invoiceBuilder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'inv-1',
              organization_id: ORG_ID,
              invoice_number: 'INV/2026/001',
              customer_id: 'cust-uuid-1',
              status: 'ISSUED',
              invoice_date: '2026-11-19',
              due_date: '2026-12-19',
              subtotal: 1000,
              discount_amount: 0,
              tax_amount: 180,
              total_amount: 1180,
              total_paid: 0,
              created_at: '2026-11-19T00:00:00Z',
              customer: { id: 'cust-uuid-1', name: 'Lakshmi Electricals', company_name: 'Lakshmi Corp' },
              items: [],
            },
          ],
          error: null,
          count: 1,
        }),
      };

      vi.mocked(supabase!.from).mockImplementation((table: string) => {
        if (table === 'customers') return customerBuilder;
        if (table === 'invoices') return invoiceBuilder;
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await invoicesService.getInvoicesPaginated(
        ORG_ID,
        { search: 'Lakshmi (Corp), Electricals' },
        false
      );

      // Verify customer search query with sanitized terms (special characters removed)
      expect(customerBuilder.or).toHaveBeenCalledWith(
        expect.stringContaining('name.ilike.%Lakshmi Corp Electricals%')
      );

      // Verify invoice query includes customer_id.in.(...)
      expect(invoiceBuilder.or).toHaveBeenCalledWith(
        'invoice_number.ilike.%Lakshmi Corp Electricals%,customer_id.in.(cust-uuid-1,cust-uuid-2)'
      );
      expect(res.data).toHaveLength(1);
      expect(res.totalCount).toBe(1);
    });
  });

  describe('Cloud Sales Orders Search', () => {
    it('queries matching customer IDs and searches by order_number and customer_id', async () => {
      const customerBuilder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockResolvedValue({
          data: [{ id: 'cust-uuid-3' }],
          error: null,
        }),
      };

      const orderBuilder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'so-1',
              organization_id: ORG_ID,
              order_number: 'SO/2026/001',
              customer_id: 'cust-uuid-3',
              status: 'CONFIRMED',
              order_date: '2026-11-19',
              subtotal: 500,
              discount_amount: 0,
              tax_amount: 90,
              total_amount: 590,
              created_at: '2026-11-19T00:00:00Z',
              customer: { id: 'cust-uuid-3', name: 'Balaji Hardware', company_name: 'Balaji Enterprises' },
              items: [],
            },
          ],
          error: null,
          count: 1,
        }),
      };

      vi.mocked(supabase!.from).mockImplementation((table: string) => {
        if (table === 'customers') return customerBuilder;
        if (table === 'sales_orders') return orderBuilder;
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await ordersService.getSalesOrdersPaginated(
        ORG_ID,
        { search: 'Balaji' },
        false
      );

      expect(orderBuilder.or).toHaveBeenCalledWith(
        'order_number.ilike.%Balaji%,customer_id.in.(cust-uuid-3)'
      );
      expect(res.data).toHaveLength(1);
      expect(res.totalCount).toBe(1);
    });
  });

  describe('Cloud Payments Search', () => {
    it('queries matching customer IDs and searches by payment_number, reference_number, and customer_id', async () => {
      const customerBuilder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockResolvedValue({
          data: [{ id: 'cust-uuid-4' }],
          error: null,
        }),
      };

      const paymentBuilder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'pay-1',
              organization_id: ORG_ID,
              payment_number: 'PAY/2026/001',
              reference_number: 'UPI-987654',
              customer_id: 'cust-uuid-4',
              amount: 1180,
              payment_method: 'UPI',
              payment_date: '2026-11-19',
              created_at: '2026-11-19T00:00:00Z',
              customer: { id: 'cust-uuid-4', name: 'Sri Ganesh Power', company_name: 'Ganesh Ltd' },
              allocations: [],
            },
          ],
          error: null,
          count: 1,
        }),
      };

      vi.mocked(supabase!.from).mockImplementation((table: string) => {
        if (table === 'customers') return customerBuilder;
        if (table === 'payments') return paymentBuilder;
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await paymentsService.getPaymentsPaginated(
        ORG_ID,
        { search: 'Ganesh' },
        false
      );

      expect(paymentBuilder.or).toHaveBeenCalledWith(
        'payment_number.ilike.%Ganesh%,reference_number.ilike.%Ganesh%,customer_id.in.(cust-uuid-4)'
      );
      expect(res.data).toHaveLength(1);
      expect(res.totalCount).toBe(1);
    });
  });

  describe('Quotations Server-Side Pagination', () => {
    it('paginates quotations with range and count: exact in cloud mode', async () => {
      const quotationBuilder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'q-1',
              organization_id: ORG_ID,
              quotation_number: 'QTN/2026/001',
              customer_id: 'cust-uuid-1',
              status: 'DRAFT',
              valid_until: '2026-12-01',
              subtotal: 2000,
              discount_amount: 0,
              tax_amount: 360,
              total_amount: 2360,
              created_at: '2026-11-19T00:00:00Z',
              customer: { id: 'cust-uuid-1', name: 'Lakshmi Electricals' },
              items: [],
            },
          ],
          error: null,
          count: 42,
        }),
      };

      vi.mocked(supabase!.from).mockImplementation((table: string) => {
        if (table === 'quotations') return quotationBuilder;
        throw new Error(`Unexpected table: ${table}`);
      });

      const res = await ordersService.getQuotationsPaginated(
        ORG_ID,
        { page: 2, pageSize: 10 },
        false
      );

      expect(quotationBuilder.select).toHaveBeenCalledWith(
        '*, items:quotation_items(*), customer:customers!fk_quotations_customer_org(*)',
        { count: 'exact' }
      );
      expect(quotationBuilder.range).toHaveBeenCalledWith(10, 19);
      expect(res.page).toBe(2);
      expect(res.pageSize).toBe(10);
      expect(res.totalCount).toBe(42);
      expect(res.totalPages).toBe(5);
      expect(res.data).toHaveLength(1);
      expect(res.data[0].quotationNumber).toBe('QTN/2026/001');
    });

    it('getQuotations overloaded method preserves backward compatibility returning array', async () => {
      const mockResult = {
        data: [
          {
            id: 'q-1',
            organization_id: ORG_ID,
            quotation_number: 'QTN/2026/001',
            customer_id: 'cust-uuid-1',
            status: 'DRAFT',
            valid_until: '2026-12-01',
            subtotal: 2000,
            discount_amount: 0,
            tax_amount: 360,
            total_amount: 2360,
            created_at: '2026-11-19T00:00:00Z',
            customer: { id: 'cust-uuid-1', name: 'Lakshmi Electricals' },
            items: [],
          },
        ],
        error: null,
        count: 1,
      };

      const quotationBuilder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue(mockResult),
        then: (resolve: (val: any) => any) => Promise.resolve(mockResult).then(resolve),
      };

      vi.mocked(supabase!.from).mockImplementation((table: string) => {
        if (table === 'quotations') return quotationBuilder;
        throw new Error(`Unexpected table: ${table}`);
      });

      const arrayRes = await ordersService.getQuotations(ORG_ID, false);
      expect(Array.isArray(arrayRes)).toBe(true);
      expect(arrayRes[0].quotationNumber).toBe('QTN/2026/001');

      // Calling with pagination params returns PaginatedResult
      const paginatedRes = await ordersService.getQuotations(ORG_ID, { page: 1, pageSize: 25 }, false);
      expect('data' in paginatedRes).toBe(true);
      expect(paginatedRes.totalCount).toBe(1);
    });
  });
});
