import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reportsService, ExportIntegrityError } from './reports.service';
import { supabase } from '@/lib/supabase';
import { generateSalesReceiptsWorkbook } from '@/lib/excel';

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn() },
}));
vi.mock('@/lib/excel', () => ({
  generateSalesReceiptsWorkbook: vi.fn(async () => new ArrayBuffer(4)),
}));

const orgId = 'af7c98bb-2b66-4281-a129-001111111111';
const customerId = 'e8cffecb-7932-4972-8b4c-002222222222';
const invoiceId = '70604d1f-ec83-4481-a423-003333333333';
const paymentId = '66b21046-43c3-4ce0-a97a-004444444444';

const criteria = {
  periodType: 'FY' as const,
  periodLabel: 'FY 2025–26',
  startDate: '2025-04-01',
  endDate: '2026-03-31',
  documentType: 'ALL' as const,
  userRole: 'accounts' as const,
};

function invoiceRow() {
  return {
    id: invoiceId, organization_id: orgId, invoice_number: 'INV-2026-0001',
    customer_id: customerId, customer: { id: customerId, organization_id: orgId, name: 'Test Customer' },
    status: 'ISSUED', invoice_date: '2026-03-25', due_date: '2026-04-30',
    subtotal: '500.00', tax_amount: '90.00', discount_amount: '0', total_amount: '590',
    total_paid: '0', items: [{
      id: 'item-1', invoice_id: invoiceId, product_name: 'Wire',
      product_sku: 'WR-1', quantity: 1, uom: 'Nos',
      unit_price: '500', discount_percent: '0', tax_rate: '18',
      line_subtotal: '500', line_tax: '90', line_total: '590',
    }],
  };
}
function paymentRow() {
  return {
    id: paymentId, organization_id: orgId, payment_number: 'PAY-2026-0001',
    customer_id: customerId, customer: { id: customerId, organization_id: orgId, name: 'Test Customer' },
    amount: '590.00', payment_method: 'UPI', payment_date: '2026-03-26',
    allocations: [{
      id: 'allocation-1', payment_id: paymentId, invoice_id: invoiceId,
      amount_allocated: '590.00', created_at: '2026-03-26T00:00:00Z',
    }],
  };
}
function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    snapshot_at: '2026-03-26T00:00:00Z',
    invoice_count: 1, payment_count: 1,
    invoice_item_count: 1, payment_allocation_count: 1,
    invoices: [invoiceRow()], payments: [paymentRow()],
    referenced_invoices: [invoiceRow()],
    ...overrides,
  };
}
function authorizeAndReturn(data: unknown, secondError: unknown = null) {
  vi.mocked(supabase!.rpc)
    .mockResolvedValueOnce({ data: true, error: null } as any)
    .mockResolvedValueOnce({ data, error: secondError } as any);
}

describe('FIN-01 — single-statement export snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds the cloud workbook only from an authorized snapshot RPC', async () => {
    authorizeAndReturn(snapshot());
    const organization = { id: orgId, name: 'Test Org', currency: 'INR' } as any;
    const { filename, buffer } = await reportsService.exportReport(organization, criteria);

    expect(filename).toContain('FY_2025-26');
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(supabase!.rpc).toHaveBeenCalledTimes(2);
    expect(supabase!.rpc).toHaveBeenNthCalledWith(2, 'get_financial_export_snapshot', {
      p_org_id: orgId, p_start_date: criteria.startDate, p_end_date: criteria.endDate,
      p_document_type: 'ALL', p_customer_id: null, p_invoice_status: null,
    });
    expect(supabase!.from).not.toHaveBeenCalled();
    const args = vi.mocked(generateSalesReceiptsWorkbook).mock.calls[0][0];
    expect(args.invoices).toHaveLength(1);
    expect(args.payments).toHaveLength(1);
    expect(args.referencedInvoices?.get(invoiceId)?.invoiceNumber).toBe('INV-2026-0001');
  });

  it('rejects incomplete or silently truncated invoice items', async () => {
    authorizeAndReturn(snapshot({ invoice_item_count: 2 }));
    await expect(reportsService.fetchSnapshotReportData(orgId, criteria))
      .rejects.toMatchObject({ code: 'SNAPSHOT_COUNT_MISMATCH' });
    expect(supabase!.from).not.toHaveBeenCalled();
  });

  it('rejects payment allocations with unknown referenced invoices', async () => {
    authorizeAndReturn(snapshot({
      invoices: [], invoice_count: 0, invoice_item_count: 0, referenced_invoices: [],
    }));
    await expect(reportsService.fetchSnapshotReportData(orgId, criteria))
      .rejects.toMatchObject({ code: 'SNAPSHOT_REFERENCE_MISSING' });
  });

  it('fails closed when the snapshot RPC is unavailable, never falls back to pagination', async () => {
    authorizeAndReturn(null, { message: 'RPC missing', code: 'PGRST202' });
    await expect(reportsService.fetchSnapshotReportData(orgId, criteria))
      .rejects.toMatchObject({ code: 'SNAPSHOT_UNAVAILABLE' });
    expect(supabase!.from).not.toHaveBeenCalled();
  });

  it('rejects a user who lacks finance permission before fetching cloud data', async () => {
    await expect(reportsService.fetchSnapshotReportData(orgId, {
      ...criteria, userRole: 'sales',
    })).rejects.toThrow(/Unauthorized/);
    expect(supabase!.rpc).not.toHaveBeenCalled();
  });

  it('rejects a duplicate invoice or incorrect organization ID', async () => {
    authorizeAndReturn(snapshot({
      invoices: [invoiceRow(), invoiceRow()], invoice_count: 2, invoice_item_count: 2,
    }));
    await expect(reportsService.fetchSnapshotReportData(orgId, criteria))
      .rejects.toMatchObject({ code: 'SNAPSHOT_INVALID' });
  });

  it('never accepts malformed counts as verified data', async () => {
    authorizeAndReturn(snapshot({ invoice_count: '1' }));
    await expect(reportsService.fetchSnapshotReportData(orgId, criteria))
      .rejects.toBeInstanceOf(ExportIntegrityError);
  });
});
