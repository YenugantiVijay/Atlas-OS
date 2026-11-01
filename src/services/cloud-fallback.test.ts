import { describe, it, expect, beforeEach, vi } from 'vitest';
import { productsService } from './products.service';
import { customersService } from './customers.service';
import { suppliersService } from './suppliers.service';
import { ordersService } from './orders.service';
import { invoicesService } from './invoices.service';
import { paymentsService } from './payments.service';
import { inventoryService } from './inventory.service';
import { teamService } from './team.service';
import { dashboardService } from './dashboard.service';
import { auditService } from './audit.service';
import { allocateDocumentNumber } from './numbering.service';
import { storage } from '@/lib/storage';

// Controlled mock of @/lib/supabase
let mockSupabaseInstance: any = null;

vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return mockSupabaseInstance;
  },
  validateSupabaseConfig: vi.fn(),
}));

describe('Phase 1 Cloud Safety: Elimination of Silent LocalStorage Fallback', () => {
  const orgId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    localStorage.clear();
    storage.initialize(true);
    mockSupabaseInstance = null;
    vi.clearAllMocks();
  });

  describe('Scenario 1: Cloud Mode with Uninitialized Supabase Client (!supabase)', () => {
    it('throws explicit actionable error across all services without touching storage', async () => {
      mockSupabaseInstance = null;

      const initialPayments = storage.getPayments(orgId).length;
      const initialProducts = storage.getProducts(orgId).length;
      const initialCustomers = storage.getCustomers(orgId).length;

      // 1. Products
      await expect(productsService.getProducts(orgId, false)).rejects.toThrow(
        'Cloud backend is not configured: Supabase client is uninitialized.'
      );
      await expect(
        productsService.createProduct(
          orgId,
          {
            name: 'Cloud Wire',
            sku: 'CBL-CLOUD-01',
            brand: 'Polycab',
            category: 'Wires',
            uom: 'Coils',
            purchaseCost: 1000,
            sellingPrice: 1200,
            taxRate: 18,
            reorderThreshold: 10,
            isActive: true,
          },
          false,
          0
        )
      ).rejects.toThrow('Cloud backend is not configured: Supabase client is uninitialized.');

      // 2. Customers & Suppliers
      await expect(customersService.getCustomers(orgId, false)).rejects.toThrow(
        'Cloud backend is not configured: Supabase client is uninitialized.'
      );
      await expect(
        customersService.createCustomer(
          orgId,
          { name: 'Cloud Cust', phone: '9876543210', creditLimit: 50000, creditDays: 30, isActive: true },
          false
        )
      ).rejects.toThrow('Cloud backend is not configured: Supabase client is uninitialized.');
      await expect(suppliersService.getSuppliers(orgId, false)).rejects.toThrow(
        'Cloud backend is not configured: Supabase client is uninitialized.'
      );
      await expect(
        suppliersService.createSupplier(orgId, { name: 'Cloud Supp', isActive: true }, false)
      ).rejects.toThrow('Cloud backend is not configured: Supabase client is uninitialized.');

      // 3. Orders & Quotations
      await expect(ordersService.getSalesOrders(orgId, false)).rejects.toThrow(
        'Cloud backend is not configured: Supabase client is uninitialized.'
      );
      await expect(ordersService.getQuotations(orgId, false)).rejects.toThrow(
        'Cloud backend is not configured: Supabase client is uninitialized.'
      );
      await expect(
        ordersService.createSalesOrder(
          orgId,
          { customerId: 'c1', orderDate: '2026-03-01', items: [] },
          false
        )
      ).rejects.toThrow('Cloud backend is not configured: Supabase client is uninitialized.');
      await expect(
        ordersService.confirmSalesOrder(orgId, 'ord-1', 'owner', false)
      ).rejects.toThrow('Cloud backend is not configured: Supabase client is uninitialized.');
      await expect(
        ordersService.convertQuotationToOrder(orgId, 'q-1', false)
      ).rejects.toThrow('Cloud backend is not configured: Supabase client is uninitialized.');

      // 4. Invoices & Payments
      await expect(invoicesService.getInvoices(orgId, false)).rejects.toThrow(
        'Cloud backend is not configured: Supabase client is uninitialized.'
      );
      await expect(
        invoicesService.createInvoice(
          orgId,
          { customerId: 'c1', invoiceDate: '2026-03-01', dueDate: '2026-03-31', items: [] },
          false
        )
      ).rejects.toThrow('Cloud backend is not configured: Supabase client is uninitialized.');
      await expect(
        invoicesService.createInvoiceFromOrder(orgId, 'ord-1', false)
      ).rejects.toThrow('Cloud backend is not configured: Supabase client is uninitialized.');
      await expect(paymentsService.getPayments(orgId, false)).rejects.toThrow(
        'Cloud backend is not configured: Supabase client is uninitialized.'
      );
      await expect(
        paymentsService.recordPayment(
          orgId,
          {
            invoiceId: 'inv-1',
            customerId: 'c1',
            paymentDate: '2026-03-01',
            amount: 500,
            paymentMethod: 'CASH',
          },
          false,
          'owner'
        )
      ).rejects.toThrow('Cloud backend is not configured: Supabase client is uninitialized.');

      // 5. Inventory
      await expect(inventoryService.getStockMovements(orgId, undefined, false)).rejects.toThrow(
        'Cloud backend is not configured: Supabase client is uninitialized.'
      );
      await expect(
        inventoryService.adjustStock(orgId, 'p-1', 5, 'Audit count', '00000000-0000-0000-0000-000000000001', false)
      ).rejects.toThrow('Cloud backend is not configured: Supabase client is uninitialized.');
      await expect(inventoryService.getProductStock(orgId, 'p-1', false)).rejects.toThrow(
        'Cloud backend is not configured: Supabase client is uninitialized.'
      );

      // 6. Team & Dashboard & Audit & Numbering
      await expect(teamService.getMembers(orgId, false)).rejects.toThrow(
        'Cloud backend is not configured: Supabase client is uninitialized.'
      );
      await expect(
        teamService.updateMemberRole(orgId, 'm-1', 'admin', 'owner', false)
      ).rejects.toThrow('Cloud backend is not configured: Supabase client is uninitialized.');
      await expect(dashboardService.getDashboardMetrics(orgId, false)).rejects.toThrow(
        'Cloud backend is not configured: Supabase client is uninitialized.'
      );
      await expect(auditService.getAuditEvents(orgId, false)).rejects.toThrow(
        'Cloud backend is not configured: Supabase client is uninitialized.'
      );
      await expect(
        allocateDocumentNumber(orgId, 'RECEIPT', 2026, false)
      ).rejects.toThrow(/Access denied: RECEIPT numbers cannot be allocated directly in cloud mode/);
      await expect(
        allocateDocumentNumber(orgId, 'INVOICE', 2026, false)
      ).rejects.toThrow('Cloud backend is not configured: Supabase client is uninitialized.');

      // 7. Verify audit logging fails safely without writing to storage
      const auditResult = await auditService.logEvent(
        orgId,
        'TEST_ACTION',
        'TEST_ENTITY',
        '123',
        {},
        false
      );
      expect(auditResult.success).toBe(false);
      expect(auditResult.error).toContain('Supabase client is uninitialized');

      // CRITICAL: Ensure zero records were written to localStorage
      expect(storage.getPayments(orgId).length).toBe(initialPayments);
      expect(storage.getProducts(orgId).length).toBe(initialProducts);
      expect(storage.getCustomers(orgId).length).toBe(initialCustomers);
    });
  });

  describe('Scenario 2: Cloud Mode with Database Errors (No Silent Fallback to LocalStorage)', () => {
    it('propagates database error and does NOT fall back to localStorage', async () => {
      // Mock Supabase client returning database query error
      mockSupabaseInstance = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Database connection terminated unexpectedly' },
          }),
        }),
      };

      // In cloud mode (isMockAuth = false), it must throw the database error, NOT return mock/storage data
      await expect(productsService.getProducts(orgId, false)).rejects.toThrow(
        /Failed to fetch products: Database connection terminated unexpectedly/
      );

      await expect(customersService.getCustomers(orgId, false)).rejects.toThrow(
        /Failed to fetch customers: Database connection terminated unexpectedly/
      );

      await expect(suppliersService.getSuppliers(orgId, false)).rejects.toThrow(
        /Failed to fetch suppliers: Database connection terminated unexpectedly/
      );
    });

    it('propagates RPC error during payment recording and does NOT write payment to local storage', async () => {
      mockSupabaseInstance = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Overpayment violation: Allocation of 1000 exceeds remaining balance' },
        }),
      };

      const initialPayments = storage.getPayments(orgId).length;

      await expect(
        paymentsService.recordPayment(
          orgId,
          {
            invoiceId: 'inv-1',
            customerId: 'cust-1',
            paymentDate: '2026-03-01',
            amount: 1000,
            paymentMethod: 'UPI',
          },
          false,
          'owner'
        )
      ).rejects.toThrow(/Overpayment violation: Allocation of 1000 exceeds remaining balance/);

      // Verify no storage write happened
      expect(storage.getPayments(orgId).length).toBe(initialPayments);
    });

    it('records payment in cloud mode generating canonical RCP-YYYY-NNNN receipt via RPC', async () => {
      mockSupabaseInstance = {
        rpc: vi.fn().mockResolvedValue({
          data: { success: true, payment_id: 'pay-001', payment_number: 'RCP-2026-0001' },
          error: null,
        }),
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'pay-001',
              organization_id: orgId,
              payment_number: 'RCP-2026-0001',
              customer_id: 'cust-1',
              amount: '1000.00',
              payment_method: 'UPI',
              payment_date: '2026-03-01',
              created_at: '2026-03-01T10:00:00Z',
              allocations: [{ id: 'alloc-1', payment_id: 'pay-001', invoice_id: 'inv-1', amount_allocated: '1000.00' }],
            },
            error: null,
          }),
        }),
      };

      const payment = await paymentsService.recordPayment(
        orgId,
        {
          invoiceId: 'inv-1',
          customerId: 'cust-1',
          paymentDate: '2026-03-01',
          amount: 1000,
          paymentMethod: 'UPI',
        },
        false,
        'owner'
      );

      expect(payment.id).toBe('pay-001');
      expect(payment.paymentNumber).toBe('RCP-2026-0001');
      expect(payment.amount).toBe(1000);
      expect(payment.allocations?.length).toBe(1);
    });

    it('warns user explicitly and prevents double submission if RPC succeeds but confirmation read fails', async () => {
      mockSupabaseInstance = {
        rpc: vi.fn().mockResolvedValue({
          data: { success: true, payment_id: 'pay-002', payment_number: 'RCP-2026-0002' },
          error: null,
        }),
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Read replica timeout' },
          }),
        }),
      };

      await expect(
        paymentsService.recordPayment(
          orgId,
          {
            invoiceId: 'inv-1',
            customerId: 'cust-1',
            paymentDate: '2026-03-01',
            amount: 500,
            paymentMethod: 'BANK_TRANSFER',
          },
          false,
          'owner'
        )
      ).rejects.toThrow(
        /Payment was committed to the ledger \(Receipt RCP-2026-0002\), but loading confirmation details failed.*Do NOT resubmit this payment/
      );
    });
  });

  describe('Scenario 3: Explicit Demo Mode Preservation (isMockAuth: true)', () => {
    it('continues to read and persist via storage.ts in explicit demo mode', async () => {
      mockSupabaseInstance = null; // Even if supabase is null

      const products = await productsService.getProducts(orgId, true);
      expect(Array.isArray(products)).toBe(true);

      const customers = await customersService.getCustomers(orgId, true);
      expect(Array.isArray(customers)).toBe(true);

      // Create a customer in demo mode
      const newCust = await customersService.createCustomer(
        orgId,
        {
          name: 'Demo Electricals',
          phone: '9876543210',
          creditLimit: 100000,
          creditDays: 30,
          isActive: true,
        },
        true
      );
      expect(newCust.id).toBeDefined();
      expect(newCust.name).toBe('Demo Electricals');

      // Verify it was stored in storage.ts
      const demoCusts = storage.getCustomers(orgId);
      expect(demoCusts.some((c) => c.name === 'Demo Electricals')).toBe(true);
    });
  });
});
