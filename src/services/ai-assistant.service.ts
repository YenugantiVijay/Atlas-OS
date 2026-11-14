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
import { Role, SalesOrder } from '@/types';
import { formatCurrency, fromPaise, toPaise } from '@/lib/money';
import { hasPermission } from '@/lib/permissions';
import { mapDbSalesOrder } from './orders.service';
import { reconciliationService } from './reconciliation.service';

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

      const snapshot = await reconciliationService.reconcileFinancials(orgId, isMockAuth);
      if (snapshot.discrepancyCount > 0 || snapshot.receiptIssueCount > 0) {
        return {
          answer: 'Review the financial discrepancies in the dashboard before relying on receivables totals.',
          citations: [],
          confidence: 'REFUSED_UNSUPPORTED',
          refusalReason: 'FINANCIAL_DISCREPANCIES',
        };
      }

      return {
        answer: snapshot.overdueCount === 0
          ? 'There are zero overdue receivables recorded.'
          : `Identified ${snapshot.overdueCount} overdue invoice(s) totaling ${formatCurrency(snapshot.overdueTotal)}.`,
        citations: snapshot.overdue.map((invoice) => ({
          type: 'invoice',
          id: invoice.id,
          label: `Invoice ${invoice.invoiceNumber}`,
          url: `/invoices?search=${encodeURIComponent(invoice.invoiceNumber)}`,
          detail: `${formatCurrency(invoice.outstanding)} outstanding (due ${invoice.dueDate})`,
        })),
        calculations: [{
          label: 'Total Overdue Receivables',
          formula: 'SUM(outstanding from applicable payment allocations) for overdue issued and partially paid invoices',
          value: formatCurrency(snapshot.overdueTotal),
          explanation: `Calculated from all ${snapshot.overdueCount} overdue invoices. Showing ${snapshot.overdue.length} references.`,
        }],
        confidence: 'GROUNDED',
      };
    }

    if (q.includes('stock') || q.includes('reorder') || q.includes('inventory') || q.includes('replenish')) {
      const snapshot = await reconciliationService.getStockLedgerSummary(orgId, isMockAuth);
      const canSeeCosts = hasPermission(userRole, 'supplier-prices:read');
      const value = canSeeCosts ? snapshot.catalogCostValue : null;
      const valuation = value === null ? '' : ` Inventory at catalog cost is ${formatCurrency(value)}.`;
      const stockAnswer = snapshot.activeProductCount === 0
        ? 'No active products are recorded.'
        : `${snapshot.lowStockCount} of ${snapshot.activeProductCount} active SKUs are at or below their reorder threshold.`;
      const proposalRoles: Role[] = ['owner', 'admin', 'inventory'];
      const proposedWrite: ConsequentialWriteProposal | undefined =
        snapshot.lowStock.length > 0 && proposalRoles.includes(userRole) ? {
          proposalId: `prop_${Date.now()}`,
          type: 'REPLENISHMENT_PROPOSAL',
          title: 'Replenishment Suggestion',
          impactSummary: `Suggests replenishment for ${snapshot.lowStock.length} of ${snapshot.lowStockCount} low-stock SKU(s). Confirmation records an audit event only.`,
          roleRequired: proposalRoles,
          payload: {
            items: snapshot.lowStock.map((p) => ({
              productId: p.id, sku: p.sku, name: p.name, uom: p.uom,
              qty: Math.max(20, Math.ceil(p.reorderThreshold * 2)),
            })),
          },
        } : undefined;

      return {
        answer: stockAnswer + valuation,
        citations: snapshot.lowStock.map((p) => ({
          type: 'product',
          id: p.id,
          label: `${p.name} (${p.sku})`,
          url: `/products?search=${encodeURIComponent(p.sku)}`,
          detail: `Current: ${p.quantity} ${p.uom} (Threshold: ${p.reorderThreshold})`,
        })),
        calculations: value === null ? undefined : [{
          label: 'Inventory at Catalog Cost',
          formula: 'SUM(MAX(ledger_quantity, 0) × catalog_purchase_cost)',
          value: formatCurrency(value),
          explanation: `Current positive ledger quantities at catalog cost. Showing ${snapshot.lowStock.length} of ${snapshot.lowStockCount} low-stock references.`,
        }],
        proposedWrite,
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
        const res = await supabase.from('sales_orders').select('*', { count: 'exact' }).eq('organization_id', orgId);
        if (res.error) throw new Error(`Failed to load sales orders: ${res.error.message}`);
        if (!Array.isArray(res.data) || res.count !== res.data.length) {
          throw new Error('A complete sales order summary is unavailable.');
        }
        orders = res.data.map((row) => mapDbSalesOrder(row));
      }

      const activeOrders = orders.filter((o) => o.status !== 'CANCELLED');
      const totalOrderValue = fromPaise(activeOrders.reduce((sum, o) => sum + toPaise(o.totalAmount), 0));

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
          explanation: `Aggregated across ${activeOrders.length} non-cancelled sales orders.`,
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
