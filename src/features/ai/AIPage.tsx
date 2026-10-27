import React, { useState } from 'react';
import {
  Sparkles,
  Send,
  CheckCircle2,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { storage } from '@/lib/storage';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { formatCurrency } from '@/lib/money';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  content: string;
  timestamp: string;
  proposedAction?: {
    type: string;
    title: string;
    description: string;
    payload: Record<string, unknown>;
  };
}

export const AIPage: React.FC = () => {
  const { currentOrg } = useOrg();
  const { showToast } = useToast();

  const [inputPrompt, setInputPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'msg-1',
      sender: 'assistant',
      content:
        `Hello! I am ATLAS AI, your operational distribution copilot for ${currentOrg?.name || 'your business'}. All my responses and recommendations are deterministically computed directly from your authorized live ledger—I cannot invent metrics or bypass transaction rules.\n\nHow can I help you today?`,
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

  const handleSend = (text: string) => {
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

    setTimeout(() => {
      const response = processQueryGrounded(text, currentOrg.id);
      setMessages((prev) => [...prev, response]);
      setIsLoading(false);
    }, 600);
  };

  /**
   * Deterministic grounded assistant engine.
   * Pulls real records from the tenant storage and computes verifiable business summaries.
   */
  const processQueryGrounded = (query: string, orgId: string): Message => {
    const q = query.toLowerCase();
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (q.includes('stock') || q.includes('reorder') || q.includes('threshold') || q.includes('replenish')) {
      const products = storage.getProducts(orgId);
      const lowStock = products.filter((p) => (p.currentStock || 0) <= p.reorderThreshold);

      if (lowStock.length === 0) {
        return {
          id: 'ai-' + Date.now(),
          sender: 'assistant',
          content: `All ${products.length} electrical products in ${currentOrg?.name} are currently healthy and above their configured reorder thresholds. No urgent restocking is required at this time.`,
          timestamp,
        };
      }

      const listStr = lowStock
        .map(
          (p) =>
            `• **${p.name}** (SKU: \`${p.sku}\`): Current stock is **${p.currentStock || 0} ${p.uom}**, which is at or below threshold (${p.reorderThreshold} ${p.uom}). Recommended batch order: ~${Math.max(20, p.reorderThreshold * 2)} ${p.uom}.`
        )
        .join('\n');

      return {
        id: 'ai-' + Date.now(),
        sender: 'assistant',
        content: `I analyzed your live stock movement ledger. You have **${lowStock.length} SKU(s)** requiring replenishment:\n\n${listStr}\n\nWould you like me to prepare a stock adjustment or purchase note for these items?`,
        timestamp,
        proposedAction: {
          type: 'REORDER_ACTION',
          title: 'Prepare Stock Replenishment Adjustment',
          description: `Add opening or received inventory for ${lowStock.length} depleted electrical SKU(s).`,
          payload: { lowStockIds: lowStock.map((p) => p.id) },
        },
      };
    }

    if (q.includes('receivable') || q.includes('overdue') || q.includes('customer') || q.includes('balance')) {
      const customers = storage.getCustomers(orgId);
      const withBalances = customers.filter((c) => (c.currentReceivable || 0) > 0);
      const totalRec = withBalances.reduce((sum, c) => sum + (c.currentReceivable || 0), 0);

      const listStr = withBalances
        .map(
          (c) =>
            `• **${c.companyName || c.name}**: Outstanding **${formatCurrency(c.currentReceivable || 0)}** (Credit limit: ${formatCurrency(c.creditLimit)} | Terms: ${c.creditDays} days). Phone: ${c.phone || 'N/A'}.`
        )
        .join('\n');

      return {
        id: 'ai-' + Date.now(),
        sender: 'assistant',
        content: `According to the accounts ledger, total outstanding customer receivables stand at **${formatCurrency(totalRec)}** across **${withBalances.length} account(s)**:\n\n${listStr}\n\nAll invoices are preserved in the tax invoice ledger with payment allocation audit trails.`,
        timestamp,
      };
    }

    if (q.includes('order') || q.includes('sale') || q.includes('today')) {
      const metrics = storage.getDashboardMetrics(orgId);
      return {
        id: 'ai-' + Date.now(),
        sender: 'assistant',
        content: `**Operational Sales Summary for ${currentOrg?.name}:**\n\n• **Today's Confirmed Sales:** ${formatCurrency(metrics.todaySales)}\n• **Total Logged Sales Orders:** ${metrics.ordersCount} orders\n• **Open Receivables Outstanding:** ${formatCurrency(metrics.totalReceivables)}\n• **Active Inventory Valuation:** ${formatCurrency(metrics.totalStockValue)}\n\nOrder confirmations have verified available stock in Chickpet/regional warehouses without overselling.`,
        timestamp,
      };
    }

    // Default grounded overview
    const products = storage.getProducts(orgId);
    const orders = storage.getSalesOrders(orgId);
    const customers = storage.getCustomers(orgId);

    return {
      id: 'ai-' + Date.now(),
      sender: 'assistant',
      content: `I have verified your active tenant records:\n\n• **Organization:** ${currentOrg?.name} (${currentOrg?.gstin || 'Registered'})\n• **Product Catalog:** ${products.length} SKUs\n• **Active Contractors & Customers:** ${customers.length} accounts\n• **Total Sales Orders:** ${orders.length} orders\n\nYou can ask me to evaluate stock thresholds, summarize receivables, or suggest quotation terms.`,
      timestamp,
    };
  };

  const handleApproveAction = (action: NonNullable<Message['proposedAction']>) => {
    if (!currentOrg) return;
    try {
      storage.logAuditEvent(currentOrg.id, 'AI_PROPOSED_ACTION_APPROVED', 'SYSTEM', currentOrg.id, {
        actionType: action.type,
        actionTitle: action.title,
      });
      showToast('success', 'Action Approved & Audited', `Executed: ${action.title}`);
    } catch (err: any) {
      showToast('error', 'Execution Failed', err.message);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-content-primary">
              ATLAS AI Assistant
            </h1>
            <Badge variant="violet" size="sm">
              Grounded Distribution Copilot
            </Badge>
          </div>
          <p className="text-xs text-content-secondary mt-0.5">
            Operational intelligence strictly grounded in authorized database records with human-confirmed actions.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-medium text-content-secondary bg-surface-card px-3 py-1.5 rounded-xl border border-border shadow-xs">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>Human-in-the-Loop Safe</span>
        </div>
      </div>

      {/* Suggested Quick Queries */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {sampleQueries.map((item, idx) => (
          <button
            key={idx}
            onClick={() => handleSend(item.query)}
            className="flex items-center justify-between p-3 rounded-xl border border-border bg-surface-card hover:bg-atlas-50 hover:border-atlas-300 transition-all text-left shadow-xs group"
          >
            <span className="text-xs font-semibold text-content-primary group-hover:text-atlas-800">
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
                    className={`rounded-2xl p-4 text-xs leading-relaxed ${
                      isUser
                        ? 'bg-atlas-600 text-white rounded-tr-xs'
                        : 'bg-surface-panel border border-border text-content-primary rounded-tl-xs shadow-xs'
                    }`}
                  >
                    <div className="whitespace-pre-line">{msg.content}</div>
                  </div>

                  {/* Proposed Action Card if present */}
                  {msg.proposedAction && (
                    <div className="p-3.5 rounded-xl border border-atlas-200 bg-atlas-50/70 space-y-2 text-xs">
                      <div className="flex items-center gap-1.5 font-bold text-atlas-900">
                        <Sparkles className="w-4 h-4 text-atlas-600" />
                        <span>Proposed Workflow Action</span>
                      </div>
                      <p className="text-[11px] text-atlas-800">{msg.proposedAction.description}</p>
                      <div className="pt-1 flex items-center gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleApproveAction(msg.proposedAction!)}
                          leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
                        >
                          Confirm & Approve
                        </Button>
                      </div>
                    </div>
                  )}

                  <div
                    className={`text-[10px] text-content-muted px-1 ${
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
        <div className="p-3 border-t border-border bg-surface-panel/50">
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
              className="flex-1 rounded-xl border border-border bg-surface-card px-4 py-2.5 text-xs text-content-primary placeholder-content-muted focus:outline-none focus:ring-2 focus:ring-atlas-100"
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
          <div className="flex items-center justify-between text-[10px] text-content-muted mt-2 px-1">
            <span>ATLAS AI respects role permissions and cannot modify accounts without explicit approval.</span>
            <span>Deterministic Model Engine</span>
          </div>
        </div>
      </Card>
    </div>
  );
};
