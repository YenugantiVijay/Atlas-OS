import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  Send,
  CheckCircle2,
  ShieldCheck,
  ArrowRight,
  Loader2,
  ExternalLink,
  Calculator,
  AlertTriangle,
  Package,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { hasPermission } from '@/lib/permissions';
import {
  aiAssistantService,
  CitationRecord,
  CalculationStep,
  ConsequentialWriteProposal,
} from '@/services/ai-assistant.service';

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  content: string;
  timestamp: string;
  citations?: CitationRecord[];
  calculations?: CalculationStep[];
  proposedWrite?: ConsequentialWriteProposal;
  writeConfirmed?: boolean;
}

export const AIPage: React.FC = () => {
  const { currentOrg, currentRole, isMockAuth } = useOrg();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const canReadFinancialLedgers = hasPermission(currentRole, 'reports:financial');

  const [inputPrompt, setInputPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'msg-1',
      sender: 'assistant',
      content: `Hello! I am the ATLAS Grounded Operational Assistant for ${currentOrg?.name || 'your business'}. All my responses, summaries, and stock recommendations are computed deterministically from your active database records with zero hallucination. Citations and calculations are attached to every figure.\n\nHow can I assist your operations today?`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [confirmingProposal, setConfirmingProposal] = useState<{
    messageId: string;
    proposal: ConsequentialWriteProposal;
  } | null>(null);
  const [isExecutingWrite, setIsExecutingWrite] = useState(false);

  // Cross-tenant protection: Reset conversation state immediately whenever active tenant changes
  useEffect(() => {
    setMessages([
      {
        id: 'msg-' + Date.now(),
        sender: 'assistant',
        content: `Hello! I am the ATLAS Grounded Operational Assistant for ${currentOrg?.name || 'your business'}. All my responses, summaries, and stock recommendations are computed deterministically from your active database records with zero hallucination. Citations and calculations are attached to every figure.\n\nHow can I assist your operations today?`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  }, [currentOrg?.id, currentOrg?.name]);

  const sampleQueries = [
    { label: "Summarize active orders and sales", query: "Summarize recent sales orders and bookings volume." },
    { label: 'Low-stock reorder suggestions', query: 'Which electrical SKUs are below their reorder threshold?' },
    ...(canReadFinancialLedgers
      ? [{ label: 'Customers with overdue receivables', query: 'Show customers with overdue receivables and unpaid invoices.' }]
      : []),
    { label: 'Inventory valuation breakdown', query: 'What is our total inventory valuation at purchase cost?' },
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
      const activeRole = currentRole || 'viewer';
      const response = await aiAssistantService.processQuery(currentOrg.id, activeRole, text, isMockAuth);
      const assistantMsg: Message = {
        id: 'ai-' + Date.now(),
        sender: 'assistant',
        content: response.answer,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        citations: response.citations,
        calculations: response.calculations,
        proposedWrite: response.proposedWrite,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      showToast('error', 'Query Failed', err.message || 'Error processing grounded query');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExecuteWriteConfirmation = async () => {
    if (!confirmingProposal || !currentOrg || isExecutingWrite) return;
    setIsExecutingWrite(true);
    try {
      const { messageId, proposal } = confirmingProposal;
      const activeRole = currentRole || 'viewer';
      const res = await aiAssistantService.confirmConsequentialWrite(
        currentOrg.id,
        activeRole,
        proposal,
        isMockAuth
      );

      showToast('success', 'Suggestion Logged', res.message);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, writeConfirmed: true } : m
        )
      );
      setConfirmingProposal(null);
    } catch (err: any) {
      showToast('error', 'Confirmation Blocked', err.message || 'Permission denied or execution error');
    } finally {
      setIsExecutingWrite(false);
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
              Evidence-Grounded Operational AI
            </Badge>
          </div>
          <p className="text-sm text-content-secondary mt-1">
            Deterministic operations intelligence with live evidence citations, transparent calculation formulas, and human confirmation gates.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-medium text-content-secondary bg-surface-card px-3 py-1.5 rounded-xl border border-border shadow-2xs">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>Zero Hallucination • Tenant Isolated</span>
        </div>
      </div>

      {/* Suggested Quick Queries */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {sampleQueries.map((item, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleSend(item.query)}
            className="flex items-center justify-between p-3 rounded-xl border border-border bg-surface-card hover:bg-slate-50 hover:border-teal-300 transition-all text-left shadow-2xs group focus:outline-none focus:ring-2 focus:ring-teal-500/20"
          >
            <span className="text-xs font-medium text-content-primary group-hover:text-teal-800">
              {item.label}
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-content-muted group-hover:text-teal-600 shrink-0 ml-2" />
          </button>
        ))}
      </div>

      {/* Chat Window */}
      <Card className="flex flex-col h-[600px] p-0 overflow-hidden">
        {/* Messages list */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {messages.map((msg) => {
            const isUser = msg.sender === 'user';
            const proposal = msg.proposedWrite;

            return (
              <div
                key={msg.id}
                className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                {!isUser && (
                  <div className="w-8 h-8 rounded-xl bg-teal-100 text-teal-800 flex items-center justify-center shrink-0 border border-teal-200 shadow-xs">
                    <Sparkles className="w-4 h-4" />
                  </div>
                )}

                <div className="max-w-xl space-y-2">
                  <div
                    className={`rounded-2xl p-4 text-sm leading-relaxed ${
                      isUser
                        ? 'bg-teal-700 text-white rounded-tr-xs'
                        : 'bg-white border border-slate-200 text-content-primary rounded-tl-xs shadow-xs'
                    }`}
                  >
                    <div className="whitespace-pre-line">{msg.content}</div>

                    {/* Step-by-Step Calculation Transparency */}
                    {msg.calculations && msg.calculations.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                          <Calculator className="w-3.5 h-3.5 text-teal-600" />
                          Calculation Breakdown
                        </div>
                        {msg.calculations.map((calc, cIdx) => (
                          <div key={cIdx} className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs">
                            <div className="font-semibold text-navy-800 flex justify-between">
                              <span>{calc.label}</span>
                              <span className="font-mono text-teal-800">{calc.value}</span>
                            </div>
                            <div className="text-[11px] font-mono text-slate-600 mt-0.5">
                              {calc.formula}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-1">{calc.explanation}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Evidence Citations Badges / Links */}
                    {msg.citations && msg.citations.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                          Evidence Citations ({msg.citations.length} verified records):
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {msg.citations.map((cite) => (
                            <button
                              key={cite.id}
                              type="button"
                              onClick={() => navigate(cite.url)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-teal-50 hover:bg-teal-100 border border-teal-200 text-teal-900 text-[11px] font-medium transition-colors cursor-pointer"
                              title={cite.detail || cite.label}
                            >
                              <span>{cite.label}</span>
                              <ExternalLink className="w-3 h-3 text-teal-600" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Proposed Consequential Write Card */}
                  {proposal && (
                    <div className="p-3.5 rounded-xl border border-teal-200 bg-teal-50/70 space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 font-bold text-teal-900">
                          <Package className="w-4 h-4 text-teal-700" />
                          <span>{proposal.title}</span>
                        </div>
                        {msg.writeConfirmed ? (
                          <Badge variant="success" size="sm">
                            Suggestion Logged
                          </Badge>
                        ) : (
                          <Badge variant="warning" size="sm">
                            Requires User Confirmation
                          </Badge>
                        )}
                      </div>

                      <p className="text-xs text-slate-700">{proposal.impactSummary}</p>

                      <div className="text-[11px] text-slate-500">
                        Required role: {proposal.roleRequired.join(' / ').toUpperCase()}
                      </div>

                      {!msg.writeConfirmed && (
                        <div className="pt-1">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() =>
                              setConfirmingProposal({ messageId: msg.id, proposal })
                            }
                            leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}
                            className="bg-teal-600 hover:bg-teal-700 text-white text-xs h-7"
                          >
                            Review & Log Suggestion
                          </Button>
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
                  <div className="w-8 h-8 rounded-xl bg-slate-200 text-slate-700 flex items-center justify-center shrink-0 border border-slate-300 font-bold text-xs">
                    YOU
                  </div>
                )}
              </div>
            );
          })}

          {isLoading && (
            <div className="flex gap-3 justify-start items-center text-xs text-slate-500">
              <div className="w-8 h-8 rounded-xl bg-teal-100 text-teal-700 flex items-center justify-center shrink-0 animate-pulse">
                <Sparkles className="w-4 h-4" />
              </div>
              <span>Querying authorized distributor ledger & analyzing stock rules...</span>
            </div>
          )}
        </div>

        {/* Prompt Input Box */}
        <div className="p-3.5 border-t border-slate-200 bg-slate-50/70">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend(inputPrompt);
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              placeholder="Ask anything about stock, receivables, orders, or margins..."
              className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 shadow-2xs"
              disabled={isLoading}
            />
            <Button
              type="submit"
              variant="primary"
              disabled={isLoading || !inputPrompt.trim()}
              leftIcon={<Send className="w-4 h-4" />}
              className="bg-teal-600 hover:bg-teal-700 text-white shrink-0"
            >
              Send
            </Button>
          </form>
        </div>
      </Card>

      {/* Explicit Consequential Write Confirmation Modal */}
      <Modal
        isOpen={!!confirmingProposal}
        onClose={() => setConfirmingProposal(null)}
        title="Confirm Operational Action"
        description="Explicit human confirmation is required before logging this replenishment suggestion. No purchase requisition will be created."
        maxWidth="md"
      >
        {confirmingProposal && (
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-700 mt-0.5" />
              <div>
                <span className="font-bold">{confirmingProposal.proposal.title}</span>
                <p className="mt-0.5 text-amber-800">{confirmingProposal.proposal.impactSummary}</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="font-semibold text-slate-800">
                Suggested Items ({confirmingProposal.proposal.payload.items.length}):
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1.5 border border-slate-100 rounded-lg p-2 bg-slate-50">
                {confirmingProposal.proposal.payload.items.map((item) => (
                  <div key={item.productId} className="flex justify-between items-center text-slate-700 bg-white p-2 rounded border border-slate-200">
                    <div>
                      <span className="font-medium text-navy-800">{item.name}</span>
                      <span className="text-slate-500 block text-[11px]">SKU: {item.sku}</span>
                    </div>
                    <div className="font-bold text-teal-800">
                      {item.qty} {item.uom}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-slate-100 p-2.5 rounded-lg text-slate-600 text-[11px]">
              🔒 <strong>Audit Record:</strong> This confirmation will be permanently logged with your user role (<strong>{currentRole}</strong>) in the organization audit history.
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmingProposal(null)}
                disabled={isExecutingWrite}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleExecuteWriteConfirmation}
                disabled={isExecutingWrite}
                leftIcon={isExecutingWrite ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                className="bg-teal-600 hover:bg-teal-700 text-white"
              >
                {isExecutingWrite ? 'Recording...' : 'Log Suggestion'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
