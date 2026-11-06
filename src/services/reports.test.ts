import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  reportsService,
  ReportFilterParams,
  ExportIntegrityError,
} from './reports.service';
import { supabase } from '@/lib/supabase';
import { Organization, Invoice, Payment, Role } from '@/types';
import { hasPermission } from '@/lib/permissions';

// Mock supabase client
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
  getSupabaseStatus: vi.fn(() => ({ isConfigured: true, isConnected: true })),
}));

describe('reportsService — Financial Reporting & Scalability Suite', () => {
  const orgAId = 'org-uuid-001';
  const orgBId = 'org-uuid-002';

  const mockOrg: Organization = {
    id: orgAId,
    name: 'Sri Devi Electricals',
    legalName: 'Sri Devi Electricals Pvt Ltd',
    gstin: '37AAAAA1234A1Z5',
    pan: 'AAAAA1234A',
    state: 'Andhra Pradesh',
    currency: 'INR',
    createdAt: '2025-04-01T00:00:00Z',
    updatedAt: '2025-04-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase!.rpc).mockResolvedValue({ data: true, error: null } as any);
    localStorage.clear();
    localStorage.setItem('atlas_organizations_v1', JSON.stringify([mockOrg]));
  });

  describe('Permission Matrix Enforcement (Task 12)', () => {
    it('grants reports:financial strictly to owner, admin, and accounts', () => {
      const allowedRoles: Role[] = ['owner', 'admin', 'accounts'];
      for (const role of allowedRoles) {
        expect(hasPermission(role, 'reports:financial')).toBe(true);
      }
    });

    it('denies reports:financial to sales, inventory, and viewer', () => {
      const restrictedRoles: Role[] = ['sales', 'inventory', 'viewer'];
      for (const role of restrictedRoles) {
        expect(hasPermission(role, 'reports:financial')).toBe(false);
      }
    });
  });

  describe('Filename Generation (Task 10)', () => {
    it('generates standard financial year filename', () => {
      const params: ReportFilterParams = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'ALL',
      };
      expect(reportsService.generateFilename(params)).toBe('AtlasOS_Sales_Receipts_FY_2025-26.xlsx');
    });

    it('generates standard monthly filename', () => {
      const params: ReportFilterParams = {
        periodType: 'MONTH',
        periodLabel: 'May 2025',
        startDate: '2025-05-01',
        endDate: '2025-05-31',
        documentType: 'ALL',
      };
      expect(reportsService.generateFilename(params)).toBe('AtlasOS_Sales_Receipts_May_2025.xlsx');
    });

    it('generates standard single-day filename', () => {
      const params: ReportFilterParams = {
        periodType: 'DAY',
        periodLabel: '2026-02-15',
        startDate: '2026-02-15',
        endDate: '2026-02-15',
        documentType: 'ALL',
      };
      expect(reportsService.generateFilename(params)).toBe('AtlasOS_Sales_Receipts_2026-02-15.xlsx');
    });

    it('generates custom date range filename', () => {
      const params: ReportFilterParams = {
        periodType: 'CUSTOM',
        periodLabel: '2025-04-01 to 2025-06-30',
        startDate: '2025-04-01',
        endDate: '2025-06-30',
        documentType: 'ALL',
      };
      expect(reportsService.generateFilename(params)).toBe(
        'AtlasOS_Sales_Receipts_Custom_2025-04-01_to_2025-06-30.xlsx'
      );
    });
  });

  describe('Demo Mode Data Extraction & Counting (Task 13)', () => {
    beforeEach(() => {
      // Seed Demo Invoices & Payments in local storage
      const inv1: Invoice = {
        id: 'inv-1',
        organizationId: orgAId,
        invoiceNumber: 'INV-2025-001',
        customerId: 'cust-1',
        status: 'PAID',
        invoiceDate: '2025-05-10',
        dueDate: '2025-06-09',
        subtotal: 10000,
        discountAmount: 0,
        taxAmount: 1800,
        totalAmount: 11800,
        totalPaid: 11800,
        createdAt: '2025-05-10T10:00:00Z',
        updatedAt: '2025-05-10T10:00:00Z',
        items: [
          {
            id: 'item-1',
            invoiceId: 'inv-1',
            productId: 'p-1',
            productName: 'Polycab Wire',
            productSku: 'WIR-1',
            quantity: 10,
            unitPrice: 1000,
            discountPercent: 0,
            taxRate: 18,
            lineSubtotal: 10000,
            lineTax: 1800,
            lineTotal: 11800,
            uom: 'Coils',
          },
        ],
      };

      const inv2: Invoice = {
        id: 'inv-2',
        organizationId: orgAId,
        invoiceNumber: 'INV-2025-002',
        customerId: 'cust-2',
        status: 'ISSUED',
        invoiceDate: '2025-07-15',
        dueDate: '2025-08-14',
        subtotal: 20000,
        discountAmount: 1000,
        taxAmount: 3420,
        totalAmount: 22420,
        totalPaid: 0,
        createdAt: '2025-07-15T10:00:00Z',
        updatedAt: '2025-07-15T10:00:00Z',
        items: [
          {
            id: 'item-2',
            invoiceId: 'inv-2',
            productId: 'p-2',
            productName: 'Schneider MCB',
            productSku: 'MCB-1',
            quantity: 20,
            unitPrice: 1000,
            discountPercent: 5,
            taxRate: 18,
            lineSubtotal: 20000,
            lineTax: 3420,
            lineTotal: 22420,
            uom: 'Nos',
          },
        ],
      };

      const pay1: Payment = {
        id: 'pay-1',
        organizationId: orgAId,
        paymentNumber: 'REC-2025-001',
        customerId: 'cust-1',
        amount: 11800,
        paymentMethod: 'NEFT',
        paymentDate: '2025-05-12',
        createdAt: '2025-05-12T11:00:00Z',
      };

      // Storage has inv1, inv2, pay1 for Org A
      localStorage.setItem('atlas_invoices_v1', JSON.stringify([inv1, inv2]));
      localStorage.setItem('atlas_payments_v1', JSON.stringify([pay1]));
    });

    it('returns exact matching counts in demo mode for full FY', async () => {
      const params: ReportFilterParams = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'ALL',
      };

      const counts = await reportsService.getMatchingCounts(orgAId, params, true);
      expect(counts.invoiceCount).toBe(2);
      expect(counts.paymentCount).toBe(1);
    });

    it('filters matching counts by customer in demo mode', async () => {
      const params: ReportFilterParams = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        customerId: 'cust-1',
        documentType: 'ALL',
      };

      const counts = await reportsService.getMatchingCounts(orgAId, params, true);
      expect(counts.invoiceCount).toBe(1);
      expect(counts.paymentCount).toBe(1);
    });

    it('filters matching counts by invoice status in demo mode', async () => {
      const params: ReportFilterParams = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        invoiceStatus: 'PAID',
        documentType: 'ALL',
      };

      const counts = await reportsService.getMatchingCounts(orgAId, params, true);
      expect(counts.invoiceCount).toBe(1);
    });

    it('filters matching counts by documentType (INVOICES vs PAYMENTS)', async () => {
      const base: ReportFilterParams = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'INVOICES',
      };

      const invCounts = await reportsService.getMatchingCounts(orgAId, base, true);
      expect(invCounts.invoiceCount).toBe(2);
      expect(invCounts.paymentCount).toBe(0);

      const payCounts = await reportsService.getMatchingCounts(
        orgAId,
        { ...base, documentType: 'PAYMENTS' },
        true
      );
      expect(payCounts.invoiceCount).toBe(0);
      expect(payCounts.paymentCount).toBe(1);
    });

    it('exports full report in demo mode and returns valid buffer', async () => {
      const params: ReportFilterParams = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'ALL',
      };

      const result = await reportsService.exportReport(mockOrg, params, true);
      expect(result.buffer).toBeDefined();
      expect(result.buffer.byteLength).toBeGreaterThan(1000);
      expect(result.filename).toBe('AtlasOS_Sales_Receipts_FY_2025-26.xlsx');
    });
  });

  describe('Large Dataset Scalability & Bounded Pagination (>1,000 Invoices) (Task 9)', () => {
    it('fetches >1,000 invoices across bounded batches of 250 without silent truncation', async () => {
      const TOTAL_INVOICES = 1050;
      const BATCH_SIZE = 250;

      // Mock Supabase chained query
      const createMockInvoiceRow = (i: number) => ({
        id: `inv-${i}`,
        organization_id: orgAId,
        invoice_number: `INV-2025-${String(i).padStart(4, '0')}`,
        customer_id: `cust-${i % 10}`,
        status: 'ISSUED',
        invoice_date: '2025-05-15',
        due_date: '2025-06-14',
        subtotal: 1000,
        discount_amount: 0,
        tax_amount: 180,
        total_amount: 1180,
        total_paid: 0,
        created_at: '2025-05-15T10:00:00Z',
        items: [
          {
            id: `item-${i}-1`,
            invoice_id: `inv-${i}`,
            product_id: 'prod-1',
            product_name: 'Polycab 2.5 sqmm FR PVC Copper Wire',
            product_sku: 'CBL-CU-25',
            uom: 'Coils',
            quantity: 1,
            unit_price: 1000,
            tax_rate: 18,
            line_subtotal: 1000,
            line_tax: 180,
            line_total: 1180,
          },
        ],
        customer: {
          id: `cust-${i % 10}`,
          organization_id: orgAId,
          name: `Customer ${i % 10}`,
        },
      });

      // Mock PostgREST chain
      const mockSelect = vi.fn().mockImplementation((_cols, options) => {
        if (options?.head) {
          return {
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            lte: vi.fn().mockResolvedValue({ count: TOTAL_INVOICES, error: null }),
          };
        }

        return {
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockImplementation((from: number, to: number) => {
            const countToReturn = Math.min(to - from + 1, TOTAL_INVOICES - from);
            const batchRows = [];
            for (let j = 0; j < countToReturn; j++) {
              batchRows.push(createMockInvoiceRow(from + j));
            }
            return Promise.resolve({ data: batchRows, error: null });
          }),
        };
      });

      vi.mocked(supabase!.from).mockImplementation((table: string) => {
        if (table === 'invoices') {
          return { select: mockSelect } as any;
        }
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
              gte: vi.fn().mockReturnThis(),
              lte: vi.fn().mockResolvedValue({ count: 0, error: null }),
            }),
          } as any;
        }
        return {} as any;
      });

      const params: ReportFilterParams = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'INVOICES',
      };

      const progressUpdates: any[] = [];
      const result = await reportsService.fetchReportData(orgAId, params, false, (p) => {
        progressUpdates.push({ ...p });
      });

      expect(result.invoices).toHaveLength(TOTAL_INVOICES);
      expect(result.payments).toHaveLength(0);

      // Verify progress callback was triggered across batches
      const invProgresses = progressUpdates.filter((p) => p.stage === 'invoices');
      expect(invProgresses.length).toBeGreaterThanOrEqual(Math.ceil(TOTAL_INVOICES / BATCH_SIZE));
      expect(invProgresses[invProgresses.length - 1].total).toBe(TOTAL_INVOICES);
    });
  });

  describe('Period Attribution & Cross-Year Invariants (Task 3)', () => {
    it('ensures an invoice issued in March 2025 and paid in April 2025 is properly segregated across periods', async () => {
      // Invoice in FY 2024-25
      const marchInv: Invoice = {
        id: 'inv-mar',
        organizationId: orgAId,
        invoiceNumber: 'INV-2025-MAR-01',
        customerId: 'cust-1',
        status: 'PAID',
        invoiceDate: '2025-03-30', // In FY 2024-25
        dueDate: '2025-04-29',
        subtotal: 10000,
        discountAmount: 0,
        taxAmount: 1800,
        totalAmount: 11800,
        totalPaid: 11800,
        createdAt: '2025-03-30T10:00:00Z',
        updatedAt: '2025-04-05T12:00:00Z',
        items: [
          {
            id: 'item-mar-1',
            invoiceId: 'inv-mar',
            productId: 'p-3',
            productName: 'Polycab Wire',
            productSku: 'WIR-1',
            quantity: 5,
            unitPrice: 2000,
            discountPercent: 0,
            taxRate: 18,
            lineSubtotal: 10000,
            lineTax: 1800,
            lineTotal: 11800,
            uom: 'Coils',
          },
        ],
      };

      // Payment collected in FY 2025-26
      const aprilPay: Payment = {
        id: 'pay-apr',
        organizationId: orgAId,
        paymentNumber: 'REC-2025-APR-01',
        customerId: 'cust-1',
        amount: 11800,
        paymentMethod: 'NEFT',
        paymentDate: '2025-04-05', // In FY 2025-26
        createdAt: '2025-04-05T12:00:00Z',
        allocations: [
          {
            id: 'alloc-apr-1',
            paymentId: 'pay-apr',
            invoiceId: 'inv-mar',
            amountAllocated: 11800,
            createdAt: '2025-04-05T12:00:00Z',
            invoice: marchInv,
          },
        ],
      };

      localStorage.setItem('atlas_invoices_v1', JSON.stringify([marchInv]));
      localStorage.setItem('atlas_payments_v1', JSON.stringify([aprilPay]));
      localStorage.setItem('atlas_payment_allocations_v1', JSON.stringify(aprilPay.allocations || []));

      // 1. Check FY 2024-25 (2024-04-01 to 2025-03-31)
      const fy24Params: ReportFilterParams = {
        periodType: 'FY',
        periodLabel: 'FY 2024–25',
        startDate: '2024-04-01',
        endDate: '2025-03-31',
        documentType: 'ALL',
      };
      const fy24Data = await reportsService.fetchReportData(orgAId, fy24Params, true);
      expect(fy24Data.invoices).toHaveLength(1);
      expect(fy24Data.invoices[0].invoiceNumber).toBe('INV-2025-MAR-01');
      // No payments collected in FY 2024-25
      expect(fy24Data.payments).toHaveLength(0);

      // 2. Check FY 2025-26 (2025-04-01 to 2026-03-31)
      const fy25Params: ReportFilterParams = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'ALL',
      };
      const fy25Data = await reportsService.fetchReportData(orgAId, fy25Params, true);
      // No invoices issued in FY 2025-26
      expect(fy25Data.invoices).toHaveLength(0);
      // Payment receipt appears in FY 2025-26 collections
      expect(fy25Data.payments).toHaveLength(1);
      expect(fy25Data.payments[0].paymentNumber).toBe('REC-2025-APR-01');
      expect(fy25Data.payments[0].allocations?.[0].invoiceId).toBe('inv-mar');
    });
  });

  describe('Tenant Isolation Verification (Task 12)', () => {
    it('strictly isolates records by organization_id in storage and query params', async () => {
      const invOrgA: Invoice = {
        id: 'inv-a',
        organizationId: orgAId,
        invoiceNumber: 'INV-A',
        customerId: 'cust-1',
        status: 'ISSUED',
        invoiceDate: '2025-05-10',
        dueDate: '2025-06-09',
        subtotal: 1000,
        discountAmount: 0,
        taxAmount: 180,
        totalAmount: 1180,
        totalPaid: 0,
        createdAt: '2025-05-10T10:00:00Z',
        updatedAt: '2025-05-10T10:00:00Z',
        items: [
          {
            id: 'item-a',
            invoiceId: 'inv-a',
            productId: 'p-4',
            productName: 'Wire',
            productSku: 'W-1',
            quantity: 1,
            unitPrice: 1000,
            discountPercent: 0,
            taxRate: 18,
            lineSubtotal: 1000,
            lineTax: 180,
            lineTotal: 1180,
            uom: 'Coils',
          },
        ],
      };

      const invOrgB: Invoice = {
        id: 'inv-b',
        organizationId: orgBId,
        invoiceNumber: 'INV-B',
        customerId: 'cust-2',
        status: 'ISSUED',
        invoiceDate: '2025-05-10',
        dueDate: '2025-06-09',
        subtotal: 2000,
        discountAmount: 0,
        taxAmount: 360,
        totalAmount: 2360,
        totalPaid: 0,
        createdAt: '2025-05-10T10:00:00Z',
        updatedAt: '2025-05-10T10:00:00Z',
        items: [
          {
            id: 'item-b',
            invoiceId: 'inv-b',
            productId: 'p-5',
            productName: 'Cable',
            productSku: 'C-1',
            quantity: 2,
            unitPrice: 1000,
            discountPercent: 0,
            taxRate: 18,
            lineSubtotal: 2000,
            lineTax: 360,
            lineTotal: 2360,
            uom: 'Coils',
          },
        ],
      };

      localStorage.setItem('atlas_invoices_v1', JSON.stringify([invOrgA, invOrgB]));

      const params: ReportFilterParams = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'ALL',
      };

      const resA = await reportsService.fetchReportData(orgAId, params, true);
      expect(resA.invoices).toHaveLength(1);
      expect(resA.invoices[0].id).toBe('inv-a');

      const resB = await reportsService.fetchReportData(orgBId, params, true);
      expect(resB.invoices).toHaveLength(1);
      expect(resB.invoices[0].id).toBe('inv-b');
    });
  });

  describe('Phase B1: Fail-Closed Nested Financial Export Verification', () => {
    it.each(['invoice_items', 'payment_allocations'] as const)(
      'rejects %s when the authoritative nested count request fails',
      async (table) => {
        (supabase!.from as any).mockImplementation((name: string) => {
          expect(name).toBe(table);
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ count: null, error: { message: 'permission denied' } }),
            }),
          };
        });

        const records = Array.from({ length: 1000 }, (_, index) => ({ id: `child-${index}` }));
        const check = table === 'invoice_items'
          ? reportsService.fetchAllInvoiceItemsIfTruncated('parent-1', records)
          : reportsService.fetchAllPaymentAllocationsIfTruncated('parent-1', records);

        await expect(check).rejects.toMatchObject({
          code: 'NESTED_COUNT_UNVERIFIED',
        });
      }
    );

    it('rejects nested records when the count decreases during the export', async () => {
      (supabase!.from as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ count: 999, error: null }),
        }),
      });

      const records = Array.from({ length: 1000 }, (_, index) => ({ id: `item-${index}` }));
      await expect(reportsService.fetchAllInvoiceItemsIfTruncated('inv-1', records)).rejects.toMatchObject({
        code: 'NESTED_SNAPSHOT_DRIFT',
      });
    });

    it('paginates all 1001 payment allocations, checks identifiers and rechecks the count', async () => {
      const all = Array.from({ length: 1001 }, (_, index) => ({
        id: `allocation-${index}`,
        payment_id: 'payment-1',
        invoice_id: 'invoice-1',
        amount_allocated: '1.00',
        created_at: '2025-05-15T10:00:00Z',
      }));
      let countCalls = 0;
      const page = vi.fn().mockImplementation((from: number, to: number) => {
        return Promise.resolve({ data: all.slice(from, to + 1), error: null });
      });
      (supabase!.from as any).mockImplementation((table: string) => {
        expect(table).toBe('payment_allocations');
        return {
          select: vi.fn().mockImplementation((_cols: string, opts?: { head?: boolean }) => {
            if (opts?.head) {
              return {
                eq: vi.fn().mockImplementation(() => {
                  countCalls += 1;
                  return Promise.resolve({ count: all.length, error: null });
                }),
              };
            }
            return {
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              range: page,
            };
          }),
        };
      });

      const embedded = all.slice(0, 1000).map((row) => ({ id: row.id }));
      const result = await reportsService.fetchAllPaymentAllocationsIfTruncated('payment-1', embedded);
      expect(result).toHaveLength(1001);
      expect(result[1000]).toMatchObject({ id: 'allocation-1000', invoiceId: 'invoice-1' });
      expect(page).toHaveBeenCalledTimes(5);
      expect(countCalls).toBe(2);
    });

    it('includes allocations beyond the PostgREST embedded limit in payment-only exports', async () => {
      const allAllocations = Array.from({ length: 1001 }, (_, index) => ({
        id: `alloc-${index}`,
        payment_id: 'pay-1',
        invoice_id: 'inv-1',
        amount_allocated: '1',
        created_at: '2025-05-15T10:00:00Z',
      }));
      const payment = {
        id: 'pay-1',
        organization_id: orgAId,
        payment_number: 'REC-1',
        payment_date: '2025-05-15',
        amount: 1001,
        customer_id: 'cust-1',
        allocations: allAllocations.slice(0, 1000),
      };
      (supabase!.from as any).mockImplementation((table: string) => {
        if (table === 'payments') {
          return {
            select: vi.fn().mockImplementation((_cols: string, opts?: { head?: boolean }) => {
              if (opts?.head) {
                return {
                  eq: vi.fn().mockReturnThis(),
                  gte: vi.fn().mockReturnThis(),
                  lte: vi.fn().mockResolvedValue({ count: 1, error: null }),
                };
              }
              return {
                eq: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                lte: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                range: vi.fn().mockResolvedValue({ data: [payment], error: null }),
              };
            }),
          };
        }
        if (table === 'payment_allocations') {
          return {
            select: vi.fn().mockImplementation((_cols: string, opts?: { head?: boolean }) => {
              if (opts?.head) {
                return { eq: vi.fn().mockResolvedValue({ count: 1001, error: null }) };
              }
              return {
                eq: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                range: vi.fn().mockImplementation((from: number, to: number) =>
                  Promise.resolve({ data: allAllocations.slice(from, to + 1), error: null })
                ),
              };
            }),
          };
        }
        if (table === 'invoices') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({
                  data: [{ id: 'inv-1', invoice_number: 'INV-1', invoice_date: '2025-05-15', status: 'PAID' }],
                  error: null,
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      });

      const params: ReportFilterParams = {
        periodType: 'MONTH',
        periodLabel: 'May 2025',
        startDate: '2025-05-01',
        endDate: '2025-05-31',
        documentType: 'PAYMENTS',
      };
      const result = await reportsService.fetchReportData(orgAId, params, false);
      expect(result.payments).toHaveLength(1);
      expect(result.payments[0].allocations).toHaveLength(1001);
      expect(result.referencedInvoices.get('inv-1')?.invoiceNumber).toBe('INV-1');
    });

    it('aborts on duplicate IDs in a paginated nested response', async () => {
      (supabase!.from as any).mockReturnValue({
        select: vi.fn().mockImplementation((_cols: string, opts?: { head?: boolean }) => {
          if (opts?.head) {
            return { eq: vi.fn().mockResolvedValue({ count: 1001, error: null }) };
          }
          return {
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            range: vi.fn().mockResolvedValue({
              data: [
                { id: 'duplicate', invoice_id: 'invoice-1', tax_rate: 18 },
                { id: 'duplicate', invoice_id: 'invoice-1', tax_rate: 18 },
              ],
              error: null,
            }),
          };
        }),
      });
      const embedded = Array.from({ length: 1000 }, (_, index) => ({ id: `item-${index}` }));
      await expect(reportsService.fetchAllInvoiceItemsIfTruncated('invoice-1', embedded)).rejects.toMatchObject({
        code: 'NESTED_DUPLICATE_ROW',
      });
    });

    it('aborts if the nested post-fetch count drifts despite retrieving all expected rows', async () => {
      let checks = 0;
      (supabase!.from as any).mockReturnValue({
        select: vi.fn().mockImplementation((_cols: string, opts?: { head?: boolean }) => {
          if (opts?.head) {
            return {
              eq: vi.fn().mockImplementation(() => {
                checks += 1;
                return Promise.resolve({ count: checks === 1 ? 1001 : 1002, error: null });
              }),
            };
          }
          return {
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            range: vi.fn().mockImplementation((from: number, to: number) =>
              Promise.resolve({
                data: Array.from({ length: to - from + 1 }, (_, index) => ({
                  id: `item-${from + index}`,
                  invoice_id: 'invoice-1',
                  product_name: 'Wire',
                  tax_rate: 18,
                })),
                error: null,
              })
            ),
          };
        }),
      });
      const embedded = Array.from({ length: 1000 }, (_, index) => ({ id: `item-${index}` }));
      await expect(reportsService.fetchAllInvoiceItemsIfTruncated('invoice-1', embedded)).rejects.toMatchObject({
        code: 'NESTED_SNAPSHOT_DRIFT',
      });
    });
  });

  describe('Phase B1 Hardening & Data Completeness Guardrails (Task 1 & 8)', () => {
    it('throws ExportIntegrityError when an invoice batch returns 0 records prematurely', async () => {
      // Mock count = 500, but first batch returns empty
      const mockCountQuery = {
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockResolvedValue({ count: 500, error: null }),
      };

      const mockDataQuery = {
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({ data: [], error: null }), // Empty rows unexpectedly!
      };

      (supabase!.from as any).mockImplementation((table: string) => {
        if (table === 'invoices') {
          return {
            select: vi.fn().mockImplementation((_cols, opts) => {
              if (opts?.head) return mockCountQuery;
              return mockDataQuery;
            }),
          };
        }
        return { select: vi.fn() };
      });

      const params: ReportFilterParams = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'INVOICES',
      };

      await expect(reportsService.fetchReportData(orgAId, params, false)).rejects.toThrow(
        ExportIntegrityError
      );
      await expect(reportsService.fetchReportData(orgAId, params, false)).rejects.toThrow(
        /Incomplete invoice export/i
      );
    });

    it('throws ExportIntegrityError when duplicate rows appear across batches', async () => {
      const mockCountQuery = {
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockResolvedValue({ count: 2, error: null }),
      };

      const dupRow = {
        id: 'inv-dup-1',
        organization_id: orgAId,
        invoice_number: 'INV-DUP-01',
        subtotal: 1000,
        items: [{ id: 'item-1', product_name: 'Wire', quantity: 1, unit_price: 1000, tax_rate: 18, line_total: 1000 }],
      };

      const mockDataQuery = {
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: [dupRow, dupRow], // Same ID returned twice!
          error: null,
        }),
      };

      (supabase!.from as any).mockImplementation((table: string) => {
        if (table === 'invoices') {
          return {
            select: vi.fn().mockImplementation((_cols, opts) => {
              if (opts?.head) return mockCountQuery;
              return mockDataQuery;
            }),
          };
        }
        return { select: vi.fn() };
      });

      const params: ReportFilterParams = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'INVOICES',
      };

      await expect(reportsService.fetchReportData(orgAId, params, false)).rejects.toThrow(
        ExportIntegrityError
      );
      await expect(reportsService.fetchReportData(orgAId, params, false)).rejects.toThrow(
        /Duplicate invoice detected/i
      );
    });

    it('throws ExportIntegrityError when record count drifts mid-export (snapshot drift)', async () => {
      let countCalls = 0;
      const createCountQuery = () => ({
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockImplementation(() => {
          countCalls++;
          // First call returns 1, final re-check returns 2 (record added mid-export)
          return Promise.resolve({ count: countCalls === 1 ? 1 : 2, error: null });
        }),
      });

      const mockDataQuery = {
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'inv-drift-1',
              organization_id: orgAId,
              invoice_number: 'INV-DRIFT-01',
              subtotal: 1000,
              items: [{ id: 'item-1', product_name: 'Wire', quantity: 1, unit_price: 1000, tax_rate: 18, line_total: 1000 }],
            },
          ],
          error: null,
        }),
      };

      (supabase!.from as any).mockImplementation((table: string) => {
        if (table === 'invoices') {
          return {
            select: vi.fn().mockImplementation((_cols, opts) => {
              if (opts?.head) return createCountQuery();
              return mockDataQuery;
            }),
          };
        }
        return { select: vi.fn() };
      });

      const params: ReportFilterParams = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'INVOICES',
      };

      await expect(reportsService.fetchReportData(orgAId, params, false)).rejects.toThrow(
        /Inconsistent database snapshot/i
      );
    });

    it('throws ExportIntegrityError when an invoice with positive subtotal is missing nested line items', async () => {
      const mockCountQuery = {
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockResolvedValue({ count: 1, error: null }),
      };

      const mockDataQuery = {
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'inv-corrupt-1',
              organization_id: orgAId,
              invoice_number: 'INV-CORRUPT-01',
              subtotal: 5000, // Positive subtotal
              items: [],      // Empty items! Corrupt line items
            },
          ],
          error: null,
        }),
      };

      (supabase!.from as any).mockImplementation((table: string) => {
        if (table === 'invoices') {
          return {
            select: vi.fn().mockImplementation((_cols, opts) => {
              if (opts?.head) return mockCountQuery;
              return mockDataQuery;
            }),
          };
        }
        return { select: vi.fn() };
      });

      const params: ReportFilterParams = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'INVOICES',
      };

      await expect(reportsService.fetchReportData(orgAId, params, false)).rejects.toThrow(
        ExportIntegrityError
      );
      await expect(reportsService.fetchReportData(orgAId, params, false)).rejects.toThrow(
        /Missing invoice line items/i
      );
    });

    it('blocks export when matching invoices exceed safe limit of 10,000', async () => {
      const mockCountQuery = {
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockResolvedValue({ count: 12000, error: null }), // 12k exceeds limit
      };

      (supabase!.from as any).mockImplementation((table: string) => {
        if (table === 'invoices') {
          return {
            select: vi.fn().mockImplementation((_cols, opts) => {
              if (opts?.head) return mockCountQuery;
              return { eq: vi.fn().mockReturnThis() };
            }),
          };
        }
        return { select: vi.fn() };
      });

      const params: ReportFilterParams = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'INVOICES',
      };

      await expect(reportsService.fetchReportData(orgAId, params, false)).rejects.toThrow(
        ExportIntegrityError
      );
      await expect(reportsService.fetchReportData(orgAId, params, false)).rejects.toThrow(
        /Export threshold exceeded/i
      );
    });

    it('rejects unauthorized user role attempting to fetch report counts or export data', async () => {
      const params: ReportFilterParams = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'ALL',
        userRole: 'viewer', // Viewer does NOT have reports:financial
      };

      await expect(reportsService.getMatchingCounts(orgAId, params, true)).rejects.toThrow(
        /Unauthorized/i
      );
      await expect(reportsService.fetchReportData(orgAId, params, true)).rejects.toThrow(
        /Unauthorized/i
      );
    });
    it('requires the database authorization gate before querying cloud report counts', async () => {
      const params: ReportFilterParams = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'ALL',
        userRole: 'owner',
      };

      vi.mocked(supabase!.rpc).mockResolvedValueOnce({
        data: null,
        error: { message: 'Financial report access denied', code: '42501' },
      } as any);

      await expect(reportsService.getMatchingCounts(orgAId, params, false)).rejects.toThrow(
        /Unauthorized: Database could not verify/i
      );
      expect(supabase!.rpc).toHaveBeenCalledWith('assert_financial_report_access', {
        p_org_id: orgAId,
      });
      expect(supabase!.from).not.toHaveBeenCalled();
    });

    it('fails closed when a cloud user cannot be authorized for export even if the supplied role claims owner', async () => {
      const params: ReportFilterParams = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'INVOICES',
        userRole: 'owner',
      };

      vi.mocked(supabase!.rpc).mockResolvedValueOnce({ data: false, error: null } as any);

      await expect(reportsService.fetchReportData(orgAId, params, false)).rejects.toThrow(
        /Unauthorized: Database could not verify/i
      );
      expect(supabase!.from).not.toHaveBeenCalled();
    });

    it('fails closed when the financial-report authorization RPC is unavailable', async () => {
      const params: ReportFilterParams = {
        periodType: 'FY',
        periodLabel: 'FY 2025–26',
        startDate: '2025-04-01',
        endDate: '2026-03-31',
        documentType: 'ALL',
      };

      vi.mocked(supabase!.rpc).mockRejectedValueOnce(new Error('Network unavailable'));

      await expect(reportsService.getMatchingCounts(orgAId, params, false)).rejects.toThrow(
        /Network unavailable/i
      );
      expect(supabase!.from).not.toHaveBeenCalled();
    });

  });
});
