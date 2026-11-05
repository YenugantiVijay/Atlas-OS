import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reportsService, ReportFilterParams } from './reports.service';
import { supabase } from '@/lib/supabase';
import { Organization, Invoice, Payment, Role } from '@/types';
import { hasPermission } from '@/lib/permissions';

// Mock supabase client
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
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
      expect(progressUpdates.length).toBeGreaterThanOrEqual(Math.ceil(TOTAL_INVOICES / BATCH_SIZE));
      expect(progressUpdates[progressUpdates.length - 1].total).toBe(TOTAL_INVOICES);
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
});
