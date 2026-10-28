import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  allocateDocumentNumber,
  withDocumentNumberRetry,
  isUniqueViolation,
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
      expect(num1).toBe(`INV-${currentYear}-0001`);
      expect(num2).toBe(`INV-${currentYear}-0001`);
    });
  });
});
