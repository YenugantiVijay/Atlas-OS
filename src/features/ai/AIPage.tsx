import React, { useState } from 'react';
import {
  Sparkles,
  Send,
  CheckCircle2,
  ShieldCheck,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { productsService } from '@/services/products.service';
import { customersService } from '@/services/customers.service';
import { ordersService } from '@/services/orders.service';
import { invoicesService } from '@/services/invoices.service';
import { dashboardService } from '@/services/dashboard.service';
import { auditService } from '@/services/audit.service';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency, calculateInvoiceBalance } from '@/lib/money';

interface ReplenishmentItem {
  productId: string;
  sku: string;
  name: string;
  qty: number;
  uom: string;
}

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  content: string;
  timestamp: string;
  proposedAction?: {
    type: 'REPLENISHMENT_PROPOSAL' | 'ADVISORY_SUGGESTION';
    title: string;
    description: string;
    payload: {
      items?: ReplenishmentItem[];
      [key: string]: unknown;
    };
    status: 'proposed' | 'executing' | 'executed' | 'acknowledged';
    resultSummary?: string;
  };
}

export const AIPage: React.FC = () => {
  const { currentOrg, isMockAuth } = useOrg();
  const { showToast } = useToast();

  const [inputPrompt, setInputPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'msg-1',
      sender: 'assistant',
      content:
        `Hello! I am ATLAS Operational Assistant for ${currentOrg?.name || 'your business'}. All my responses, summaries, and stock recommendations are computed deterministically from your active database records using verified business rules.\n\nHow can I assist your operations today?`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);

  const sampleQueries = [
    { label: "Summarize today's sales & orders", query: "Summarize today's orders and sales." },
    { label: 'Low-stock reorder suggestions', query: 'Which electrical SKUs are below their reorder threshold?' },
    { label: 'Customers with overdue receivables', query: 'Show customers with overdue receivables and balances.' },
    { label: 'Inventory valuation breakdown', query: 'What is our total inventory valuation and stock health?' },
  ];

  const handleSend = async (text: string) => {
    if (!text.trim() || !currentOrg) return;

    const userMsg: Message = {
      id: 'msg-' + Date.now(),
      sender: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputPrompt('');
    setIsLoading(true);

    try {
      const response = await processQueryGrounded(text, currentOrg.id);
      setMessages((prev) => [...prev, response]);
    } catch (err: any) {
      showToast('error', 'Query Failed', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Deterministic grounded assistant engine.
   * Queries real records from tenant services and computes verifiable business summaries.
   */
  const processQueryGrounded = async (query: string, orgId: string): Promise<Message> => {
    const q = query.toLowerCase();
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (q.includes('valuation') || q.includes('inventory value')) {
      const metrics = await dashboardService.getDashboardMetrics(orgId, isMockAuth);
      return {
        id: 'ai-' + Date.now(),
        sender: 'assistant',
        content: `**Inventory Valuation for ${currentOrg?.name}:**\n\n• **Total Stock Value at Purchase Cost:** ${formatCurrency(metrics.totalStockValue)}\n• **Active Products at or Below Reorder Threshold:** ${metrics.lowStockItemsCount}\n\nValuation is calculated from recorded stock quantities multiplied by product purchase costs.`,
        timestamp,
      };
    }

    if (q.includes('stock') || q.includes('reorder') || q.includes('threshold') || q.includes('replenish')) {
      const products = await productsService.getProducts(orgId, isMockAuth);
      const lowStock = products.filter((p) => p.isActive && (p.currentStock || 0) <= p.reorderThreshold);

      if (lowStock.length === 0) {
        return {
          id: 'ai-' + Date.now(),
          sender: 'assistant',
          content: `All ${products.length} electrical products in ${currentOrg?.name} are currently healthy and above their configured reorder thresholds. No urgent restocking is required at this time.`,
          timestamp,
        };
      }

      const replenishmentItems: ReplenishmentItem[] = lowStock.map((p) => ({
        productId: p.id,
        sku: p.sku,
        name: p.name,
        qty: Math.max(20, Math.ceil(p.reorderThreshold * 2)),
        uom: p.uom,
      }));

      const listStr = lowStock
        .map((p, idx) => {
          const item = replenishmentItems[idx];
          return `• **${p.name}** (SKU: \`${p.sku}\`): Current stock is **${p.currentStock || 0} ${p.uom}**, at or below threshold (${p.reorderThreshold} ${p.uom}). *Estimated batch restock recommendation: ~${item.qty} ${p.uom}* (heuristic estimate: 2× threshold).`;
        })
        .join('\n');

      return {
        id: 'ai-' + Date.now(),
        sender: 'assistant',
        content: `I analyzed your live stock movement ledger. You have **${lowStock.length} SKU(s)** requiring replenishment:\n\n${listStr}\n\nWould you like to generate and log an approved purchasing replenishment requisition proposal for these items? *(Note: Physical inventory on-hand will not change until goods are officially received via verified intake).*`,
        timestamp,
        proposedAction: {
          type: 'REPLENISHMENT_PROPOSAL',
          title: 'Generate Purchase Requisition Proposal',
          description: `Create an approved procurement requisition proposal for ${lowStock.length} SKU(s) to restore healthy threshold levels. Physical stock remains unchanged until goods receipt.`,
          payload: { items: replenishmentItems },
          status: 'proposed',
        },
      };
    }

    if (q.includes('receivable') || q.includes('overdue') || q.includes('customer') || q.includes('balance')) {
      const [invoices, customers] = await Promise.all([
        invoicesService.getInvoices(orgId, isMockAuth),
        customersService.getCustomers(orgId, isMockAuth),
      ]);

      const now = new Date();
      // True overdue: invoice due date is strictly in the past and unpaid balance remains
      const overdueInvoices = invoices.filter((inv) => {
        if (!inv.dueDate) return false;
        const balance = calculateInvoiceBalance(inv.totalAmount, inv.totalPaid);
        if (balance <= 0) return false;
        const due = new Date(inv.dueDate);
        return due < now && inv.status !== 'PAID' && inv.status !== 'CANCELLED';
      });

      if (overdueInvoices.length === 0) {
        const totalOpenBalance = invoices.reduce(
          (sum, inv) => sum + calculateInvoiceBalance(inv.totalAmount, inv.totalPaid),
          0
        );
        return {
          id: 'ai-' + Date.now(),
          sender: 'assistant',
          content: `All customer accounts are currently in good standing with zero overdue invoices against credit terms.\n\n• **Total Open Receivables (Within Terms):** ${formatCurrency(totalOpenBalance)}\n• **Overdue Invoices:** 0\n\nAll invoices are preserved with real-time payment allocation audit trails.`,
          timestamp,
        };
      }

      // Group overdue invoices by customer
      const customerMap = new Map<string, { customerName: string; overdueAmount: number; count: number; oldestDays: number }>();
      let totalOverdue = 0;

      for (const inv of overdueInvoices) {
        const custName =
          inv.customer?.name ||
          inv.customer?.companyName ||
          customers.find((c) => c.id === inv.customerId)?.name ||
          'Customer Account';
        const balance = calculateInvoiceBalance(inv.totalAmount, inv.totalPaid);
        const daysPastDue = Math.max(1, Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24)));
        totalOverdue += balance;

        const existing = customerMap.get(inv.customerId) || {
          customerName: custName,
          overdueAmount: 0,
          count: 0,
          oldestDays: 0,
        };
        existing.overdueAmount += balance;
        existing.count += 1;
        existing.oldestDays = Math.max(existing.oldestDays, daysPastDue);
        customerMap.set(inv.customerId, existing);
      }

      const listStr = Array.from(customerMap.values())
        .map(
          (c) =>
            `• **${c.customerName}**: Overdue **${formatCurrency(c.overdueAmount)}** across ${c.count} invoice(s) (Oldest is **${c.oldestDays} days overdue**).`
        )
        .join('\n');

      return {
        id: 'ai-' + Date.now(),
        sender: 'assistant',
        content: `I analyzed all recorded tax invoices and payment allocations. Total overdue receivables stand at **${formatCurrency(totalOverdue)}** across **${customerMap.size} customer account(s)**:\n\n${listStr}\n\nOverdue amounts are calculated based on actual invoice due dates net of reconciled payment allocations.`,
        timestamp,
      };
    }

    if (q.includes('order') || q.includes('sale') || q.includes('today')) {
      const metrics = await dashboardService.getDashboardMetrics(orgId, isMockAuth);
      return {
        id: 'ai-' + Date.now(),
        sender: 'assistant',
        content: `**Operational Sales Summary for ${currentOrg?.name}:**\n\n• **Today's Confirmed Sales:** ${formatCurrency(metrics.todaySales)}\n• **Total Logged Sales Orders:** ${metrics.ordersCount} orders\n• **Open Receivables Outstanding:** ${formatCurrency(metrics.totalReceivables)}\n• **Active Inventory Valuation:** ${formatCurrency(metrics.totalStockValue)}\n\nOrder confirmations verify available stock against active inventory balances before reservation.`,
        timestamp,
      };
    }

    // Default grounded overview
    const [products, orders, customers] = await Promise.all([
      productsService.getProducts(orgId, isMockAuth),
      ordersService.getSalesOrders(orgId, isMockAuth),
      customersService.getCustomers(orgId, isMockAuth),
    ]);

    return {
      id: 'ai-' + Date.now(),
      sender: 'assistant',
      content: `I have verified your active tenant records:\n\n• **Organization:** ${currentOrg?.name} (${currentOrg?.gstin || 'Registered'})\n• **Product Catalog:** ${products.length} SKUs\n• **Active Contractors & Customers:** ${customers.length} accounts\n• **Total Sales Orders:** ${orders.length} orders\n\nYou can ask me to evaluate stock thresholds, summarize receivables, or inspect sales performance.`,
      timestamp,
    };
  };

  const handleApproveAction = async (messageId: string, action: NonNullable<Message['proposedAction']>) => {
    if (!currentOrg) return;

    // Transition state: executing
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId && m.proposedAction
          ? { ...m, proposedAction: { ...m.proposedAction, status: 'executing' } }
          : m
      )
    );

    try {
      if (action.type === 'REPLENISHMENT_PROPOSAL' && action.payload?.items) {
        const items = action.payload.items as ReplenishmentItem[];

        // CRITICAL INVENTORY INTEGRITY GATE:
        // A replenishment recommendation must NOT increase available physical stock merely because
        // a user approves an AI suggestion! Stock increases only upon verified goods receipt (GRN).
        // Therefore, we record an approved purchasing requisition proposal in the audit ledger without
        // falsely mutating physical on-hand stock.
        await auditService.logEvent(
          currentOrg.id,
          'AI_REPLENISHMENT_PROPOSAL_APPROVED',
          'PURCHASING_PROPOSAL',
          currentOrg.id,
          {
            actionType: action.type,
            actionTitle: action.title,
            itemsCount: items.length,
            items: items.map((i) => ({ sku: i.sku, name: i.name, qty: i.qty, uom: i.uom })),
            note: 'Physical stock remains unchanged. Requisition proposal logged for procurement intake.',
          },
          isMockAuth
        );

        showToast(
          'success',
          'Requisition Proposal Approved',
          `Procurement requisition recorded for ${items.length} SKU(s). Physical stock will update only upon verified goods receipt.`
        );

        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId && m.proposedAction
              ? {
                  ...m,
                  proposedAction: {
                    ...m.proposedAction,
                    status: 'executed',
                    resultSummary: `Requisition proposal approved for ${items.length} SKU(s) and recorded in audit log. Physical inventory remains unchanged until goods are received.`,
                  },
                }
              : m
          )
        );
      } else {
        // Pure recommendation acknowledgment
        await auditService.logEvent(
          currentOrg.id,
          'AI_SUGGESTION_ACKNOWLEDGED',
          'SYSTEM',
          currentOrg.id,
          {
            actionType: action.type,
            actionTitle: action.title,
          },
          isMockAuth
        );

        showToast('info', 'Suggestion Acknowledged', `Acknowledged: ${action.title}`);

        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId && m.proposedAction
              ? {
                  ...m,
                  proposedAction: {
                    ...m.proposedAction,
                    status: 'acknowledged',
                    resultSummary: 'Recommendation acknowledged by operator.',
                  },
                }
              : m
          )
        );
      }
    } catch (err: any) {
      showToast('error', 'Execution Failed', err.message);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.proposedAction
            ? { ...m, proposedAction: { ...m.proposedAction, status: 'proposed' } }
            : m
        )
      );
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              ATLAS AI Assistant
            </h1>
            <Badge variant="teal" size="sm">
              Rule-Based Operational Assistant
            </Badge>
          </div>
          <p className="text-sm text-content-secondary mt-1">
            Operational intelligence deterministically computed from authorized tenant ledger records with explicit human authorization.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-medium text-content-secondary bg-surface-card px-3 py-1.5 rounded-xl border border-border shadow-2xs">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>Verified Ledger Rules</span>
        </div>
      </div>

      {/* Suggested Quick Queries */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {sampleQueries.map((item, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleSend(item.query)}
            className="flex items-center justify-between p-3 rounded-xl border border-border bg-surface-card hover:bg-atlas-50 hover:border-atlas-300 transition-all text-left shadow-2xs group focus:outline-none focus:ring-2 focus:ring-atlas-500/20"
          >
            <span className="text-xs font-medium text-content-primary group-hover:text-atlas-800">
              {item.label}
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-content-muted group-hover:text-atlas-600 shrink-0 ml-2" />
          </button>
        ))}
      </div>

      {/* Chat Window */}
      <Card className="flex flex-col h-[600px] p-0 overflow-hidden">
        {/* Messages list */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.map((msg) => {
            const isUser = msg.sender === 'user';
            const action = msg.proposedAction;

            return (
              <div
                key={msg.id}
                className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                {!isUser && (
                  <div className="w-8 h-8 rounded-xl bg-atlas-100 text-atlas-700 flex items-center justify-center shrink-0 border border-atlas-200 shadow-xs">
                    <Sparkles className="w-4 h-4" />
                  </div>
                )}

                <div className={`max-w-xl space-y-2`}>
                  <div
                    className={`rounded-2xl p-4 text-sm leading-relaxed ${
                      isUser
                        ? 'bg-atlas-600 text-white rounded-tr-xs'
                        : 'bg-surface-panel/40 border border-border text-content-primary rounded-tl-xs shadow-2xs'
                    }`}
                  >
                    <div className="whitespace-pre-line">{msg.content}</div>
                  </div>

                  {/* Proposed Action Card if present */}
                  {action && (
                    <div className="p-3.5 rounded-xl border border-atlas-200 bg-atlas-50/70 space-y-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 font-bold text-atlas-900">
                          <Sparkles className="w-4 h-4 text-atlas-600" />
                          <span>{action.title}</span>
                        </div>
                        {action.status === 'executed' && (
                          <Badge variant="success" size="sm" showDot>
                            Executed
                          </Badge>
                        )}
                        {action.status === 'acknowledged' && (
                          <Badge variant="default" size="sm">
                            Acknowledged
                          </Badge>
                        )}
                      </div>

                      <p className="text-xs text-atlas-800">{action.description}</p>

                      {action.resultSummary && (
                        <p className="text-xs font-semibold text-emerald-800 bg-emerald-50 p-2 rounded-lg border border-emerald-200">
                          ✓ {action.resultSummary}
                        </p>
                      )}

                      {action.status === 'proposed' && (
                        <div className="pt-1 flex items-center gap-2">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleApproveAction(msg.id, action)}
                            leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
                          >
                            {action.type === 'REPLENISHMENT_PROPOSAL'
                              ? 'Approve Requisition Proposal'
                              : 'Acknowledge Suggestion'}
                          </Button>
                        </div>
                      )}

                      {action.status === 'executing' && (
                        <div className="pt-1 flex items-center gap-2 text-atlas-700">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span className="font-medium">Recording approved procurement proposal...</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div
                    className={`text-xs text-content-muted px-1 ${
                      isUser ? 'text-right' : 'text-left'
                    }`}
                  >
                    {msg.timestamp}
                  </div>
                </div>

                {isUser && (
                  <div className="w-8 h-8 rounded-xl bg-surface-muted text-content-secondary flex items-center justify-center shrink-0 border border-border font-bold text-xs">
                    VK
                  </div>
                )}
              </div>
            );
          })}

          {isLoading && (
            <div className="flex gap-3 justify-start items-center text-xs text-content-muted">
              <div className="w-8 h-8 rounded-xl bg-atlas-100 text-atlas-600 flex items-center justify-center shrink-0 animate-pulse">
                <Sparkles className="w-4 h-4" />
              </div>
              <span>Querying authorized distributor ledger & analyzing stock rules...</span>
            </div>
          )}
        </div>

        {/* Prompt Input Box */}
        <div className="p-3.5 border-t border-border bg-slate-50/70">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend(inputPrompt);
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              placeholder="Ask ATLAS AI about your SKUs, pending orders, or receivables..."
              className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-content-primary placeholder-content-muted focus:outline-none focus:ring-2 focus:ring-atlas-500/20 focus:border-atlas-500 shadow-2xs"
            />
            <Button
              type="submit"
              variant="primary"
              disabled={!inputPrompt.trim() || isLoading}
              leftIcon={<Send className="w-4 h-4" />}
            >
              Send
            </Button>
          </form>
          <div className="flex items-center justify-between text-xs text-content-muted mt-2 px-1">
            <span>ATLAS AI respects role permissions and cannot modify accounts without explicit approval.</span>
            <span className="font-medium text-slate-500">Deterministic Model Engine</span>
          </div>
        </div>
      </Card>
    </div>
  );
};
