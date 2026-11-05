import { describe, it, expect } from 'vitest';
import { dashboardService, parseMetricNumber } from './dashboard.service';
import { buildPaginatedResult, paginateArray } from '@/lib/pagination';
import { storage } from '@/lib/storage';

describe('Phase A2.2 — Dashboard Accuracy, Zero-Value Preservation & Pagination Helpers', () => {
  describe('Zero-Value Preservation (parseMetricNumber)', () => {
    it('preserves legitimate numeric 0 without falling back', () => {
      expect(parseMetricNumber(0)).toBe(0);
      expect(parseMetricNumber(0.0)).toBe(0);
      expect(parseMetricNumber('0')).toBe(0);
      expect(parseMetricNumber('0.00')).toBe(0);
    });

    it('parses valid positive numbers and numeric strings accurately', () => {
      expect(parseMetricNumber(12500.5)).toBe(12500.5);
      expect(parseMetricNumber('45000.75')).toBe(45000.75);
      expect(parseMetricNumber(100)).toBe(100);
    });

    it('safely defaults invalid values, NaN, null, and undefined to 0', () => {
      expect(parseMetricNumber(null)).toBe(0);
      expect(parseMetricNumber(undefined)).toBe(0);
      expect(parseMetricNumber(NaN)).toBe(0);
      expect(parseMetricNumber('not-a-number')).toBe(0);
      expect(parseMetricNumber(-50)).toBe(0); // non-negative boundary
    });
  });

  describe('Pagination Core Helpers', () => {
    it('buildPaginatedResult calculates page boundaries and totalPages correctly', () => {
      const items = [{ id: '1' }, { id: '2' }, { id: '3' }];
      const res = buildPaginatedResult(items, 105, 2, 25);

      expect(res.data).toHaveLength(3);
      expect(res.page).toBe(2);
      expect(res.pageSize).toBe(25);
      expect(res.total).toBe(105);
      expect(res.totalCount).toBe(105);
      expect(res.totalPages).toBe(5);
      expect(res.hasNextPage).toBe(true);
      expect(res.hasPrevPage).toBe(true);
    });

    it('buildPaginatedResult handles zero total items cleanly', () => {
      const res = buildPaginatedResult([], 0, 1, 25);
      expect(res.data).toHaveLength(0);
      expect(res.page).toBe(1);
      expect(res.total).toBe(0);
      expect(res.totalPages).toBe(1);
      expect(res.hasNextPage).toBe(false);
      expect(res.hasPrevPage).toBe(false);
    });

    it('paginateArray correctly slices in-memory array with search and sort', () => {
      const items = [
        { id: '1', name: 'Polycab 2.5sqmm Wire', sku: 'POL-001', category: 'Wires & Cables' },
        { id: '2', name: 'Havells 16A MCB', sku: 'HAV-002', category: 'Switchgear' },
        { id: '3', name: 'Anchor 6A Socket', sku: 'ANC-003', category: 'Modular Switches' },
        { id: '4', name: 'Polycab 4.0sqmm Wire', sku: 'POL-004', category: 'Wires & Cables' },
        { id: '5', name: 'Finolex 1.5sqmm Wire', sku: 'FIN-005', category: 'Wires & Cables' },
      ];

      // Page 1, pageSize 2
      const p1 = paginateArray(items, { page: 1, pageSize: 2 });
      expect(p1.data).toHaveLength(2);
      expect(p1.page).toBe(1);
      expect(p1.totalPages).toBe(3);
      expect(p1.hasNextPage).toBe(true);
      expect(p1.hasPrevPage).toBe(false);

      // Page 3, pageSize 2
      const p3 = paginateArray(items, { page: 3, pageSize: 2 });
      expect(p3.data).toHaveLength(1);
      expect(p3.hasNextPage).toBe(false);
      expect(p3.hasPrevPage).toBe(true);

      // Search filtering
      const filtered = paginateArray(
        items,
        { page: 1, pageSize: 10, search: 'Polycab' },
        (item, s) => item.name.toLowerCase().includes(s) || item.sku.toLowerCase().includes(s)
      );
      expect(filtered.total).toBe(2);
      expect(filtered.data.every((i) => i.name.includes('Polycab'))).toBe(true);
    });
  });

  describe('Dashboard Service Mock Mode Computations', () => {
    it('returns exact 0 when sales or receivables are 0 in mock mode', async () => {
      const orgs = storage.getOrganizations();
      const orgId = orgs[0].id;

      const metrics = await dashboardService.getDashboardMetrics(orgId, true);
      expect(typeof metrics.todaySales).toBe('number');
      expect(typeof metrics.totalReceivables).toBe('number');
      expect(typeof metrics.overdueInvoicesCount).toBe('number');
      expect(typeof metrics.lowStockItemsCount).toBe('number');
      expect(typeof metrics.totalStockValue).toBe('number');
      expect(Array.isArray(metrics.lowStockProducts)).toBe(true);
      expect(Array.isArray(metrics.recentOrders)).toBe(true);
      expect(Array.isArray(metrics.recentPayments)).toBe(true);
    });

    it('returns valid sales trend points contiguous over time', async () => {
      const orgs = storage.getOrganizations();
      const orgId = orgs[0].id;

      const trend = await dashboardService.getSalesTrend(orgId, 7, true);
      expect(trend).toHaveLength(7);
      trend.forEach((point) => {
        expect(point).toHaveProperty('date');
        expect(point).toHaveProperty('amount');
        expect(typeof point.amount).toBe('number');
        expect(point.amount).toBeGreaterThanOrEqual(0);
      });
    });

    it('returns receivables summary with totalInvoiced, totalSettled, and totalOutstanding', async () => {
      const orgs = storage.getOrganizations();
      const orgId = orgs[0].id;

      const summary = await dashboardService.getReceivablesSummary(orgId, true);
      expect(summary).toHaveProperty('totalInvoiced');
      expect(summary).toHaveProperty('totalSettled');
      expect(summary).toHaveProperty('totalOutstanding');
      expect(summary).toHaveProperty('settledPct');
      expect(summary.totalInvoiced).toBeGreaterThanOrEqual(0);
      expect(summary.settledPct).toBeGreaterThanOrEqual(0);
      expect(summary.settledPct).toBeLessThanOrEqual(100);
    });

    it('returns brand valuation breakdown bounded by limit', async () => {
      const orgs = storage.getOrganizations();
      const orgId = orgs[0].id;

      const brands = await dashboardService.getTopBrandValuation(orgId, 5, true);
      expect(Array.isArray(brands)).toBe(true);
      expect(brands.length).toBeLessThanOrEqual(5);
      brands.forEach((b) => {
        expect(b).toHaveProperty('brand');
        expect(b).toHaveProperty('totalValue');
        expect(b).toHaveProperty('skuCount');
        expect(b).toHaveProperty('totalUnits');
        expect(b.totalValue).toBeGreaterThanOrEqual(0);
      });
    });
  });
});
