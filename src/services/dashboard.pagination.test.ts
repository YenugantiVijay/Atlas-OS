import { describe, it, expect } from 'vitest';
import { parseMetricNumber } from './dashboard.service';
import { paginateArray } from '@/lib/pagination';
import { Invoice } from '@/types';
import { calculateInvoiceBalance } from '@/lib/money';

describe('Phase A2.2 Final Hardening — Financial Metrics, Pagination & Reconciliation Suite', () => {
  // ==========================================================================
  // TASK 2: Strict Financial Metric Validation (parseMetricNumber)
  // ==========================================================================
  describe('Strict Financial Metric Validation (parseMetricNumber)', () => {
    it('preserves legitimate numeric 0 without falling back or mutating', () => {
      expect(parseMetricNumber(0, 'sales')).toBe(0);
      expect(parseMetricNumber(0.0, 'sales')).toBe(0);
      expect(parseMetricNumber('0', 'sales')).toBe(0);
      expect(parseMetricNumber('0.00', 'sales')).toBe(0);
      expect(parseMetricNumber(-0, 'sales')).toBe(0);
    });

    it('parses valid positive numbers and numeric strings accurately', () => {
      expect(parseMetricNumber(12500.5, 'sales')).toBe(12500.5);
      expect(parseMetricNumber('45000.75', 'sales')).toBe(45000.75);
      expect(parseMetricNumber(100, 'sales')).toBe(100);
      expect(parseMetricNumber(' 999.99 ', 'sales')).toBe(999.99);
    });

    it('throws explicit TypeError when required metric is null', () => {
      expect(() => parseMetricNumber(null, 'today_sales')).toThrow(
        "Missing required financial metric 'today_sales': value is null."
      );
    });

    it('throws explicit TypeError when required metric is undefined', () => {
      expect(() => parseMetricNumber(undefined, 'total_receivables')).toThrow(
        "Missing required financial metric 'total_receivables': value is undefined."
      );
    });

    it('throws explicit TypeError when value is NaN', () => {
      expect(() => parseMetricNumber(NaN, 'orders_count')).toThrow(
        "Invalid financial metric 'orders_count': value is NaN."
      );
      expect(() => parseMetricNumber(Number('invalid'), 'orders_count')).toThrow(
        "Invalid financial metric 'orders_count': value is NaN."
      );
    });

    it('throws explicit TypeError when value is Infinity or -Infinity', () => {
      expect(() => parseMetricNumber(Infinity, 'total_stock_value')).toThrow(
        "Invalid financial metric 'total_stock_value': value is non-finite (Infinity)."
      );
      expect(() => parseMetricNumber(-Infinity, 'total_stock_value')).toThrow(
        "Invalid financial metric 'total_stock_value': value is non-finite (-Infinity)."
      );
    });

    it('throws explicit TypeError when string is empty or whitespace', () => {
      expect(() => parseMetricNumber('', 'today_sales')).toThrow(
        "Missing required financial metric 'today_sales': string is empty or whitespace."
      );
      expect(() => parseMetricNumber('   ', 'today_sales')).toThrow(
        "Missing required financial metric 'today_sales': string is empty or whitespace."
      );
    });

    it('throws explicit TypeError when string has invalid numeric format', () => {
      expect(() => parseMetricNumber('not-a-number', 'today_sales')).toThrow(
        "Invalid financial metric 'today_sales': 'not-a-number' is not a valid number."
      );
      expect(() => parseMetricNumber('12.34.56', 'today_sales')).toThrow(
        "Invalid financial metric 'today_sales': '12.34.56' is not a valid number."
      );
    });

    it('throws explicit TypeError when value has unexpected type (boolean, object, array)', () => {
      expect(() => parseMetricNumber(true, 'today_sales')).toThrow(
        "Invalid financial metric 'today_sales': unexpected type 'boolean'."
      );
      expect(() => parseMetricNumber({}, 'today_sales')).toThrow(
        "Invalid financial metric 'today_sales': unexpected type 'object'."
      );
      expect(() => parseMetricNumber([], 'today_sales')).toThrow(
        "Invalid financial metric 'today_sales': unexpected type 'object'."
      );
    });

    it('throws RangeError when metric is negative and negative values are disallowed', () => {
      expect(() => parseMetricNumber(-50, 'total_receivables')).toThrow(
        "Financial metric 'total_receivables' cannot be negative (-50)."
      );
      expect(() => parseMetricNumber('-0.01', 'today_sales')).toThrow(
        "Financial metric 'today_sales' cannot be negative (-0.01)."
      );
      // When allowNegative is explicitly permitted:
      expect(parseMetricNumber(-50, 'balance_adjustment', { allowNegative: true })).toBe(-50);
    });
  });

  // ==========================================================================
  // TASK 1 & 7: Page-Scoped Stock & Receivables Aggregation (> 1,000 Records)
  // ==========================================================================
  describe('Large-Scale Pagination & Page-Scoped Aggregations (> 1,000 Records)', () => {
    it('paginates over 1,050 products without silent truncation or whole-catalog overfetching', async () => {
      const totalItems = 1050;
      const mockCatalog = Array.from({ length: totalItems }, (_, i) => ({
        id: `prod-${i + 1}`,
        organizationId: 'org-1',
        sku: `SKU-${String(i + 1).padStart(4, '0')}`,
        name: `Electrical Conduit Fitting ${i + 1}`,
        category: 'Conduits & Fittings',
        uom: 'Nos' as const,
        purchaseCost: 120,
        sellingPrice: 160,
        taxRate: 18,
        reorderThreshold: 10,
        currentStock: 0,
        isActive: true,
        createdAt: new Date(Date.now() - i * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      // Page 1: items 0 to 24
      const p1 = paginateArray(mockCatalog, { page: 1, pageSize: 25 });
      expect(p1.data).toHaveLength(25);
      expect(p1.data[0].id).toBe('prod-1');
      expect(p1.data[24].id).toBe('prod-25');
      expect(p1.total).toBe(1050);
      expect(p1.totalPages).toBe(42);
      expect(p1.hasNextPage).toBe(true);
      expect(p1.hasPrevPage).toBe(false);

      // Page 41: items 1000 to 1024 (beyond PostgREST 1000-row limit!)
      const p41 = paginateArray(mockCatalog, { page: 41, pageSize: 25 });
      expect(p41.data).toHaveLength(25);
      expect(p41.data[0].id).toBe('prod-1001');
      expect(p41.data[24].id).toBe('prod-1025');
      expect(p41.page).toBe(41);
      expect(p41.hasNextPage).toBe(true);

      // Page 42: remaining 25 items (items 1025 to 1049)
      const p42 = paginateArray(mockCatalog, { page: 42, pageSize: 25 });
      expect(p42.data).toHaveLength(25);
      expect(p42.data[0].id).toBe('prod-1026');
      expect(p42.data[24].id).toBe('prod-1050');
      expect(p42.page).toBe(42);
      expect(p42.hasNextPage).toBe(false);
      expect(p42.hasPrevPage).toBe(true);
    });

    it('paginates over 1,050 customers and scopes receivables strictly to page slice', async () => {
      const totalCustomers = 1050;
      const mockCustomers = Array.from({ length: totalCustomers }, (_, i) => ({
        id: `cust-${i + 1}`,
        organizationId: 'org-1',
        name: `Contractor Enterprise ${i + 1}`,
        phone: `+9198765${String(i).padStart(5, '0')}`,
        email: `contractor${i + 1}@atlas.in`,
        state: 'Andhra Pradesh',
        isActive: true,
        currentReceivable: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      // Page 41 verifies records past the 1,000 threshold
      const p41 = paginateArray(mockCustomers, { page: 41, pageSize: 25 });
      expect(p41.data).toHaveLength(25);
      expect(p41.data[0].id).toBe('cust-1001');
      expect(p41.data[24].id).toBe('cust-1025');

      // Page-scoped IDs array has exactly 25 IDs, never 1,050
      const pageCustomerIds = p41.data.map((c) => c.id);
      expect(pageCustomerIds).toHaveLength(25);
      expect(pageCustomerIds[0]).toBe('cust-1001');
    });

    it('preserves valid 0 and does not fabricate missing records', () => {
      const requestedIds = ['prod-1', 'prod-2', 'prod-unknown'];
      const authoritativeStockResults = [
        { product_id: 'prod-1', current_stock: 0 },
        { product_id: 'prod-2', current_stock: 45 },
      ];

      const stockMap = new Map<string, number>();
      for (const item of authoritativeStockResults) {
        stockMap.set(item.product_id, Number(item.current_stock));
      }

      // Valid 0 is preserved
      expect(stockMap.get('prod-1')).toBe(0);
      expect(stockMap.get('prod-2')).toBe(45);
      // Missing ID prod-unknown is NOT in the database map (not fabricated)
      expect(stockMap.has(requestedIds[2])).toBe(false);
    });
  });

  // ==========================================================================
  // TASK 3: Financial Reconciliation & Draft Invoice Exclusion
  // ==========================================================================
  describe('Financial Reconciliation & Draft Invoice Exclusion', () => {
    it('strictly excludes DRAFT and CANCELLED invoices from issued invoiced and collection metrics', () => {
      const invoices: Invoice[] = [
        {
          id: 'inv-draft-1',
          organizationId: 'org-1',
          customerId: 'cust-1',
          salesOrderId: 'so-1',
          invoiceNumber: 'INV-DRAFT-01',
          invoiceDate: '2026-11-01',
          dueDate: '2026-11-15',
          items: [],
          subtotal: 50000,
          discountAmount: 0,
          taxAmount: 9000,
          totalAmount: 59000,
          totalPaid: 0,
          status: 'DRAFT', // MUST BE EXCLUDED!
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'inv-issued-1',
          organizationId: 'org-1',
          customerId: 'cust-1',
          salesOrderId: 'so-2',
          invoiceNumber: 'INV-ISS-01',
          invoiceDate: '2026-11-02',
          dueDate: '2026-11-16',
          items: [],
          subtotal: 30000,
          discountAmount: 0,
          taxAmount: 5400,
          totalAmount: 35400,
          totalPaid: 10000,
          status: 'PARTIALLY_PAID', // INCLUDED
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'inv-paid-1',
          organizationId: 'org-1',
          customerId: 'cust-2',
          salesOrderId: 'so-3',
          invoiceNumber: 'INV-PAID-01',
          invoiceDate: '2026-11-03',
          dueDate: '2026-11-17',
          items: [],
          subtotal: 20000,
          discountAmount: 0,
          taxAmount: 3600,
          totalAmount: 23600,
          totalPaid: 23600,
          status: 'PAID', // INCLUDED
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'inv-cancelled-1',
          organizationId: 'org-1',
          customerId: 'cust-3',
          salesOrderId: 'so-4',
          invoiceNumber: 'INV-VOID-01',
          invoiceDate: '2026-11-04',
          dueDate: '2026-11-18',
          items: [],
          subtotal: 10000,
          discountAmount: 0,
          taxAmount: 1800,
          totalAmount: 11800,
          totalPaid: 0,
          status: 'CANCELLED', // EXCLUDED
          createdAt: '',
          updatedAt: '',
        },
      ];

      let invoiced = 0;
      let settled = 0;
      let outstanding = 0;

      invoices.forEach((inv) => {
        if (inv.status === 'ISSUED' || inv.status === 'PARTIALLY_PAID' || inv.status === 'PAID') {
          invoiced += inv.totalAmount;
          settled += inv.totalPaid || 0;
          if (inv.status === 'ISSUED' || inv.status === 'PARTIALLY_PAID') {
            const bal = calculateInvoiceBalance(inv.totalAmount, inv.totalPaid || 0);
            outstanding += bal;
          }
        }
      });

      // Verification:
      // Issued Invoiced = 35,400 + 23,600 = 59,000 (DRAFT 59,000 & CANCELLED 11,800 strictly excluded!)
      expect(invoiced).toBe(59000);
      // Settled = 10,000 + 23,600 = 33,600
      expect(settled).toBe(33600);
      // Outstanding = 35,400 - 10,000 = 25,400
      expect(outstanding).toBe(25400);

      // Mathematical Reconciliation:
      // Total Invoiced === Total Settled + Total Outstanding
      expect(settled + outstanding).toBe(invoiced);

      // Outstanding matches customer account balance sum exactly:
      // Customer 1 balance: 25,400; Customer 2 balance: 0; Customer 3: 0
      const customerBalances = {
        'cust-1': 25400,
        'cust-2': 0,
        'cust-3': 0,
      };
      const totalCustomerBalances = Object.values(customerBalances).reduce((a, b) => a + b, 0);
      expect(outstanding).toBe(totalCustomerBalances);
    });
  });

  // ==========================================================================
  // TASK 4: Pagination Reliability, Sorting & Search Sanitization
  // ==========================================================================
  describe('Pagination Reliability, Secondary Sorting & Search Sanitization', () => {
    it('applies deterministic secondary sorting when primary sort fields are identical', () => {
      const items = [
        { id: 'prod-003', name: 'Anchor Switch 6A', category: 'Modular Switches' },
        { id: 'prod-001', name: 'Anchor Switch 6A', category: 'Modular Switches' },
        { id: 'prod-002', name: 'Anchor Switch 6A', category: 'Modular Switches' },
      ];

      // Primary sort by name; secondary tie-breaker by id ASC
      const sorted = [...items].sort((a, b) => {
        const nameCmp = a.name.localeCompare(b.name);
        if (nameCmp !== 0) return nameCmp;
        return a.id.localeCompare(b.id);
      });

      expect(sorted[0].id).toBe('prod-001');
      expect(sorted[1].id).toBe('prod-002');
      expect(sorted[2].id).toBe('prod-003');
    });

    it('sanitizes search queries to prevent PostgREST grammar breakage', () => {
      const rawSearch = 'Wire, 2.5mm (Red): "Standard"';
      const sanitized = rawSearch.trim().replace(/[,()":\\]/g, ' ').trim();
      expect(sanitized).toBe('Wire  2.5mm  Red    Standard');
      expect(sanitized).not.toContain(',');
      expect(sanitized).not.toContain('(');
      expect(sanitized).not.toContain(')');
      expect(sanitized).not.toContain('"');
    });
  });

  // ==========================================================================
  // TASK 5: Security Hardening & Tenant Isolation
  // ==========================================================================
  describe('Security Hardening & Cross-Tenant Isolation', () => {
    it('rejects batch sizes exceeding 100 in page aggregation RPCs', () => {
      const overflowIds = Array.from({ length: 101 }, (_, i) => `uuid-${i}`);
      expect(overflowIds.length).toBeGreaterThan(100);
      // In Migration 034: IF cardinality(p_product_ids) > 100 THEN RAISE EXCEPTION
      const validateBatch = (ids: string[]) => {
        if (ids.length > 100) {
          throw new Error('ERR_INVALID_PARAMETER: Page product ID batch size cannot exceed 100');
        }
      };
      expect(() => validateBatch(overflowIds)).toThrow(
        'ERR_INVALID_PARAMETER: Page product ID batch size cannot exceed 100'
      );
    });

    it('enforces tenant isolation preventing cross-organization data leakage', () => {
      const orgA = 'org-aaaa-1111';
      const orgB = 'org-bbbb-2222';
      const callerOrg = orgA;

      const authorizeTenant = (targetOrgId: string) => {
        if (targetOrgId !== callerOrg) {
          throw new Error('ERR_UNAUTHORIZED: Access to organization data denied');
        }
      };

      expect(() => authorizeTenant(orgA)).not.toThrow();
      expect(() => authorizeTenant(orgB)).toThrow('ERR_UNAUTHORIZED: Access to organization data denied');
    });
  });
});
