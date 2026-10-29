import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  allocateDocumentNumber,
  withDocumentNumberRetry,
  isUniqueViolation,
  formatSequentialNumber,
  formatInvoiceNumber,
  getIndianFinancialYear,
} from './numbering.service';
import { storage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

describe('Robust Document Numbering & Allocation Strategy', () => {
  const orgA = '00000000-0000-0000-0000-000000000001';
  const orgB = '00000000-0000-0000-0000-000000000002';
  const currentYear = new Date().getFullYear();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isUniqueViolation', () => {
    it('detects Postgres 23505 error code', () => {
      expect(isUniqueViolation({ code: '23505' })).toBe(true);
      expect(isUniqueViolation({ code: '42P01' })).toBe(false);
    });

    it('detects duplicate key error message strings', () => {
      expect(isUniqueViolation({ message: 'duplicate key value violates unique constraint "sales_orders_organization_id_order_number_key"' })).toBe(true);
      expect(isUniqueViolation({ message: 'unique constraint violation' })).toBe(true);
      expect(isUniqueViolation({ message: 'record already exists' })).toBe(true);
      expect(isUniqueViolation({ details: 'Key (organization_id, order_number)=(...) already exists.' })).toBe(true);
      expect(isUniqueViolation({ message: 'connection refused' })).toBe(false);
    });

    it('handles null and undefined safely', () => {
      expect(isUniqueViolation(null)).toBe(false);
      expect(isUniqueViolation(undefined)).toBe(false);
    });
  });

  describe('formatSequentialNumber (Truncation Prevention)', () => {
    it('formats sequential numbers below 10000 with 4-digit zero padding', () => {
      expect(formatSequentialNumber('RCP', 2026, 1)).toBe('RCP-2026-0001');
      expect(formatSequentialNumber('INV', 2026, 42)).toBe('INV-2026-0042');
      expect(formatSequentialNumber('SO', 2026, 999)).toBe('SO-2026-0999');
      expect(formatSequentialNumber('RCP', 2026, 9999)).toBe('RCP-2026-9999');
    });

    it('does NOT truncate or wrap numbers >= 10000 (prevents Postgres LPAD 4-character truncation)', () => {
      // Postgres LPAD('10000', 4, '0') returns '1000' which is catastrophic truncation.
      // formatSequentialNumber must preserve 10000 and higher as full integer strings.
      expect(formatSequentialNumber('RCP', 2026, 10000)).toBe('RCP-2026-10000');
      expect(formatSequentialNumber('RCP', 2026, 10005)).toBe('RCP-2026-10005');
      expect(formatSequentialNumber('INV', 2026, 99999)).toBe('INV-2026-99999');
      expect(formatSequentialNumber('SO', 2026, 100000)).toBe('SO-2026-100000');
    });
  });

  describe('formatInvoiceNumber (Indian GST Rule 46 Format)', () => {
    it('formats canonical GST fiscal year invoice numbers with 4-digit zero padding', () => {
      expect(formatInvoiceNumber('25-26', 1)).toBe('ATL/25-26/0001');
      expect(formatInvoiceNumber('25-26', 42)).toBe('ATL/25-26/0042');
      expect(formatInvoiceNumber('26-27', 9999)).toBe('ATL/26-27/9999');
    });

    it('preserves invoice numbers >= 10000 without truncation (compliant with 16-char GST limit)', () => {
      const inv10k = formatInvoiceNumber('25-26', 10000);
      expect(inv10k).toBe('ATL/25-26/10000');
      expect(inv10k.length).toBeLessThanOrEqual(16);

      const inv100k = formatInvoiceNumber('25-26', 99999);
      expect(inv100k).toBe('ATL/25-26/99999');
      expect(inv100k.length).toBeLessThanOrEqual(16);
    });
  });

  describe('getIndianFinancialYear (Indian FY Calculation)', () => {
    it('derives correct FY string from Date objects across fiscal boundary', () => {
      // Q4: Jan, Feb, Mar belong to previous calendar year's FY
      expect(getIndianFinancialYear(new Date('2026-02-16'))).toBe('25-26');
      expect(getIndianFinancialYear(new Date('2026-03-31'))).toBe('25-26');

      // Q1-Q3: Apr to Dec belong to current calendar year's FY
      expect(getIndianFinancialYear(new Date('2026-04-01'))).toBe('26-27');
      expect(getIndianFinancialYear(new Date('2026-10-29'))).toBe('26-27');
      expect(getIndianFinancialYear(new Date('2026-12-31'))).toBe('26-27');
    });

    it('handles ISO date strings and existing FY patterns', () => {
      expect(getIndianFinancialYear('2026-02-16')).toBe('25-26');
      expect(getIndianFinancialYear('2026-04-01')).toBe('26-27');
      expect(getIndianFinancialYear('25-26')).toBe('25-26');
      expect(getIndianFinancialYear('26-27')).toBe('26-27');
    });
  });

  describe('Primary RPC Allocation Strategy', () => {
    it('allocates document number from database sequence RPC', async () => {
      (supabase!.rpc as any).mockResolvedValueOnce({
        data: `SO-${currentYear}-0001`,
        error: null,
      });

      const num = await allocateDocumentNumber(orgA, 'SALES_ORDER', currentYear);
      expect(num).toBe(`SO-${currentYear}-0001`);
      expect(supabase!.rpc).toHaveBeenCalledWith('allocate_document_number', {
        p_org_id: orgA,
        p_doc_type: 'SALES_ORDER',
        p_year: currentYear,
      });
    });

    it('allocates quotation and invoice prefixes correctly', async () => {
      (supabase!.rpc as any).mockResolvedValueOnce({
        data: `QT-${currentYear}-0042`,
        error: null,
      });
      const qNum = await allocateDocumentNumber(orgA, 'QUOTATION', currentYear);
      expect(qNum).toBe(`QT-${currentYear}-0042`);

      (supabase!.rpc as any).mockResolvedValueOnce({
        data: `INV-${currentYear}-0105`,
        error: null,
      });
      const invNum = await allocateDocumentNumber(orgA, 'INVOICE', currentYear);
      expect(invNum).toBe(`INV-${currentYear}-0105`);
    });

    it('strictly denies direct receipt-number allocation attempts in cloud mode', async () => {
      // Direct authenticated calls to allocate RECEIPT numbers must be blocked.
      // Receipts can only be allocated atomically via record_payment_and_allocate().
      await expect(
        allocateDocumentNumber(orgA, 'RECEIPT', currentYear, false)
      ).rejects.toThrow(/Access denied: RECEIPT numbers cannot be allocated directly/);
    });

    it('rejects null and invalid inputs on document allocation', async () => {
      await expect(
        allocateDocumentNumber('', 'QUOTATION', currentYear)
      ).rejects.toThrow(/organization_id cannot be null or empty/);

      await expect(
        allocateDocumentNumber(orgA, '' as any, currentYear)
      ).rejects.toThrow(/document_type cannot be null or empty/);

      await expect(
        allocateDocumentNumber(orgA, 'QUOTATION', 1995)
      ).rejects.toThrow(/Invalid year: 1995/);

      await expect(
        allocateDocumentNumber(orgA, 'QUOTATION', 2150)
      ).rejects.toThrow(/Invalid year: 2150/);
    });
  });

  describe('Database Fallback Strategy (when RPC is unavailable)', () => {
    it('queries table max sequence and increments when RPC fails', async () => {
      (supabase!.rpc as any).mockResolvedValueOnce({
        data: null,
        error: { message: 'function allocate_document_number() does not exist' },
      });

      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        like: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValueOnce({
          data: [{ order_number: `SO-${currentYear}-0007` }, { order_number: `SO-${currentYear}-0006` }],
          error: null,
        }),
      };
      (supabase!.from as any).mockReturnValueOnce(mockQuery);

      const num = await allocateDocumentNumber(orgA, 'SALES_ORDER', currentYear);
      expect(num).toBe(`SO-${currentYear}-0008`);
    });

    it('defaults to 0001 when table is empty and RPC fails', async () => {
      (supabase!.rpc as any).mockResolvedValueOnce({
        data: null,
        error: { message: 'RPC error' },
      });

      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        like: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValueOnce({
          data: [],
          error: null,
        }),
      };
      (supabase!.from as any).mockReturnValueOnce(mockQuery);

      const num = await allocateDocumentNumber(orgA, 'SALES_ORDER', currentYear);
      expect(num).toBe(`SO-${currentYear}-0001`);
    });
  });

  describe('Uniqueness Conflict Recovery & Retries (withDocumentNumberRetry)', () => {
    it('succeeds on first attempt when no conflict occurs', async () => {
      (supabase!.rpc as any).mockResolvedValueOnce({
        data: `SO-${currentYear}-0001`,
        error: null,
      });

      const insertFn = vi.fn().mockResolvedValueOnce({
        data: { id: 'order-1', order_number: `SO-${currentYear}-0001` },
        error: null,
      });

      const result = await withDocumentNumberRetry<{ id: string; order_number: string }>(
        orgA,
        'SALES_ORDER',
        insertFn
      );
      expect(result.order_number).toBe(`SO-${currentYear}-0001`);
      expect(insertFn).toHaveBeenCalledTimes(1);
    });

    it('catches unique constraint conflict, allocates fresh number, and retries successfully', async () => {
      // First attempt collides on 0001
      (supabase!.rpc as any).mockResolvedValueOnce({
        data: `SO-${currentYear}-0001`,
        error: null,
      });
      // Second attempt gets 0002
      (supabase!.rpc as any).mockResolvedValueOnce({
        data: `SO-${currentYear}-0002`,
        error: null,
      });

      const insertFn = vi
        .fn()
        .mockResolvedValueOnce({
          data: null,
          error: { code: '23505', message: 'duplicate key value violates unique constraint' },
        })
        .mockResolvedValueOnce({
          data: { id: 'order-2', order_number: `SO-${currentYear}-0002` },
          error: null,
        });

      const result = await withDocumentNumberRetry<{ id: string; order_number: string }>(
        orgA,
        'SALES_ORDER',
        insertFn,
        3
      );
      expect(result.order_number).toBe(`SO-${currentYear}-0002`);
      expect(insertFn).toHaveBeenCalledTimes(2);
    });

    it('fails immediately on non-collision database errors without retrying', async () => {
      (supabase!.rpc as any).mockResolvedValueOnce({
        data: `SO-${currentYear}-0001`,
        error: null,
      });

      const insertFn = vi.fn().mockResolvedValueOnce({
        data: null,
        error: { code: '42501', message: 'permission denied for table sales_orders' },
      });

      await expect(
        withDocumentNumberRetry<{ id: string }>(orgA, 'SALES_ORDER', insertFn, 3)
      ).rejects.toThrow('permission denied for table sales_orders');
      expect(insertFn).toHaveBeenCalledTimes(1);
    });

    it('throws descriptive error if retries are exhausted', async () => {
      (supabase!.rpc as any).mockResolvedValue({
        data: `SO-${currentYear}-0001`,
        error: null,
      });

      const insertFn = vi.fn().mockResolvedValue({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      });

      await expect(
        withDocumentNumberRetry<{ id: string }>(orgA, 'SALES_ORDER', insertFn, 2)
      ).rejects.toThrow(/Failed to allocate a unique sales_order number after 2 attempts/);
      expect(insertFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('Local / Demo Mode Numbering Strategy (storage.ts)', () => {
    beforeEach(() => {
      localStorage.clear();
      storage.initialize();
    });

    it('allocates deterministic sequential numbers starting at 0001', () => {
      const num1 = storage.allocateDocumentNumber(orgA, 'QUOTATION');
      expect(num1).toBe(`QT-${currentYear}-0001`);
    });

    it('enforces strict organization separation (Org A and Org B both start at 0001)', () => {
      // Org A creates a quotation
      const qA = storage.createQuotation(orgA, {
        customerId: 'cust-1',
        validUntil: '2026-12-31',
        items: [{ quantity: 1, unitPrice: 100, discountPercent: 0, taxRate: 18 }],
      });
      expect(qA.quotationNumber).toBe(`QT-${currentYear}-0001`);

      // Org B creates a quotation in same system - must start at 0001 independently
      const qB = storage.createQuotation(orgB, {
        customerId: 'cust-2',
        validUntil: '2026-12-31',
        items: [{ quantity: 1, unitPrice: 100, discountPercent: 0, taxRate: 18 }],
      });
      expect(qB.quotationNumber).toBe(`QT-${currentYear}-0001`);

      // Org A creates a second quotation - must be 0002
      const qA2 = storage.createQuotation(orgA, {
        customerId: 'cust-1',
        validUntil: '2026-12-31',
        items: [{ quantity: 1, unitPrice: 100, discountPercent: 0, taxRate: 18 }],
      });
      expect(qA2.quotationNumber).toBe(`QT-${currentYear}-0002`);
    });

    it('handles simulated simultaneous creation sequentially without collisions', () => {
      const numbers: string[] = [];
      for (let i = 0; i < 5; i++) {
        const order = storage.createSalesOrder(orgA, {
          customerId: 'cust-1',
          orderDate: '2026-03-01',
          items: [{ quantity: 1, unitPrice: 500, discountPercent: 0, taxRate: 18 }],
        });
        numbers.push(order.orderNumber);
      }

      // Fresh organization orgA allocates 0001 through 0005 sequentially
      expect(numbers).toEqual([
        `SO-${currentYear}-0001`,
        `SO-${currentYear}-0002`,
        `SO-${currentYear}-0003`,
        `SO-${currentYear}-0004`,
        `SO-${currentYear}-0005`,
      ]);
      // Verify all numbers are strictly unique
      const uniqueSet = new Set(numbers);
      expect(uniqueSet.size).toBe(5);
    });

    it('advances past skipped numbers if gaps exist', () => {
      // Pre-seed an order with sequence 0010 in orgA
      const existing = (storage as any).getItem('atlas_sales_orders_v1', []);
      existing.push({
        id: 'ord-custom-10',
        organizationId: orgA,
        orderNumber: `SO-${currentYear}-0010`,
        status: 'CONFIRMED',
      });
      (storage as any).setItem('atlas_sales_orders_v1', existing);

      // Allocating next should detect max is 10 and return 0011
      const nextNum = storage.allocateDocumentNumber(orgA, 'SALES_ORDER');
      expect(nextNum).toBe(`SO-${currentYear}-0011`);
    });

    it('does not rely on client-side timestamp as sole uniqueness guarantee', () => {
      const num1 = storage.allocateDocumentNumber(orgA, 'INVOICE');
      const num2 = storage.allocateDocumentNumber(orgA, 'INVOICE');
      // Consecutive allocations without saving return the same next sequence, proving it is sequence-driven
      expect(num1).toMatch(/^ATL\/\d{2}-\d{2}\/0001$/);
      expect(num2).toMatch(/^ATL\/\d{2}-\d{2}\/0001$/);
    });

    it('allocates atomic sequential receipt numbers for payments (RCP-YYYY-NNNN) instead of random PAY-', () => {
      const rcp1 = storage.allocateDocumentNumber(orgA, 'RECEIPT');
      expect(rcp1).toBe(`RCP-${currentYear}-0001`);

      // Seed a customer and invoice to record payment
      const cust = storage.createCustomer(orgA, {
        name: 'Test Customer',
        phone: '9876543210',
        creditLimit: 50000,
        creditDays: 30,
        isActive: true,
      });

      const inv = storage.createInvoice(orgA, {
        customerId: cust.id,
        invoiceDate: '2026-03-01',
        dueDate: '2026-03-31',
        items: [
          {
            productId: 'p-wire-1',
            productSku: 'SKU-WIRE-1',
            productName: 'Wire',
            uom: 'Coils',
            quantity: 2,
            unitPrice: 1000,
            discountPercent: 0,
            taxRate: 18,
          },
        ],
      });

      // Record first payment
      const payment1 = storage.recordPayment(
        orgA,
        {
          invoiceId: inv.id,
          customerId: cust.id,
          paymentDate: '2026-03-02',
          amount: 500,
          paymentMethod: 'BANK_TRANSFER',
        },
        'owner'
      );

      expect(payment1.paymentNumber).toBe(`RCP-${currentYear}-0001`);

      // Record second payment on same or another invoice
      const payment2 = storage.recordPayment(
        orgA,
        {
          invoiceId: inv.id,
          customerId: cust.id,
          paymentDate: '2026-03-03',
          amount: 500,
          paymentMethod: 'CASH',
        },
        'owner'
      );

      expect(payment2.paymentNumber).toBe(`RCP-${currentYear}-0002`);
    });
  });
});
