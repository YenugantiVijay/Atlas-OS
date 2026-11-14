/**
 * ATLAS OS — Evidence-Grounded AI Operational Assistant Service
 *
 * Enforces:
 * 1. Multi-tenant isolation: queries strictly scoped to the active organization.
 * 2. Evidence citations: attaches direct record references & deep-links to underlying documents.
 * 3. Step-by-step calculation transparency: explains how totals/averages/valuations are derived.
 * 4. Refusal to fabricate missing data: gracefully declines queries referencing nonexistent records or out-of-scope topics.
 * 5. Role-based permission gates & explicit confirmation before consequential writes.
 */

import { storage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { Role, Product, Invoice, SalesOrder, Customer } from '@/types';
import { formatCurrency, calculateInvoiceBalance } from '@/lib/money';
import { isInvoiceOverdue } from '@/lib/dates';
import { hasPermission } from '@/lib/permissions';
import { mapDbCustomer } from './customers.service';
import { mapDbInvoice } from './invoices.service';
import { mapDbSalesOrder } from './orders.service';
import { mapDbProduct } from './products.service';

export interface CitationRecord {
  type: 'invoice' | 'order' | 'product' | 'customer';
  id: string;
  label: string;
  url: string;
  detail?: string;
}

export interface CalculationStep {
  label: string;
  formula: string;
  value: string;
  explanation: string;
}

export interface ConsequentialWriteProposal {
  proposalId: string;
  type: 'REPLENISHMENT_PROPOSAL';
  title: string;
  impactSummary: string;
  roleRequired: Role[];
  payload: {
    items: Array<{
      productId: string;
      sku: string;
      name: string;
      qty: number;
      uom: string;
    }>;
  };
}

export interface GroundedAIResponse {
  answer: string;
  citations: CitationRecord[];
  calculations?: CalculationStep[];
  proposedWrite?: ConsequentialWriteProposal;
  confidence: 'GROUNDED' | 'REFUSED_UNSUPPORTED';
  refusalReason?: string;
}

export const aiAssistantService = {
  /**
   * Processes a natural language query with deterministic evidence grounding and permission verification.
   */
  async processQuery(
    orgId: string,
    userRole: Role,
    queryText: string,
    isMockAuth: boolean = false
  ): Promise<GroundedAIResponse> {
    if (!orgId) {
      throw new Error('Active organization ID is required for tenant grounding.');
    }

    const q = queryText.toLowerCase().trim();

    // 1. Refusal Check: Questions outside ERP operational domain or unsupported external queries
    const unsupportedKeywords = ['weather', 'crypto', 'bitcoin', 'stock market', 'election', 'movie', 'joke', 'recipe'];
    if (unsupportedKeywords.some((k) => q.includes(k))) {
      return {
        answer: 'I am grounded strictly in your active Atlas OS operations. I cannot answer queries about external topics or data outside your authorized organization.',
        citations: [],
        confidence: 'REFUSED_UNSUPPORTED',
        refusalReason: 'EXTERNAL_TOPIC_NOT_SUPPORTED',
      };
    }

    // 2. Financial Receivables & Overdue Invoices
    if (q.includes('receivable') || q.includes('overdue') || q.includes('unpaid') || q.includes('debtor')) {
      if (!hasPermission(userRole, 'reports:financial')) {
        return {
          answer: 'Access Restricted: Your current role does not have "reports:financial" permission to view customer balances or overdue receivables.',
          citations: [],
          confidence: 'REFUSED_UNSUPPORTED',
          refusalReason: 'PERMISSION_DENIED',
        };
      }

      let invoices: Invoice[] = [];
      let customers: Customer[] = [];

      if (isMockAuth) {
        invoices = storage.getInvoices(orgId);
        customers = storage.getCustomers(orgId);
      } else {
        if (!supabase) throw new Error('Cloud backend is not configured.');
        const [invRes, custRes] = await Promise.all([
          supabase.from('invoices').select('*').eq('organization_id', orgId),
          supabase.from('customers').select('*').eq('organization_id', orgId),
        ]);
        if (invRes.error) throw new Error(`Failed to load invoices: ${invRes.error.message}`);
        if (custRes.error) throw new Error(`Failed to load customers: ${custRes.error.message}`);
        invoices = (invRes.data || []).map((row) => mapDbInvoice(row));
        customers = (custRes.data || []).map(mapDbCustomer);
      }

      const overdueInvoices = invoices.filter((inv) => {
        const bal = calculateInvoiceBalance(inv.totalAmount, inv.totalPaid);
        return isInvoiceOverdue(inv.dueDate) && bal > 0 && inv.status !== 'PAID' && inv.status !== 'CANCELLED';
      });

      const citations: CitationRecord[] = overdueInvoices.map((inv) => ({
        type: 'invoice',
        id: inv.id,
        label: `Invoice ${inv.invoiceNumber}`,
        url: `/invoices?search=${encodeURIComponent(inv.invoiceNumber)}`,
        detail: `Overdue by ${calculateInvoiceBalance(inv.totalAmount, inv.totalPaid)} (Due ${inv.dueDate})`,
      }));

      const totalOverdue = overdueInvoices.reduce(
        (sum, inv) => sum + calculateInvoiceBalance(inv.totalAmount, inv.totalPaid),
        0
      );

      const calculations: CalculationStep[] = [
        {
          label: 'Total Overdue Receivables',
          formula: 'SUM(invoice.total_amount - invoice.total_paid) WHERE due_date < TODAY AND status != PAID',
          value: formatCurrency(totalOverdue),
          explanation: `Calculated from ${overdueInvoices.length} overdue invoices in organization ledger.`,
        },
      ];

      if (overdueInvoices.length === 0) {
        return {
          answer: 'All customer tax invoices are within agreed credit terms. There are currently zero overdue receivables recorded.',
          citations: [],
          calculations,
          confidence: 'GROUNDED',
        };
      }

      const customerNames = new Set(
        overdueInvoices.map((inv) => customers.find((c) => c.id === inv.customerId)?.name || 'Contractor')
      );

      return {
        answer: `Identified ${overdueInvoices.length} overdue invoice(s) totaling ${formatCurrency(totalOverdue)} across ${customerNames.size} customer account(s). All figures are computed net of recorded payment receipts.`,
        citations,
        calculations,
        confidence: 'GROUNDED',
      };
    }

    // 3. Stock Level & Low-Stock Replenishment
    if (q.includes('stock') || q.includes('reorder') || q.includes('inventory') || q.includes('replenish')) {
      let products: Product[] = [];
      if (isMockAuth) {
        products = storage.getProducts(orgId);
      } else {
        if (!supabase) throw new Error('Cloud backend is not configured.');
        const res = await supabase.from('products').select('*').eq('organization_id', orgId);
        if (res.error) throw new Error(`Failed to load products: ${res.error.message}`);
        products = (res.data || []).map((row) => mapDbProduct(row, Number(row.current_stock ?? 0)));
      }

      const lowStock = products.filter((p) => p.isActive && (p.currentStock ?? 0) <= p.reorderThreshold);
      const activeProducts = products.filter((p) => p.isActive);

      const citations: CitationRecord[] = lowStock.map((p) => ({
        type: 'product',
        id: p.id,
        label: `${p.name} (${p.sku})`,
        url: `/products?search=${encodeURIComponent(p.sku)}`,
        detail: `Current: ${p.currentStock ?? 0} ${p.uom} (Threshold: ${p.reorderThreshold} ${p.uom})`,
      }));

      const totalValue = activeProducts.reduce((sum, p) => sum + (p.currentStock ?? 0) * (p.purchaseCost || 0), 0);

      const calculations: CalculationStep[] = [
        {
          label: 'Total Inventory Valuation',
          formula: 'SUM(product.current_stock * product.purchase_cost) WHERE is_active = true',
          value: formatCurrency(totalValue),
          explanation: `Computed across ${activeProducts.length} active catalog SKUs.`,
        },
      ];

      if (lowStock.length === 0) {
        return {
          answer: `All ${activeProducts.length} active electrical SKUs are healthy with stock above configured reorder thresholds. Total catalog inventory valuation is ${formatCurrency(totalValue)}.`,
          citations: [],
          calculations,
          confidence: 'GROUNDED',
        };
      }

      const writeProposal: ConsequentialWriteProposal = {
        proposalId: `prop_${Date.now()}`,
        type: 'REPLENISHMENT_PROPOSAL',
        title: 'Replenishment Suggestion',
        impactSummary: `Suggests replenishment quantities for ${lowStock.length} low-stock SKU(s). Confirming this suggestion only records an audit event; it does not create a purchase requisition or change stock.`,
        roleRequired: ['owner', 'admin', 'inventory'],
        payload: {
          items: lowStock.map((p) => ({
            productId: p.id,
            sku: p.sku,
            name: p.name,
            qty: Math.max(20, Math.ceil(p.reorderThreshold * 2)),
            uom: p.uom,
          })),
        },
      };

      return {
        answer: `There are ${lowStock.length} active electrical SKU(s) at or below their reorder threshold. Total inventory valuation at cost is ${formatCurrency(totalValue)}. A replenishment suggestion is prepared below for review.`,
        citations,
        calculations,
        proposedWrite: writeProposal,
        confidence: 'GROUNDED',
      };
    }

    // 4. Sales Orders & Quotes Inquiry
    if (q.includes('order') || q.includes('sale') || q.includes('quote')) {
      let orders: SalesOrder[] = [];
      if (isMockAuth) {
        orders = storage.getSalesOrders(orgId);
      } else {
        if (!supabase) throw new Error('Cloud backend is not configured.');
        const res = await supabase.from('sales_orders').select('*').eq('organization_id', orgId);
        if (res.error) throw new Error(`Failed to load sales orders: ${res.error.message}`);
        orders = (res.data || []).map((row) => mapDbSalesOrder(row));
      }

      const activeOrders = orders.filter((o) => o.status !== 'CANCELLED');
      const totalOrderValue = activeOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);

      const citations: CitationRecord[] = activeOrders.slice(0, 5).map((o) => ({
        type: 'order',
        id: o.id,
        label: `Sales Order ${o.orderNumber || o.id.substring(0, 8)}`,
        url: `/orders?search=${encodeURIComponent(o.orderNumber || o.id)}`,
        detail: `Status: ${o.status} • Total: ${formatCurrency(o.totalAmount)}`,
      }));

      const calculations: CalculationStep[] = [
        {
          label: 'Total Active Sales Order Volume',
          formula: 'SUM(sales_orders.total_amount) WHERE status != CANCELLED',
          value: formatCurrency(totalOrderValue),
          explanation: `Aggregated across ${activeOrders.length} confirmed and fulfilled sales orders.`,
        },
      ];

      return {
        answer: `Found ${orders.length} total orders (${activeOrders.length} active). Total gross sales order booking volume is ${formatCurrency(totalOrderValue)}.`,
        citations,
        calculations,
        confidence: 'GROUNDED',
      };
    }

    // 5. Missing or Specific Unrecognized Record Lookup
    return {
      answer: `I could not find records matching your request in organization "${orgId}". To protect operational accuracy, I will not fabricate answers. Try asking about stock levels, overdue receivables, or recent sales orders.`,
      citations: [],
      confidence: 'REFUSED_UNSUPPORTED',
      refusalReason: 'NO_MATCHING_RECORDS_FOUND',
    };
  },

  /**
   * Confirms and executes an approved consequential write with strict role checks and audit logging.
   */
  async confirmConsequentialWrite(
    orgId: string,
    userRole: Role,
    proposal: ConsequentialWriteProposal,
    isMockAuth: boolean = false
  ): Promise<{ success: boolean; message: string }> {
    if (!proposal.roleRequired.includes(userRole)) {
      throw new Error(
        `Role "${userRole}" is not permitted to confirm this action. Required roles: ${proposal.roleRequired.join(', ')}.`
      );
    }

    if (isMockAuth) {
      storage.logAuditEvent(
        orgId,
        'AI_CONSEQUENTIAL_WRITE_CONFIRMED',
        'PURCHASING_PROPOSAL',
        proposal.proposalId,
        {
          title: proposal.title,
          itemsCount: proposal.payload.items.length,
          items: proposal.payload.items,
          confirmedByRole: userRole,
          safetyNote: 'Physical stock remains unchanged. Requisition proposal recorded in ledger for goods receipt.',
        }
      );
    } else {
      if (!supabase) throw new Error('Cloud backend is not configured.');
      const { error } = await supabase.from('audit_logs').insert({
        organization_id: orgId,
        action: 'AI_CONSEQUENTIAL_WRITE_CONFIRMED',
        entity_type: 'PURCHASING_PROPOSAL',
        entity_id: proposal.proposalId,
        details: {
          title: proposal.title,
          itemsCount: proposal.payload.items.length,
          confirmedByRole: userRole,
        },
      });
      if (error) throw new Error(`Failed to record replenishment suggestion: ${error.message}`);
    }

    return {
      success: true,
      message: `Suggestion "${proposal.title}" for ${proposal.payload.items.length} SKU(s) was confirmed and logged. No purchase requisition was created.`,
    };
  },
};
