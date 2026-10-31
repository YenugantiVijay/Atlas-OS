import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoicesService, CreateInvoiceInput } from './invoices.service';
import { storage } from '@/lib/storage';
import * as fs from 'fs';
import * as path from 'path';

// Controlled mock of @/lib/supabase
let mockSupabaseInstance: any = null;

vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return mockSupabaseInstance;
  },
  validateSupabaseConfig: vi.fn(),
}));

describe('Invoices Service & Atomic Invoice Creation (DEF-001 Repair)', () => {
  const orgId = '00000000-0000-0000-0000-000000000001';
  const customerId = '00000000-0000-0000-0000-000000000002';
  const productId1 = '00000000-0000-0000-0000-000000000003';
  const productId2 = '00000000-0000-0000-0000-000000000004';

  beforeEach(() => {
    localStorage.clear();
    storage.initialize(true);
    mockSupabaseInstance = null;
    vi.clearAllMocks();
  });

  describe('Atomic RPC Invocation via create_invoice_atomic', () => {
    it('successfully calls create_invoice_atomic RPC and returns canonical mapped invoice', async () => {
      const mockRpcResponse = {
        id: 'inv-uuid-001',
        organization_id: orgId,
        invoice_number: 'ATL/26-27/0001',
        customer_id: customerId,
        sales_order_id: null,
        status: 'ISSUED',
        invoice_date: '2026-10-31',
        due_date: '2026-11-30',
        subtotal: 2000.0,
        discount_amount: 100.0,
        tax_amount: 342.0,
        total_amount: 2242.0,
        total_paid: 0,
        totals_version: 2,
        notes: 'Test invoice',
        created_by: 'user-uuid-1',
        created_at: '2026-10-31T12:00:00Z',
        updated_at: '2026-10-31T12:00:00Z',
        idempotent_replay: false,
        items: [
          {
            id: 'item-uuid-001',
            invoice_id: 'inv-uuid-001',
            product_id: productId1,
            product_name: 'Polycab 1.5 sq mm Wire',
            product_sku: 'CBL-FR-1.5',
            hsn_code: '8544',
            uom: 'Coils',
            quantity: 2,
            unit_price: 1000.0,
            discount_percent: 5.0,
            tax_rate: 18.0,
            line_subtotal: 1900.0,
            line_tax: 342.0,
            line_total: 2242.0,
            document_discount_share: 0,
          },
        ],
      };

      const mockRpc = vi.fn().mockResolvedValue({
        data: mockRpcResponse,
        error: null,
      });

      mockSupabaseInstance = {
        rpc: mockRpc,
      };

      const input: CreateInvoiceInput = {
        customerId,
        invoiceDate: '2026-10-31',
        dueDate: '2026-11-30',
        notes: 'Test invoice',
        items: [
          {
            productId: productId1,
            productName: 'Polycab 1.5 sq mm Wire',
            productSku: 'CBL-FR-1.5',
            uom: 'Coils',
            quantity: 2,
            unitPrice: 1000.0,
            discountPercent: 5.0,
            taxRate: 18.0,
          },
        ],
      };

      const result = await invoicesService.createInvoice(orgId, input, false);

      expect(mockRpc).toHaveBeenCalledTimes(1);
      const [rpcName, rpcParams] = mockRpc.mock.calls[0];
      expect(rpcName).toBe('create_invoice_atomic');
      expect(rpcParams.p_org_id).toBe(orgId);
      expect(rpcParams.p_customer_id).toBe(customerId);
      expect(rpcParams.p_status).toBe('ISSUED');
      expect(rpcParams.p_invoice_date).toBe('2026-10-31');
      expect(rpcParams.p_due_date).toBe('2026-11-30');
      expect(rpcParams.p_notes).toBe('Test invoice');
      expect(rpcParams.p_items).toHaveLength(1);
      expect(rpcParams.p_items[0].product_id).toBe(productId1);
      expect(rpcParams.p_idempotency_key).toBeTruthy(); // Auto-generated UUID

      // Verify mapped domain model
      expect(result.id).toBe('inv-uuid-001');
      expect(result.invoiceNumber).toBe('ATL/26-27/0001');
      expect(result.status).toBe('ISSUED');
      expect(result.totalAmount).toBe(2242.0);
      expect(result.items).toHaveLength(1);
      expect(result.items?.[0].productSku).toBe('CBL-FR-1.5');
    });

    it('creates invoice with explicit DRAFT status when requested', async () => {
      const mockRpcResponse = {
        id: 'inv-uuid-draft',
        organization_id: orgId,
        invoice_number: 'ATL/26-27/0002',
        customer_id: customerId,
        sales_order_id: null,
        status: 'DRAFT',
        invoice_date: '2026-10-31',
        due_date: '2026-11-30',
        subtotal: 1000.0,
        discount_amount: 0,
        tax_amount: 180.0,
        total_amount: 1180.0,
        total_paid: 0,
        totals_version: 2,
        notes: null,
        created_by: 'user-uuid-1',
        created_at: '2026-10-31T12:00:00Z',
        updated_at: '2026-10-31T12:00:00Z',
        idempotent_replay: false,
        items: [],
      };

      const mockRpc = vi.fn().mockResolvedValue({
        data: mockRpcResponse,
        error: null,
      });

      mockSupabaseInstance = { rpc: mockRpc };

      const result = await invoicesService.createInvoice(
        orgId,
        {
          customerId,
          status: 'DRAFT',
          invoiceDate: '2026-10-31',
          dueDate: '2026-11-30',
          items: [
            {
              productId: productId1,
              productName: 'Polycab 1.5 sq mm Wire',
              productSku: 'CBL-FR-1.5',
              uom: 'Coils',
              quantity: 1,
              unitPrice: 1000.0,
              discountPercent: 0,
              taxRate: 18.0,
            },
          ],
        },
        false
      );

      expect(mockRpc).toHaveBeenCalledWith('create_invoice_atomic', expect.objectContaining({
        p_status: 'DRAFT',
      }));
      expect(result.status).toBe('DRAFT');
    });

    it('handles idempotent replay response transparently', async () => {
      const existingId = 'inv-uuid-existing-001';
      const mockRpcReplay = {
        id: existingId,
        organization_id: orgId,
        invoice_number: 'ATL/26-27/0001',
        customer_id: customerId,
        sales_order_id: null,
        status: 'ISSUED',
        invoice_date: '2026-10-31',
        due_date: '2026-11-30',
        subtotal: 2000.0,
        discount_amount: 100.0,
        tax_amount: 342.0,
        total_amount: 2242.0,
        total_paid: 0,
        totals_version: 2,
        notes: 'Test invoice',
        created_by: 'user-uuid-1',
        created_at: '2026-10-31T12:00:00Z',
        updated_at: '2026-10-31T12:00:00Z',
        idempotent_replay: true,
        items: [
          {
            id: 'item-uuid-001',
            invoice_id: existingId,
            product_id: productId1,
            product_name: 'Polycab 1.5 sq mm Wire',
            product_sku: 'CBL-FR-1.5',
            hsn_code: '8544',
            uom: 'Coils',
            quantity: 2,
            unit_price: 1000.0,
            discount_percent: 5.0,
            tax_rate: 18.0,
            line_subtotal: 1900.0,
            line_tax: 342.0,
            line_total: 2242.0,
            document_discount_share: 0,
          },
        ],
      };

      mockSupabaseInstance = {
        rpc: vi.fn().mockResolvedValue({
          data: mockRpcReplay,
          error: null,
        }),
      };

      const result = await invoicesService.createInvoice(
        orgId,
        {
          customerId,
          idempotencyKey: '00000000-1111-2222-3333-444444444444',
          invoiceDate: '2026-10-31',
          dueDate: '2026-11-30',
          items: [
            {
              productId: productId1,
              productName: 'Polycab 1.5 sq mm Wire',
              productSku: 'CBL-FR-1.5',
              uom: 'Coils',
              quantity: 2,
              unitPrice: 1000.0,
              discountPercent: 5.0,
              taxRate: 18.0,
            },
          ],
        },
        false
      );

      expect(result.id).toBe(existingId);
      expect(result.invoiceNumber).toBe('ATL/26-27/0001');
      expect(result.totalAmount).toBe(2242.0);
    });

    it('successfully calls create_invoice_atomic RPC with multiple items', async () => {
      const mockRpcMultiResponse = {
        id: 'inv-uuid-multi',
        organization_id: orgId,
        invoice_number: 'ATL/26-27/0003',
        customer_id: customerId,
        sales_order_id: null,
        status: 'ISSUED',
        invoice_date: '2026-10-31',
        due_date: '2026-11-30',
        subtotal: 3500.0,
        discount_amount: 50.0,
        tax_amount: 621.0,
        total_amount: 4071.0,
        total_paid: 0,
        totals_version: 2,
        notes: null,
        created_at: '2026-10-31T12:00:00Z',
        updated_at: '2026-10-31T12:00:00Z',
        items: [
          {
            id: 'item-1',
            invoice_id: 'inv-uuid-multi',
            product_id: productId1,
            product_name: 'Polycab 1.5 sq mm Wire',
            product_sku: 'CBL-FR-1.5',
            uom: 'Coils',
            quantity: 2,
            unit_price: 1000.0,
            discount_percent: 0,
            tax_rate: 18.0,
            line_subtotal: 2000.0,
            line_tax: 360.0,
            line_total: 2360.0,
            document_discount_share: 0,
          },
          {
            id: 'item-2',
            invoice_id: 'inv-uuid-multi',
            product_id: productId2,
            product_name: 'Havells 2.5 sq mm Wire',
            product_sku: 'CBL-FR-2.5',
            uom: 'Coils',
            quantity: 1,
            unit_price: 1500.0,
            discount_percent: 5.0,
            tax_rate: 18.0,
            line_subtotal: 1425.0,
            line_tax: 256.5,
            line_total: 1681.5,
            document_discount_share: 0,
          },
        ],
      };

      const mockRpc = vi.fn().mockResolvedValue({
        data: mockRpcMultiResponse,
        error: null,
      });

      mockSupabaseInstance = { rpc: mockRpc };

      const result = await invoicesService.createInvoice(
        orgId,
        {
          customerId,
          invoiceDate: '2026-10-31',
          dueDate: '2026-11-30',
          items: [
            {
              productId: productId1,
              productName: 'Polycab 1.5 sq mm Wire',
              productSku: 'CBL-FR-1.5',
              uom: 'Coils',
              quantity: 2,
              unitPrice: 1000.0,
              discountPercent: 0,
              taxRate: 18.0,
            },
            {
              productId: productId2,
              productName: 'Havells 2.5 sq mm Wire',
              productSku: 'CBL-FR-2.5',
              uom: 'Coils',
              quantity: 1,
              unitPrice: 1500.0,
              discountPercent: 5.0,
              taxRate: 18.0,
            },
          ],
        },
        false
      );

      expect(mockRpc).toHaveBeenCalledTimes(1);
      const [, rpcParams] = mockRpc.mock.calls[0];
      expect(rpcParams.p_items).toHaveLength(2);
      expect(rpcParams.p_items[0].product_id).toBe(productId1);
      expect(rpcParams.p_items[1].product_id).toBe(productId2);
      expect(result.items).toHaveLength(2);
      expect(result.totalAmount).toBe(4071.0);
    });

    it('passes custom idempotency key when provided in input', async () => {
      const customKey = '11111111-2222-3333-4444-555555555555';
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          id: 'inv-uuid-002',
          organization_id: orgId,
          invoice_number: 'ATL/26-27/0002',
          customer_id: customerId,
          status: 'ISSUED',
          invoice_date: '2026-10-31',
          due_date: '2026-11-30',
          subtotal: 1000,
          discount_amount: 0,
          tax_amount: 180,
          total_amount: 1180,
          total_paid: 0,
          totals_version: 2,
          created_at: '2026-10-31T12:00:00Z',
          updated_at: '2026-10-31T12:00:00Z',
          items: [],
        },
        error: null,
      });

      mockSupabaseInstance = { rpc: mockRpc };

      await invoicesService.createInvoice(
        orgId,
        {
          customerId,
          invoiceDate: '2026-10-31',
          dueDate: '2026-11-30',
          idempotencyKey: customKey,
          items: [
            {
              productId: productId1,
              productName: 'Wire',
              productSku: 'W-01',
              uom: 'Nos',
              quantity: 1,
              unitPrice: 1000,
              taxRate: 18,
            },
          ],
        },
        false
      );

      expect(mockRpc).toHaveBeenCalledWith('create_invoice_atomic', expect.objectContaining({
        p_idempotency_key: customKey,
      }));
    });

    it('propagates RPC error when database transaction fails (e.g. customer not found)', async () => {
      mockSupabaseInstance = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: `Customer ${customerId} not found or inactive in organization ${orgId}` },
        }),
      };

      await expect(
        invoicesService.createInvoice(
          orgId,
          {
            customerId,
            invoiceDate: '2026-10-31',
            dueDate: '2026-11-30',
            items: [
              {
                productId: productId1,
                productName: 'Wire',
                productSku: 'W-01',
                uom: 'Nos',
                quantity: 1,
                unitPrice: 1000,
                taxRate: 18,
              },
            ],
          },
          false
        )
      ).rejects.toThrow(`Failed to create invoice: Customer ${customerId} not found or inactive in organization ${orgId}`);
    });

    it('propagates idempotency conflict error on payload mismatch with reused key', async () => {
      const conflictKey = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      mockSupabaseInstance = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: `ERR_IDEMPOTENCY_CONFLICT: Idempotency key "${conflictKey}" reused with different request payload` },
        }),
      };

      await expect(
        invoicesService.createInvoice(
          orgId,
          {
            customerId,
            invoiceDate: '2026-10-31',
            dueDate: '2026-11-30',
            idempotencyKey: conflictKey,
            items: [
              {
                productId: productId1,
                productName: 'Wire',
                productSku: 'W-01',
                uom: 'Nos',
                quantity: 1,
                unitPrice: 1000,
                taxRate: 18,
              },
            ],
          },
          false
        )
      ).rejects.toThrow(`ERR_IDEMPOTENCY_CONFLICT: Idempotency key "${conflictKey}" reused with different request payload`);
    });

    it('throws when RPC succeeds but returns no data payload', async () => {
      mockSupabaseInstance = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      };

      await expect(
        invoicesService.createInvoice(
          orgId,
          {
            customerId,
            invoiceDate: '2026-10-31',
            dueDate: '2026-11-30',
            items: [
              {
                productId: productId1,
                productName: 'Wire',
                productSku: 'W-01',
                uom: 'Nos',
                quantity: 1,
                unitPrice: 1000,
                taxRate: 18,
              },
            ],
          },
          false
        )
      ).rejects.toThrow('Invoice creation succeeded but no invoice payload was returned from server.');
    });
  });

  describe('createInvoiceFromOrder Delegation to Atomic RPC', () => {
    it('fetches order details and delegates creation to atomic createInvoice', async () => {
      const orderId = 'order-uuid-101';
      const mockOrderRow = {
        id: orderId,
        organization_id: orgId,
        order_number: 'SO-2026-0042',
        customer_id: customerId,
        status: 'CONFIRMED',
        items: [
          {
            product_id: productId1,
            product_name: 'Polycab 1.5 sq mm Wire',
            product_sku: 'CBL-FR-1.5',
            uom: 'Coils',
            quantity: 5,
            unit_price: 1200.0,
            discount_percent: 0,
            tax_rate: 18.0,
          },
        ],
      };

      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          id: 'inv-from-order-001',
          organization_id: orgId,
          invoice_number: 'ATL/26-27/0050',
          customer_id: customerId,
          sales_order_id: orderId,
          status: 'ISSUED',
          invoice_date: '2026-10-31',
          due_date: '2026-11-30',
          subtotal: 6000.0,
          discount_amount: 0,
          tax_amount: 1080.0,
          total_amount: 7080.0,
          total_paid: 0,
          totals_version: 2,
          notes: 'Generated from Sales Order SO-2026-0042',
          created_at: '2026-10-31T12:00:00Z',
          updated_at: '2026-10-31T12:00:00Z',
          items: [],
        },
        error: null,
      });

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'sales_orders') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: mockOrderRow,
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'invoices') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  neq: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({
                      data: [],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      });

      mockSupabaseInstance = {
        from: mockFrom,
        rpc: mockRpc,
      };

      const invoice = await invoicesService.createInvoiceFromOrder(orgId, orderId, false);

      expect(mockFrom).toHaveBeenCalledWith('sales_orders');
      expect(mockRpc).toHaveBeenCalledWith('create_invoice_atomic', expect.objectContaining({
        p_org_id: orgId,
        p_customer_id: customerId,
        p_sales_order_id: orderId,
        p_status: 'ISSUED',
        p_notes: 'Generated from Sales Order SO-2026-0042',
      }));
      expect(invoice.id).toBe('inv-from-order-001');
      expect(invoice.salesOrderId).toBe(orderId);
      expect(invoice.invoiceNumber).toBe('ATL/26-27/0050');
    });

    it('throws descriptive error if sales order is not found', async () => {
      mockSupabaseInstance = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'Row not found' },
                }),
              }),
            }),
          }),
        }),
      };

      await expect(
        invoicesService.createInvoiceFromOrder(orgId, 'missing-order', false)
      ).rejects.toThrow(/Sales order not found: Row not found/);
    });

    it('rejects invoice creation if sales order status is DRAFT', async () => {
      const mockRpc = vi.fn();
      mockSupabaseInstance = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'draft-so-id',
                    organization_id: orgId,
                    order_number: 'SO-DRAFT-001',
                    customer_id: customerId,
                    status: 'DRAFT',
                    items: [],
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
        rpc: mockRpc,
      };

      await expect(
        invoicesService.createInvoiceFromOrder(orgId, 'draft-so-id', false)
      ).rejects.toThrow(/Cannot invoice sales order in status "DRAFT". Only CONFIRMED orders can be invoiced./);

      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('rejects invoice creation if sales order status is CANCELLED', async () => {
      const mockRpc = vi.fn();
      mockSupabaseInstance = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'cancelled-so-id',
                    organization_id: orgId,
                    order_number: 'SO-CAN-001',
                    customer_id: customerId,
                    status: 'CANCELLED',
                    items: [],
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
        rpc: mockRpc,
      };

      await expect(
        invoicesService.createInvoiceFromOrder(orgId, 'cancelled-so-id', false)
      ).rejects.toThrow(/Cannot invoice sales order in status "CANCELLED". Only CONFIRMED orders can be invoiced./);

      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('rejects invoice creation if sales order status is FULFILLED', async () => {
      const mockRpc = vi.fn();
      mockSupabaseInstance = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'fulfilled-so-id',
                    organization_id: orgId,
                    order_number: 'SO-FUL-001',
                    customer_id: customerId,
                    status: 'FULFILLED',
                    items: [],
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
        rpc: mockRpc,
      };

      await expect(
        invoicesService.createInvoiceFromOrder(orgId, 'fulfilled-so-id', false)
      ).rejects.toThrow(/Cannot invoice sales order in status "FULFILLED". Only CONFIRMED orders can be invoiced./);

      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('rejects invoice creation if active non-cancelled invoice already exists in pre-check', async () => {
      const mockRpc = vi.fn();
      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'sales_orders') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: 'so-already-invoiced',
                      organization_id: orgId,
                      order_number: 'SO-2026-0099',
                      customer_id: customerId,
                      status: 'CONFIRMED',
                      items: [],
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'invoices') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  neq: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({
                      data: [{ id: 'inv-existing-1', invoice_number: 'ATL/26-27/0099' }],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      });

      mockSupabaseInstance = {
        from: mockFrom,
        rpc: mockRpc,
      };

      await expect(
        invoicesService.createInvoiceFromOrder(orgId, 'so-already-invoiced', false)
      ).rejects.toThrow(/Sales order SO-2026-0099 has already been invoiced under invoice ATL\/26-27\/0099./);

      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('tolerates non-blocking pre-check query error and proceeds to authoritative RPC', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          id: 'inv-fallback-success',
          organization_id: orgId,
          invoice_number: 'ATL/26-27/0100',
          customer_id: customerId,
          sales_order_id: 'so-err-precheck',
          status: 'ISSUED',
          invoice_date: '2026-10-31',
          due_date: '2026-11-30',
          subtotal: 1000.0,
          discount_amount: 0,
          tax_amount: 180.0,
          total_amount: 1180.0,
          total_paid: 0,
          totals_version: 2,
          notes: 'Generated from Sales Order SO-2026-0100',
          created_at: '2026-10-31T12:00:00Z',
          updated_at: '2026-10-31T12:00:00Z',
          items: [],
        },
        error: null,
      });

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'sales_orders') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: 'so-err-precheck',
                      organization_id: orgId,
                      order_number: 'SO-2026-0100',
                      customer_id: customerId,
                      status: 'CONFIRMED',
                      items: [
                        {
                          product_id: productId1,
                          product_name: 'Polycab 1.5 sq mm Wire',
                          product_sku: 'CBL-FR-1.5',
                          uom: 'Coils',
                          quantity: 1,
                          unit_price: 1000,
                          discount_percent: 0,
                          tax_rate: 18,
                        },
                      ],
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'invoices') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  neq: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({
                      data: null,
                      error: { message: 'Network timeout during pre-check query' },
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      });

      mockSupabaseInstance = {
        from: mockFrom,
        rpc: mockRpc,
      };

      const result = await invoicesService.createInvoiceFromOrder(orgId, 'so-err-precheck', false);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Non-blocking existing invoice pre-check query failed:',
        'Network timeout during pre-check query'
      );
      expect(mockRpc).toHaveBeenCalledWith('create_invoice_atomic', expect.anything());
      expect(result.id).toBe('inv-fallback-success');
      consoleWarnSpy.mockRestore();
    });

    it('propagates RPC error when database RPC rejects invalid order state or duplicate', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Sales order so-rpc-fail has already been invoiced' },
      });

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'sales_orders') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: 'so-rpc-fail',
                      organization_id: orgId,
                      order_number: 'SO-2026-FAIL',
                      customer_id: customerId,
                      status: 'CONFIRMED',
                      items: [],
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'invoices') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  neq: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({
                      data: [],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      });

      mockSupabaseInstance = {
        from: mockFrom,
        rpc: mockRpc,
      };

      await expect(
        invoicesService.createInvoiceFromOrder(orgId, 'so-rpc-fail', false)
      ).rejects.toThrow(/Failed to create invoice: Sales order so-rpc-fail has already been invoiced/);
    });

    it('delegates custom idempotency key to create_invoice_atomic when provided', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          id: 'inv-custom-key-01',
          organization_id: orgId,
          invoice_number: 'ATL/26-27/0101',
          customer_id: customerId,
          sales_order_id: 'so-custom-key',
          status: 'ISSUED',
          invoice_date: '2026-10-31',
          due_date: '2026-11-30',
          subtotal: 1000.0,
          discount_amount: 0,
          tax_amount: 180.0,
          total_amount: 1180.0,
          total_paid: 0,
          totals_version: 2,
          notes: 'Generated from Sales Order SO-2026-0101',
          created_at: '2026-10-31T12:00:00Z',
          updated_at: '2026-10-31T12:00:00Z',
          items: [],
        },
        error: null,
      });

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === 'sales_orders') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: 'so-custom-key',
                      organization_id: orgId,
                      order_number: 'SO-2026-0101',
                      customer_id: customerId,
                      status: 'CONFIRMED',
                      items: [],
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'invoices') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  neq: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue({
                      data: [],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      });

      mockSupabaseInstance = {
        from: mockFrom,
        rpc: mockRpc,
      };

      const customKey = 'e4b3e8c0-82a1-4321-9988-776655443322';
      await invoicesService.createInvoiceFromOrder(orgId, 'so-custom-key', false, customKey);

      expect(mockRpc).toHaveBeenCalledWith('create_invoice_atomic', expect.objectContaining({
        p_idempotency_key: customKey,
      }));
    });
  });

  describe('Mock/Storage Mode Compatibility', () => {
    it('seamlessly falls back to storage when isMockAuth is true', async () => {
      const orgs = storage.getOrganizations();
      const custs = storage.getCustomers(orgs[0].id);
      const prods = storage.getProducts(orgs[0].id);

      const invoice = await invoicesService.createInvoice(
        orgs[0].id,
        {
          customerId: custs[0].id,
          invoiceDate: '2026-10-31',
          dueDate: '2026-11-30',
          items: [
            {
              productId: prods[0].id,
              productName: prods[0].name,
              productSku: prods[0].sku,
              uom: prods[0].uom,
              quantity: 1,
              unitPrice: 1500,
              discountPercent: 0,
              taxRate: 18,
            },
          ],
        },
        true // isMockAuth
      );

      expect(invoice.id).toBeTruthy();
      expect(invoice.status).toBe('ISSUED');
      expect(invoice.totalAmount).toBe(1770); // 1500 + 18% GST (270)
    });
  });

  describe('Migration 015 SQL Schema & Transaction Order Contract (Static Analysis)', () => {
    const migrationPath = path.resolve(__dirname, '../../supabase/migrations/015_atomic_invoice_creation_rpc.sql');
    let migrationSql: string;

    beforeEach(() => {
      migrationSql = fs.readFileSync(migrationPath, 'utf-8');
    });

    it('verifies parent invoice header is inserted BEFORE child invoice items', () => {
      const headerInsertIndex = migrationSql.indexOf('INSERT INTO public.invoices');
      const itemsInsertIndex = migrationSql.indexOf('INSERT INTO public.invoice_items');

      expect(headerInsertIndex).toBeGreaterThan(0);
      expect(itemsInsertIndex).toBeGreaterThan(0);
      expect(headerInsertIndex).toBeLessThan(itemsInsertIndex);
    });

    it('verifies invoice header is inserted initially with DRAFT status', () => {
      const headerInsertMatch = migrationSql.match(/INSERT INTO public\.invoices\s*\([^)]+\)\s*VALUES\s*\(([^)]+)\)/i);
      expect(headerInsertMatch).toBeTruthy();
      expect(headerInsertMatch![1]).toContain("'DRAFT'");
    });

    it('verifies lifecycle transition to ISSUED occurs AFTER items are inserted', () => {
      const itemsInsertIndex = migrationSql.indexOf('INSERT INTO public.invoice_items');
      const statusUpdateIndex = migrationSql.indexOf("UPDATE public.invoices\n           SET status = 'ISSUED'");

      expect(statusUpdateIndex).toBeGreaterThan(itemsInsertIndex);
    });

    it('verifies item validation occurs BEFORE calling internal_allocate_document_number', () => {
      const itemValidationIndex = migrationSql.indexOf("Item quantity must be greater than zero");
      const sequenceAllocationIndex = migrationSql.indexOf("v_invoice_number := public.internal_allocate_document_number");

      expect(itemValidationIndex).toBeGreaterThan(0);
      expect(sequenceAllocationIndex).toBeGreaterThan(0);
      expect(itemValidationIndex).toBeLessThan(sequenceAllocationIndex);
    });

    it('verifies deterministic ascending product locking to prevent deadlocks', () => {
      expect(migrationSql).toContain('ORDER BY id ASC\n    FOR UPDATE');
    });

    it('verifies function is SECURITY DEFINER with fixed search_path', () => {
      expect(migrationSql).toContain('SECURITY DEFINER\nSET search_path = public, pg_temp');
    });

    it('verifies execution is granted to authenticated and revoked from public/anon', () => {
      expect(migrationSql).toContain('REVOKE ALL ON FUNCTION public.create_invoice_atomic(UUID, UUID, JSONB, DATE, DATE, VARCHAR, TEXT, UUID, UUID) FROM PUBLIC, anon;');
      expect(migrationSql).toContain('GRANT EXECUTE ON FUNCTION public.create_invoice_atomic(UUID, UUID, JSONB, DATE, DATE, VARCHAR, TEXT, UUID, UUID) TO authenticated;');
    });

    it('verifies explicit owner execute alignment for internal_allocate_document_number', () => {
      expect(migrationSql).toContain('GRANT EXECUTE ON FUNCTION public.internal_allocate_document_number(UUID, VARCHAR, INTEGER) TO %I');
    });

    it('(Static Contract Test) verifies SQL explicitly rejects NULL/missing product_id inside item loop before sequence allocation', () => {
      const nullCheckIndex = migrationSql.indexOf("IF v_item_prod_id IS NULL THEN\n            RAISE EXCEPTION 'Item % must contain a valid product_id'");
      const sequenceAllocationIndex = migrationSql.indexOf("v_invoice_number := public.internal_allocate_document_number");

      expect(nullCheckIndex).toBeGreaterThan(0);
      expect(sequenceAllocationIndex).toBeGreaterThan(0);
      expect(nullCheckIndex).toBeLessThan(sequenceAllocationIndex);
    });
  });

  describe('Product ID Validation & Rejection Contract (Mocked Unit Tests)', () => {
    it('(Mocked Unit Test) rejects single-item invoice with missing product_id', async () => {
      mockSupabaseInstance = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'All line items must contain a valid product_id' },
        }),
      };

      await expect(
        invoicesService.createInvoice(
          orgId,
          {
            customerId,
            invoiceDate: '2026-10-31',
            dueDate: '2026-11-30',
            items: [
              {
                productId: '' as any,
                productName: 'Ad-hoc Service',
                productSku: 'MISC-01',
                uom: 'Nos',
                quantity: 1,
                unitPrice: 500,
              },
            ],
          },
          false
        )
      ).rejects.toThrow('Failed to create invoice: All line items must contain a valid product_id');
    });

    it('(Mocked Unit Test) rejects multi-item invoice where first item is valid and second has missing product_id', async () => {
      mockSupabaseInstance = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Item 2 must contain a valid product_id' },
        }),
      };

      await expect(
        invoicesService.createInvoice(
          orgId,
          {
            customerId,
            invoiceDate: '2026-10-31',
            dueDate: '2026-11-30',
            items: [
              {
                productId: productId1,
                productName: 'Polycab 1.5 sq mm Wire',
                productSku: 'CBL-FR-1.5',
                uom: 'Coils',
                quantity: 2,
                unitPrice: 1000,
              },
              {
                productId: undefined as any,
                productName: 'Custom Labor',
                productSku: 'LABOR-01',
                uom: 'Nos',
                quantity: 4,
                unitPrice: 250,
              },
            ],
          },
          false
        )
      ).rejects.toThrow('Failed to create invoice: Item 2 must contain a valid product_id');
    });

    it('(Mocked Unit Test) rejects multi-item invoice where second item has product_id: null and client-supplied product_sku', async () => {
      mockSupabaseInstance = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Item 2 must contain a valid product_id' },
        }),
      };

      await expect(
        invoicesService.createInvoice(
          orgId,
          {
            customerId,
            invoiceDate: '2026-10-31',
            dueDate: '2026-11-30',
            items: [
              {
                productId: productId1,
                productName: 'Polycab 1.5 sq mm Wire',
                productSku: 'CBL-FR-1.5',
                uom: 'Coils',
                quantity: 1,
                unitPrice: 1000,
              },
              {
                productId: null as any,
                productName: 'Bypass Item',
                productSku: 'CLIENT-SKU-BYPASS',
                uom: 'Nos',
                quantity: 1,
                unitPrice: 500,
              },
            ],
          },
          false
        )
      ).rejects.toThrow('Failed to create invoice: Item 2 must contain a valid product_id');
    });

    it('(Mocked Unit Test) rejects empty product ID with UUID syntax error', async () => {
      mockSupabaseInstance = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'invalid input syntax for type uuid: ""' },
        }),
      };

      await expect(
        invoicesService.createInvoice(
          orgId,
          {
            customerId,
            invoiceDate: '2026-10-31',
            dueDate: '2026-11-30',
            items: [
              {
                productId: '',
                productName: 'Empty UUID Product',
                productSku: 'EMPTY-01',
                uom: 'Nos',
                quantity: 1,
                unitPrice: 100,
              },
            ],
          },
          false
        )
      ).rejects.toThrow('Failed to create invoice: invalid input syntax for type uuid: ""');
    });

    it('(Mocked Unit Test) rejects invalid UUID string with UUID syntax error', async () => {
      mockSupabaseInstance = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'invalid input syntax for type uuid: "not-a-uuid"' },
        }),
      };

      await expect(
        invoicesService.createInvoice(
          orgId,
          {
            customerId,
            invoiceDate: '2026-10-31',
            dueDate: '2026-11-30',
            items: [
              {
                productId: 'not-a-uuid',
                productName: 'Bad UUID Product',
                productSku: 'BAD-01',
                uom: 'Nos',
                quantity: 1,
                unitPrice: 100,
              },
            ],
          },
          false
        )
      ).rejects.toThrow('Failed to create invoice: invalid input syntax for type uuid: "not-a-uuid"');
    });

    it('(Mocked Unit Test) rejects foreign-tenant product ID with organization mismatch error', async () => {
      const foreignProductId = '99999999-9999-9999-9999-999999999999';
      mockSupabaseInstance = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'One or more products not found or belong to another organization' },
        }),
      };

      await expect(
        invoicesService.createInvoice(
          orgId,
          {
            customerId,
            invoiceDate: '2026-10-31',
            dueDate: '2026-11-30',
            items: [
              {
                productId: foreignProductId,
                productName: 'Foreign Product',
                productSku: 'FOREIGN-01',
                uom: 'Nos',
                quantity: 1,
                unitPrice: 100,
              },
            ],
          },
          false
        )
      ).rejects.toThrow('Failed to create invoice: One or more products not found or belong to another organization');
    });

    it('(Mocked Unit Test) accepts valid duplicate product IDs across multiple invoice lines', async () => {
      const mockRpcDuplicateProductResponse = {
        id: 'inv-uuid-dup-prod',
        organization_id: orgId,
        invoice_number: 'ATL/26-27/0009',
        customer_id: customerId,
        sales_order_id: null,
        status: 'ISSUED',
        invoice_date: '2026-10-31',
        due_date: '2026-11-30',
        subtotal: 3000.0,
        discount_amount: 100.0,
        tax_amount: 522.0,
        total_amount: 3422.0,
        total_paid: 0,
        totals_version: 2,
        notes: null,
        created_at: '2026-10-31T12:00:00Z',
        updated_at: '2026-10-31T12:00:00Z',
        items: [
          {
            id: 'line-1',
            invoice_id: 'inv-uuid-dup-prod',
            product_id: productId1,
            product_name: 'Polycab 1.5 sq mm Wire (Batch A)',
            product_sku: 'CBL-FR-1.5',
            uom: 'Coils',
            quantity: 2,
            unit_price: 1000.0,
            discount_percent: 5.0,
            tax_rate: 18.0,
            line_subtotal: 1900.0,
            line_tax: 342.0,
            line_total: 2242.0,
            document_discount_share: 0,
          },
          {
            id: 'line-2',
            invoice_id: 'inv-uuid-dup-prod',
            product_id: productId1,
            product_name: 'Polycab 1.5 sq mm Wire (Batch B)',
            product_sku: 'CBL-FR-1.5',
            uom: 'Coils',
            quantity: 1,
            unit_price: 1000.0,
            discount_percent: 0.0,
            tax_rate: 18.0,
            line_subtotal: 1000.0,
            line_tax: 180.0,
            line_total: 1180.0,
            document_discount_share: 0,
          },
        ],
      };

      const mockRpc = vi.fn().mockResolvedValue({
        data: mockRpcDuplicateProductResponse,
        error: null,
      });

      mockSupabaseInstance = { rpc: mockRpc };

      const result = await invoicesService.createInvoice(
        orgId,
        {
          customerId,
          invoiceDate: '2026-10-31',
          dueDate: '2026-11-30',
          items: [
            {
              productId: productId1,
              productName: 'Polycab 1.5 sq mm Wire (Batch A)',
              productSku: 'CBL-FR-1.5',
              uom: 'Coils',
              quantity: 2,
              unitPrice: 1000.0,
              discountPercent: 5.0,
              taxRate: 18.0,
            },
            {
              productId: productId1,
              productName: 'Polycab 1.5 sq mm Wire (Batch B)',
              productSku: 'CBL-FR-1.5',
              uom: 'Coils',
              quantity: 1,
              unitPrice: 1000.0,
              discountPercent: 0.0,
              taxRate: 18.0,
            },
          ],
        },
        false
      );

      expect(mockRpc).toHaveBeenCalledTimes(1);
      const [, rpcParams] = mockRpc.mock.calls[0];
      expect(rpcParams.p_items).toHaveLength(2);
      expect(rpcParams.p_items[0].product_id).toBe(productId1);
      expect(rpcParams.p_items[1].product_id).toBe(productId1);
      expect(result.items).toHaveLength(2);
      expect(result.totalAmount).toBe(3422.0);
    });

    it('(Mocked Unit Test) confirms valid invoice creation remains unaffected', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          id: 'inv-uuid-valid',
          organization_id: orgId,
          invoice_number: 'ATL/26-27/0010',
          customer_id: customerId,
          sales_order_id: null,
          status: 'ISSUED',
          invoice_date: '2026-10-31',
          due_date: '2026-11-30',
          subtotal: 1000.0,
          discount_amount: 0,
          tax_amount: 180.0,
          total_amount: 1180.0,
          total_paid: 0,
          totals_version: 2,
          notes: null,
          created_at: '2026-10-31T12:00:00Z',
          updated_at: '2026-10-31T12:00:00Z',
          items: [
            {
              id: 'line-valid-1',
              invoice_id: 'inv-uuid-valid',
              product_id: productId1,
              product_name: 'Polycab 1.5 sq mm Wire',
              product_sku: 'CBL-FR-1.5',
              uom: 'Coils',
              quantity: 1,
              unit_price: 1000.0,
              discount_percent: 0,
              tax_rate: 18.0,
              line_subtotal: 1000.0,
              line_tax: 180.0,
              line_total: 1180.0,
              document_discount_share: 0,
            },
          ],
        },
        error: null,
      });

      mockSupabaseInstance = { rpc: mockRpc };

      const result = await invoicesService.createInvoice(
        orgId,
        {
          customerId,
          invoiceDate: '2026-10-31',
          dueDate: '2026-11-30',
          items: [
            {
              productId: productId1,
              productName: 'Polycab 1.5 sq mm Wire',
              productSku: 'CBL-FR-1.5',
              uom: 'Coils',
              quantity: 1,
              unitPrice: 1000.0,
              discountPercent: 0,
              taxRate: 18.0,
            },
          ],
        },
        false
      );

      expect(result.id).toBe('inv-uuid-valid');
      expect(result.items).toHaveLength(1);
      expect(result.totalAmount).toBe(1180.0);
    });
  });
});
