import { describe, it, expect, beforeEach, vi } from 'vitest';
import { paymentsService, mapDbPayment, mapDbPaymentAllocation } from './payments.service';
import { storage } from '@/lib/storage';
import { PaymentMethod } from '@/types';

// Controlled mock of @/lib/supabase
let mockSupabaseInstance: any = null;

vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return mockSupabaseInstance;
  },
  validateSupabaseConfig: vi.fn(),
}));

describe('Payments Service & DEF-009 Security Invariants', () => {
  const orgId = '00000000-0000-0000-0000-000000000001';
  const customerId = '00000000-0000-0000-0000-000000000002';
  const invoiceId = '00000000-0000-0000-0000-000000000003';

  beforeEach(() => {
    localStorage.clear();
    storage.initialize(true);
    mockSupabaseInstance = null;
    vi.clearAllMocks();
  });

  describe('mapDbPaymentAllocation & mapDbPayment', () => {
    it('accurately maps snake_case DB row to camelCase PaymentAllocation', () => {
      const dbRow = {
        id: 'alloc-001',
        payment_id: 'pay-001',
        invoice_id: 'inv-001',
        amount_allocated: '1500.50',
        created_at: '2026-10-31T12:00:00Z',
      };

      const result = mapDbPaymentAllocation(dbRow);
      expect(result).toEqual({
        id: 'alloc-001',
        paymentId: 'pay-001',
        invoiceId: 'inv-001',
        amountAllocated: 1500.5,
        createdAt: '2026-10-31T12:00:00Z',
      });
    });

    it('accurately maps snake_case DB row to camelCase Payment with allocations', () => {
      const dbPayRow = {
        id: 'pay-001',
        organization_id: orgId,
        payment_number: 'REC-202610-0001',
        customer_id: customerId,
        amount: '2500.00',
        payment_method: 'BANK_TRANSFER',
        reference_number: 'UTR-987654321',
        payment_date: '2026-10-31',
        notes: 'Invoice clearing',
        created_by: 'usr-admin-01',
        created_at: '2026-10-31T12:00:00Z',
      };

      const allocations = [
        {
          id: 'alloc-001',
          paymentId: 'pay-001',
          invoiceId: 'inv-001',
          amountAllocated: 2500,
          createdAt: '2026-10-31T12:00:00Z',
        },
      ];

      const result = mapDbPayment(dbPayRow, allocations);
      expect(result).toEqual({
        id: 'pay-001',
        organizationId: orgId,
        paymentNumber: 'REC-202610-0001',
        customerId,
        amount: 2500,
        paymentMethod: 'BANK_TRANSFER',
        referenceNumber: 'UTR-987654321',
        paymentDate: '2026-10-31',
        notes: 'Invoice clearing',
        createdBy: 'usr-admin-01',
        createdAt: '2026-10-31T12:00:00Z',
        allocations,
      });
    });

    it('handles nullable optional fields gracefully', () => {
      const dbPayRow = {
        id: 'pay-002',
        organization_id: orgId,
        payment_number: 'REC-202610-0002',
        customer_id: customerId,
        amount: 100,
        payment_method: 'CASH',
        reference_number: null,
        payment_date: '2026-10-31',
        notes: null,
        created_by: null,
        created_at: '2026-10-31T12:00:00Z',
      };

      const result = mapDbPayment(dbPayRow, []);
      expect(result.referenceNumber).toBeUndefined();
      expect(result.notes).toBeUndefined();
      expect(result.createdBy).toBeUndefined();
      expect(result.allocations).toEqual([]);
    });
  });

  describe('paymentsService.getPayments', () => {
    it('retrieves payments from storage in mock auth mode', async () => {
      const result = await paymentsService.getPayments(orgId, true);
      expect(Array.isArray(result)).toBe(true);
    });

    it('fails closed when cloud client is uninitialized in cloud mode', async () => {
      mockSupabaseInstance = null;
      await expect(paymentsService.getPayments(orgId, false)).rejects.toThrow(
        /Cloud backend is not configured: Supabase client is uninitialized/
      );
    });

    it('queries Supabase payments table with allocations in cloud mode', async () => {
      const mockRows = [
        {
          id: 'pay-001',
          organization_id: orgId,
          payment_number: 'REC-202610-0001',
          customer_id: customerId,
          amount: 1000,
          payment_method: 'UPI',
          payment_date: '2026-10-31',
          created_at: '2026-10-31T10:00:00Z',
          allocations: [
            {
              id: 'alloc-001',
              payment_id: 'pay-001',
              invoice_id: invoiceId,
              amount_allocated: 1000,
              created_at: '2026-10-31T10:00:00Z',
            },
          ],
        },
      ];

      const orderFn = vi.fn().mockResolvedValue({ data: mockRows, error: null });
      const eqFn = vi.fn().mockReturnValue({ order: orderFn });
      const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
      const fromFn = vi.fn().mockReturnValue({ select: selectFn });

      mockSupabaseInstance = { from: fromFn };

      const payments = await paymentsService.getPayments(orgId, false);

      expect(fromFn).toHaveBeenCalledWith('payments');
      expect(selectFn).toHaveBeenCalledWith('*, allocations:payment_allocations(*), customer:customers!fk_payments_customer_org(*)');
      expect(eqFn).toHaveBeenCalledWith('organization_id', orgId);
      expect(orderFn).toHaveBeenCalledWith('created_at', { ascending: false });
      expect(payments.length).toBe(1);
      expect(payments[0]!.paymentNumber).toBe('REC-202610-0001');
      expect(payments[0]!.allocations?.length).toBe(1);
      expect(payments[0]!.allocations?.[0].amountAllocated).toBe(1000);
    });

    it('throws sanitized error when Supabase query returns an error', async () => {
      const orderFn = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'relation "payments" does not exist' },
      });
      const eqFn = vi.fn().mockReturnValue({ order: orderFn });
      const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
      const fromFn = vi.fn().mockReturnValue({ select: selectFn });

      mockSupabaseInstance = { from: fromFn };

      await expect(paymentsService.getPayments(orgId, false)).rejects.toThrow(
        /Failed to fetch payments: relation "payments" does not exist/
      );
    });
  });

  describe('paymentsService.recordPayment — RPC Delegation & Validation', () => {
    it('delegates to storage in mock auth mode', async () => {
      const orgs = storage.getOrganizations();
      const mockOrgId = orgs[0].id;
      const customers = storage.getCustomers(mockOrgId);
      const mockCustomerId = customers[0].id;

      const input = {
        customerId: mockCustomerId,
        amount: 500,
        paymentMethod: 'CASH' as PaymentMethod,
        paymentDate: '2026-10-31',
        notes: 'Mock payment test',
      };

      const result = await paymentsService.recordPayment(mockOrgId, input, true, 'accounts');
      expect(result).toBeDefined();
      expect(result.amount).toBe(500);
      expect(result.paymentMethod).toBe('CASH');
    });

    it('fails closed when cloud client is uninitialized in cloud mode', async () => {
      mockSupabaseInstance = null;
      await expect(
        paymentsService.recordPayment(
          orgId,
          {
            customerId,
            amount: 500,
            paymentMethod: 'CASH',
            paymentDate: '2026-10-31',
          },
          false
        )
      ).rejects.toThrow(/Cloud backend is not configured: Supabase client is uninitialized/);
    });

    it('calls remote record_payment_and_allocate RPC with complete mapped parameters', async () => {
      const rpcFn = vi.fn().mockResolvedValue({
        data: { success: true, payment_id: 'pay-new-uuid', payment_number: 'REC-202610-0042' },
        error: null,
      });

      const singleFn = vi.fn().mockResolvedValue({
        data: {
          id: 'pay-new-uuid',
          organization_id: orgId,
          payment_number: 'REC-202610-0042',
          customer_id: customerId,
          amount: 750,
          payment_method: 'BANK_TRANSFER',
          reference_number: 'UTR-112233',
          payment_date: '2026-10-31',
          notes: 'Partial settlement',
          created_at: '2026-10-31T12:00:00Z',
          allocations: [
            {
              id: 'alloc-new-uuid',
              payment_id: 'pay-new-uuid',
              invoice_id: invoiceId,
              amount_allocated: 750,
              created_at: '2026-10-31T12:00:00Z',
            },
          ],
        },
        error: null,
      });
      const eqFn = vi.fn().mockReturnValue({ single: singleFn });
      const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
      const fromFn = vi.fn().mockReturnValue({ select: selectFn });

      mockSupabaseInstance = {
        rpc: rpcFn,
        from: fromFn,
      };

      const payment = await paymentsService.recordPayment(
        orgId,
        {
          customerId,
          invoiceId,
          amount: 750,
          paymentMethod: 'BANK_TRANSFER',
          referenceNumber: '  UTR-112233  ',
          paymentDate: '2026-10-31',
          notes: '  Partial settlement  ',
        },
        false
      );

      // Verify RPC invocation with trimmed values and exact parameter names
      expect(rpcFn).toHaveBeenCalledWith('record_payment_and_allocate', {
        p_org_id: orgId,
        p_customer_id: customerId,
        p_amount: 750,
        p_payment_method: 'BANK_TRANSFER',
        p_reference_no: 'UTR-112233',
        p_payment_date: '2026-10-31',
        p_notes: 'Partial settlement',
        p_invoice_id: invoiceId,
        p_allocated_amount: 750,
        p_idempotency_key: expect.any(String),
      });

      // Verify confirmation fetch
      expect(fromFn).toHaveBeenCalledWith('payments');
      expect(selectFn).toHaveBeenCalledWith('*, allocations:payment_allocations(*)');
      expect(eqFn).toHaveBeenCalledWith('id', 'pay-new-uuid');

      // Verify returned result
      expect(payment.id).toBe('pay-new-uuid');
      expect(payment.paymentNumber).toBe('REC-202610-0042');
      expect(payment.allocations?.length).toBe(1);
      expect(payment.allocations?.[0].amountAllocated).toBe(750);
    });

    it('sets null for unallocated payment parameters when no invoiceId is passed', async () => {
      const rpcFn = vi.fn().mockResolvedValue({
        data: { success: true, payment_id: 'pay-unallocated', payment_number: 'REC-202610-0043' },
        error: null,
      });

      const singleFn = vi.fn().mockResolvedValue({
        data: {
          id: 'pay-unallocated',
          organization_id: orgId,
          payment_number: 'REC-202610-0043',
          customer_id: customerId,
          amount: 200,
          payment_method: 'CASH',
          payment_date: '2026-10-31',
          created_at: '2026-10-31T12:00:00Z',
          allocations: [],
        },
        error: null,
      });
      const eqFn = vi.fn().mockReturnValue({ single: singleFn });
      const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
      const fromFn = vi.fn().mockReturnValue({ select: selectFn });

      mockSupabaseInstance = {
        rpc: rpcFn,
        from: fromFn,
      };

      await paymentsService.recordPayment(
        orgId,
        {
          customerId,
          amount: 200,
          paymentMethod: 'CASH',
          paymentDate: '2026-10-31',
        },
        false
      );

      expect(rpcFn).toHaveBeenCalledWith('record_payment_and_allocate', {
        p_org_id: orgId,
        p_customer_id: customerId,
        p_amount: 200,
        p_payment_method: 'CASH',
        p_reference_no: null,
        p_payment_date: '2026-10-31',
        p_notes: null,
        p_invoice_id: null,
        p_allocated_amount: null,
        p_idempotency_key: expect.any(String),
      });
    });

    it('throws formatted error when RPC execution fails', async () => {
      const rpcFn = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Unauthorized: Caller has insufficient role (sales) to record payments' },
      });

      mockSupabaseInstance = { rpc: rpcFn };

      await expect(
        paymentsService.recordPayment(
          orgId,
          {
            customerId,
            amount: 500,
            paymentMethod: 'CASH',
            paymentDate: '2026-10-31',
          },
          false
        )
      ).rejects.toThrow(/Payment failed: Unauthorized: Caller has insufficient role \(sales\) to record payments/);
    });

    it('throws error when RPC succeeds but returns no payment_id', async () => {
      const rpcFn = vi.fn().mockResolvedValue({
        data: { success: true },
        error: null,
      });

      mockSupabaseInstance = { rpc: rpcFn };

      await expect(
        paymentsService.recordPayment(
          orgId,
          {
            customerId,
            amount: 500,
            paymentMethod: 'CASH',
            paymentDate: '2026-10-31',
          },
          false
        )
      ).rejects.toThrow(/Payment was recorded but no payment ID returned from database/);
    });

    it('throws warning not to resubmit when confirmation fetch fails after committed payment', async () => {
      const rpcFn = vi.fn().mockResolvedValue({
        data: { success: true, payment_id: 'pay-uuid-committed', payment_number: 'REC-202610-9999' },
        error: null,
      });

      const singleFn = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Network timeout loading confirmation' },
      });
      const eqFn = vi.fn().mockReturnValue({ single: singleFn });
      const selectFn = vi.fn().mockReturnValue({ eq: eqFn });
      const fromFn = vi.fn().mockReturnValue({ select: selectFn });

      mockSupabaseInstance = {
        rpc: rpcFn,
        from: fromFn,
      };

      await expect(
        paymentsService.recordPayment(
          orgId,
          {
            customerId,
            amount: 500,
            paymentMethod: 'CASH',
            paymentDate: '2026-10-31',
          },
          false
        )
      ).rejects.toThrow(/Payment was committed to the ledger \(Receipt REC-202610-9999\), but loading confirmation details failed.*Do NOT resubmit/);
    });
  });

  describe('Authoritative Payments Summary & Workflow Integrity', () => {
    it('returns authoritative payments summary via mock auth', async () => {
      const summary = await paymentsService.getPaymentsSummary(orgId, true);
      expect(summary).toHaveProperty('totalCollected');
      expect(summary).toHaveProperty('paymentCount');
      expect(summary).toHaveProperty('totalReceivables');
      expect(summary).toHaveProperty('openInvoicesCount');
      expect(typeof summary.totalCollected).toBe('number');
      expect(typeof summary.paymentCount).toBe('number');
    });

    it('queries get_payments_summary RPC when using Supabase cloud backend', async () => {
      mockSupabaseInstance = {
        rpc: vi.fn().mockResolvedValue({
          data: {
            total_collected: '15000.50',
            payment_count: 5,
            total_receivables: '25000.00',
            open_invoices_count: 8,
          },
          error: null,
        }),
      };

      const summary = await paymentsService.getPaymentsSummary(orgId, false);
      expect(mockSupabaseInstance.rpc).toHaveBeenCalledWith('get_payments_summary', { p_org_id: orgId });
      expect(summary).toEqual({
        totalCollected: 15000.5,
        paymentCount: 5,
        totalReceivables: 25000,
        openInvoicesCount: 8,
      });
    });

    it('rejects with explicit failure when get_payments_summary RPC is unavailable (no unsafe client fallback)', async () => {
      const fromMock = vi.fn();
      mockSupabaseInstance = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'function get_payments_summary does not exist' },
        }),
        from: fromMock,
      };

      await expect(paymentsService.getPaymentsSummary(orgId, false)).rejects.toThrow(
        'Failed to fetch authoritative payments summary: function get_payments_summary does not exist'
      );
      // Confirms client table query fallback is completely eliminated
      expect(fromMock).not.toHaveBeenCalled();
    });

    it('rejects invalid or non-object response payload from get_payments_summary', async () => {
      mockSupabaseInstance = {
        rpc: vi.fn().mockResolvedValue({
          data: 'invalid_string_response',
          error: null,
        }),
      };

      await expect(paymentsService.getPaymentsSummary(orgId, false)).rejects.toThrow(
        'Invalid payments summary response: expected object payload'
      );
    });

    it('rejects missing or non-finite metric in payments summary response', async () => {
      mockSupabaseInstance = {
        rpc: vi.fn().mockResolvedValue({
          data: {
            total_collected: '15000.00',
            payment_count: 5,
            total_receivables: '25000.00',
            // open_invoices_count omitted
          },
          error: null,
        }),
      };

      await expect(paymentsService.getPaymentsSummary(orgId, false)).rejects.toThrow(
        'Invalid payments summary response: missing open_invoices_count'
      );
    });

    it('preserves legitimate numeric zero across all summary metrics', async () => {
      mockSupabaseInstance = {
        rpc: vi.fn().mockResolvedValue({
          data: {
            total_collected: 0,
            payment_count: 0,
            total_receivables: '0.00',
            open_invoices_count: 0,
          },
          error: null,
        }),
      };

      const summary = await paymentsService.getPaymentsSummary(orgId, false);
      expect(summary).toEqual({
        totalCollected: 0,
        paymentCount: 0,
        totalReceivables: 0,
        openInvoicesCount: 0,
      });
    });

    it('handles high-volume organization with >1,000 payments without truncation', async () => {
      mockSupabaseInstance = {
        rpc: vi.fn().mockResolvedValue({
          data: {
            total_collected: '4500000.00',
            payment_count: 1450,
            total_receivables: '1200000.00',
            open_invoices_count: 320,
          },
          error: null,
        }),
      };

      const summary = await paymentsService.getPaymentsSummary(orgId, false);
      expect(summary.paymentCount).toBe(1450);
      expect(summary.totalCollected).toBe(4500000);
    });

    it('handles high-volume organization with >1,000 invoices without truncation', async () => {
      mockSupabaseInstance = {
        rpc: vi.fn().mockResolvedValue({
          data: {
            total_collected: '2000000.00',
            payment_count: 850,
            total_receivables: '8500000.00',
            open_invoices_count: 2400,
          },
          error: null,
        }),
      };

      const summary = await paymentsService.getPaymentsSummary(orgId, false);
      expect(summary.openInvoicesCount).toBe(2400);
      expect(summary.totalReceivables).toBe(8500000);
    });

    it('rejects cross-tenant access to payments summary with security exception', async () => {
      mockSupabaseInstance = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Access denied: Caller cannot read organization data' },
        }),
      };

      await expect(paymentsService.getPaymentsSummary(orgId, false)).rejects.toThrow(
        'Failed to fetch authoritative payments summary: Access denied: Caller cannot read organization data'
      );
    });

    it('checks payment status by idempotency key during ambiguous network recovery', async () => {
      const maybeSingleMock = vi.fn().mockResolvedValue({
        data: { payment_id: 'pay-uuid-recovered-1' },
        error: null,
      });
      const eqKeyMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
      const eqOrgMock = vi.fn().mockReturnValue({ eq: eqKeyMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqOrgMock });

      const paySingleMock = vi.fn().mockResolvedValue({
        data: {
          id: 'pay-uuid-recovered-1',
          organization_id: orgId,
          payment_number: 'REC/26-27/0055',
          customer_id: 'cust-uuid-1',
          amount: 5000,
          payment_method: 'UPI',
          payment_date: '2026-11-05',
          allocations: [],
        },
        error: null,
      });
      const payEqIdMock = vi.fn().mockReturnValue({ maybeSingle: paySingleMock });
      const payEqOrgMock = vi.fn().mockReturnValue({ eq: payEqIdMock });
      const paySelectMock = vi.fn().mockReturnValue({ eq: payEqOrgMock });

      mockSupabaseInstance = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'payment_idempotency') {
            return { select: selectMock };
          }
          if (table === 'payments') {
            return { select: paySelectMock };
          }
          return {};
        }),
      };

      const res = await paymentsService.checkPaymentStatusByIdempotencyKey(orgId, 'key-uuid-1234');
      expect(res.committed).toBe(true);
      expect(res.payment?.paymentNumber).toBe('REC/26-27/0055');
    });

    it('rejects payment allocation to DRAFT invoice in storage layer', () => {
      const testOrg = 'test-org-draft-chk';
      const cust = storage.createCustomer(testOrg, {
        name: 'Test Customer',
        phone: '9845012345',
      } as any);

      const draftInv = storage.createInvoice(testOrg, {
        customerId: cust.id,
        status: 'DRAFT',
        invoiceDate: '2026-11-05',
        dueDate: '2026-12-05',
        items: [
          {
            productId: 'prod-001',
            productName: 'Switch',
            productSku: 'SW-1',
            uom: 'Nos',
            quantity: 1,
            unitPrice: 1000,
            taxRate: 18,
          },
        ],
      } as any);

      expect(() =>
        storage.recordPayment(
          testOrg,
          {
            customerId: cust.id,
            amount: 500,
            paymentMethod: 'CASH',
            paymentDate: '2026-11-05',
            invoiceId: draftInv.id,
          },
          'admin'
        )
      ).toThrow(/Cannot allocate payment to draft invoice/);
    });

    it('rejects payment allocation to invoice with customer mismatch', () => {
      const testOrg = 'test-org-mismatch-chk';
      const custA = storage.createCustomer(testOrg, {
        name: 'Cust A',
        phone: '9845012345',
      } as any);
      const custB = storage.createCustomer(testOrg, {
        name: 'Cust B',
        phone: '9845012346',
      } as any);

      const invA = storage.createInvoice(testOrg, {
        customerId: custA.id,
        status: 'ISSUED',
        invoiceDate: '2026-11-05',
        dueDate: '2026-12-05',
        items: [
          {
            productId: 'prod-001',
            productName: 'Switch',
            productSku: 'SW-1',
            uom: 'Nos',
            quantity: 1,
            unitPrice: 1000,
            taxRate: 18,
          },
        ],
      } as any);

      expect(() =>
        storage.recordPayment(
          testOrg,
          {
            customerId: custB.id,
            amount: 500,
            paymentMethod: 'CASH',
            paymentDate: '2026-11-05',
            invoiceId: invA.id,
          },
          'admin'
        )
      ).toThrow(/Customer mismatch/);
    });

    it('rejects payment allocation exceeding invoice balance', () => {
      const testOrg = 'test-org-overpay-chk';
      const cust = storage.createCustomer(testOrg, {
        name: 'Cust Overpay',
        phone: '9845012347',
      } as any);

      const inv = storage.createInvoice(testOrg, {
        customerId: cust.id,
        status: 'ISSUED',
        invoiceDate: '2026-11-05',
        dueDate: '2026-12-05',
        items: [
          {
            productId: 'prod-001',
            productName: 'Switch',
            productSku: 'SW-1',
            uom: 'Nos',
            quantity: 1,
            unitPrice: 100,
            taxRate: 0,
          },
        ],
      } as any);

      expect(() =>
        storage.recordPayment(
          testOrg,
          {
            customerId: cust.id,
            amount: 500, // exceeds total balance of 100
            paymentMethod: 'CASH',
            paymentDate: '2026-11-05',
            invoiceId: inv.id,
          },
          'admin'
        )
      ).toThrow(/exceeds outstanding invoice balance/);
    });

    it('idempotently replays duplicate payment requests without double-allocation', () => {
      const testOrg = 'test-org-idem-chk';
      const cust = storage.createCustomer(testOrg, {
        name: 'Cust Idem',
        phone: '9845012348',
      } as any);
      const idempotencyKey = 'idem-unique-key-12345';

      const inv = storage.createInvoice(testOrg, {
        customerId: cust.id,
        status: 'ISSUED',
        invoiceDate: '2026-11-05',
        dueDate: '2026-12-05',
        items: [
          {
            productId: 'prod-001',
            productName: 'Switch',
            productSku: 'SW-1',
            uom: 'Nos',
            quantity: 1,
            unitPrice: 500,
            taxRate: 0,
          },
        ],
      } as any);

      const pay1 = storage.recordPayment(
        testOrg,
        {
          customerId: cust.id,
          amount: 200,
          paymentMethod: 'BANK_TRANSFER',
          paymentDate: '2026-11-05',
          invoiceId: inv.id,
          idempotencyKey,
        },
        'admin'
      );

      const pay2 = storage.recordPayment(
        testOrg,
        {
          customerId: cust.id,
          amount: 200,
          paymentMethod: 'BANK_TRANSFER',
          paymentDate: '2026-11-05',
          invoiceId: inv.id,
          idempotencyKey,
        },
        'admin'
      );

      expect(pay1.id).toBe(pay2.id);
      expect(pay1.paymentNumber).toBe(pay2.paymentNumber);

      const updatedInv = storage.getInvoices(testOrg).find((i) => i.id === inv.id);
      expect(updatedInv?.totalPaid).toBe(200); // Not 400!
    });
  });
});
