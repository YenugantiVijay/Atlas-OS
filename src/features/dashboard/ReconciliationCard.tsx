import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Info,
  CheckCircle2,
  FileSpreadsheet,
  Package,
  Layers,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency } from '@/lib/money';
import {
  reconciliationService,
  FinancialReconciliationResult,
  InventoryReconciliationResult,
  METRIC_DEFINITIONS,
} from '@/services/reconciliation.service';

interface ReconciliationCardProps {
  orgId: string;
  isMockAuth: boolean;
  canSeeFinancialBalances: boolean;
}

export const ReconciliationCard: React.FC<ReconciliationCardProps> = ({
  orgId,
  isMockAuth,
  canSeeFinancialBalances,
}) => {
  const [financialResult, setFinancialResult] = useState<FinancialReconciliationResult | null>(null);
  const [inventoryResult, setInventoryResult] = useState<InventoryReconciliationResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [showDetailsModal, setShowDetailsModal] = useState<boolean>(false);
  const [showDefinitionsModal, setShowDefinitionsModal] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'inventory' | 'financial'>('inventory');

  const runReconciliation = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const invPromise = reconciliationService.reconcileInventory(orgId, isMockAuth);
      const finPromise = canSeeFinancialBalances
        ? reconciliationService.reconcileFinancials(orgId, isMockAuth)
        : Promise.resolve(null);

      const [inv, fin] = await Promise.all([invPromise, finPromise]);
      setInventoryResult(inv);
      if (fin) setFinancialResult(fin);
    } catch (err) {
      console.error('Failed to run ledger reconciliation:', err);
    } finally {
      setLoading(false);
    }
  }, [orgId, isMockAuth, canSeeFinancialBalances]);

  useEffect(() => {
    runReconciliation();
  }, [runReconciliation]);

  const hasIssues =
    (inventoryResult && inventoryResult.status === 'DISCREPANCY_DETECTED') ||
    (financialResult && financialResult.status === 'VARIANCE_DETECTED');

  const latestAsOf = inventoryResult?.formattedAsOf || financialResult?.formattedAsOf || 'Just now';

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs transition-all">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-xl ${hasIssues ? 'bg-amber-100 text-amber-800' : 'bg-teal-50 text-teal-700'}`}>
              {hasIssues ? <AlertTriangle className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-navy-800">Ledger & Data Integrity</h3>
                <Badge variant={hasIssues ? 'warning' : 'success'} size="sm">
                  {hasIssues ? 'Action Recommended' : 'Reconciled'}
                </Badge>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Fresh as of {latestAsOf} • Continuous multi-ledger verification
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDefinitionsModal(true)}
              leftIcon={<Info className="w-3.5 h-3.5" />}
              className="text-xs h-8 px-2.5 text-slate-600 hover:text-navy-800"
            >
              Metric Formulas
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={runReconciliation}
              disabled={loading}
              leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
              className="text-xs h-8 px-2.5"
            >
              Verify
            </Button>
          </div>
        </div>

        {/* 2-column Ledger Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3">
          {/* Inventory Integrity Card */}
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5 text-slate-500" />
                  Physical Stock vs Ledger
                </span>
                {inventoryResult?.status === 'VERIFIED' ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 100% Matched
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                    <AlertTriangle className="w-3.5 h-3.5" /> {inventoryResult?.discrepantCount || 0} Variance(s)
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                {inventoryResult?.explanation || 'Verifying product stock history against physical records...'}
              </p>
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-200/60 flex items-center justify-between text-xs">
              <span className="text-slate-500">
                Audited {inventoryResult?.totalProductsChecked || 0} catalog SKU(s)
              </span>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('inventory');
                  setShowDetailsModal(true);
                }}
                className="text-teal-700 hover:text-teal-800 font-semibold cursor-pointer"
              >
                Inspect Ledger →
              </button>
            </div>
          </div>

          {/* Financial Ledger Integrity Card (if permitted) */}
          {canSeeFinancialBalances ? (
            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-slate-500" />
                    Invoicing vs Payments Ledger
                  </span>
                  {financialResult?.status === 'BALANCED' ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Balanced
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700">
                      <AlertTriangle className="w-3.5 h-3.5" /> {formatCurrency(financialResult?.varianceAmount || 0)} Variance
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {financialResult?.explanation || 'Verifying invoices against payment allocations and receivables...'}
                </p>
              </div>
              <div className="mt-2.5 pt-2 border-t border-slate-200/60 flex items-center justify-between text-xs">
                <span className="text-slate-500">
                  Total Invoiced: {formatCurrency(financialResult?.totalInvoiced || 0)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('financial');
                    setShowDetailsModal(true);
                  }}
                  className="text-teal-700 hover:text-teal-800 font-semibold cursor-pointer"
                >
                  Inspect Financials →
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 flex flex-col justify-center">
              <span className="text-xs text-slate-500 italic">
                Financial ledger reconciliation is restricted to authorized accounting roles.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Details Modal */}
      <Modal
        isOpen={showDetailsModal}
        onClose={() => setShowDetailsModal(false)}
        title="Ledger Reconciliation Audit"
        description="Comprehensive audit comparing recorded entity values against cumulative double-entry ledger history."
        maxWidth="2xl"
      >
        <div className="space-y-4">
          <div className="flex border-b border-slate-200">
            <button
              type="button"
              onClick={() => setActiveTab('inventory')}
              className={`pb-2 px-4 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                activeTab === 'inventory'
                  ? 'border-teal-600 text-teal-800'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Inventory Ledger ({inventoryResult?.discrepantCount || 0} Discrepancies)
            </button>
            {canSeeFinancialBalances && (
              <button
                type="button"
                onClick={() => setActiveTab('financial')}
                className={`pb-2 px-4 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                  activeTab === 'financial'
                    ? 'border-teal-600 text-teal-800'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                Financial Invoices ({financialResult?.discrepancies.length || 0} Discrepancies)
              </button>
            )}
          </div>

          {activeTab === 'inventory' && (
            <div className="space-y-3">
              <div className="p-3 bg-slate-50 rounded-lg text-xs text-slate-600">
                {inventoryResult?.explanation}
              </div>
              {inventoryResult?.discrepancies && inventoryResult.discrepancies.length > 0 ? (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {inventoryResult.discrepancies.map((disc) => (
                    <div
                      key={disc.productId}
                      className="p-3 border border-amber-200 bg-amber-50/50 rounded-xl space-y-1.5"
                    >
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-navy-800">
                          {disc.name} ({disc.sku})
                        </span>
                        <span className="font-semibold text-rose-700">
                          Variance: {disc.varianceUnits > 0 ? `+${disc.varianceUnits}` : disc.varianceUnits} {disc.uom}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 grid grid-cols-2 gap-2">
                        <span>Physical Stock: {disc.recordedStock} {disc.uom}</span>
                        <span>Ledger Sum: {disc.ledgerStock} {disc.uom}</span>
                      </div>
                      <div className="text-xs text-amber-900 bg-amber-100/70 p-2 rounded-lg">
                        💡 <strong>Action:</strong> {disc.actionableAdvice}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-slate-500 text-xs">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                  All inventory items reconcile 1:1 with movement records.
                </div>
              )}
            </div>
          )}

          {activeTab === 'financial' && canSeeFinancialBalances && financialResult && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 p-3 bg-slate-50 rounded-lg text-xs text-slate-700">
                <div>
                  <div className="text-slate-500">Total Invoiced</div>
                  <div className="font-bold text-navy-800">{formatCurrency(financialResult.totalInvoiced)}</div>
                </div>
                <div>
                  <div className="text-slate-500">Collected</div>
                  <div className="font-bold text-emerald-700">{formatCurrency(financialResult.totalPaid)}</div>
                </div>
                <div>
                  <div className="text-slate-500">Outstanding</div>
                  <div className="font-bold text-blue-700">{formatCurrency(financialResult.totalOutstanding)}</div>
                </div>
              </div>

              {financialResult.discrepancies.length > 0 ? (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {financialResult.discrepancies.map((disc) => (
                    <div
                      key={disc.invoiceId}
                      className="p-3 border border-rose-200 bg-rose-50/50 rounded-xl space-y-1 text-xs"
                    >
                      <div className="flex justify-between items-center font-bold text-navy-800">
                        <span>{disc.invoiceNumber}</span>
                        <span className="text-rose-700">Variance: {formatCurrency(disc.variance)}</span>
                      </div>
                      <div className="text-slate-600">{disc.note}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-slate-500 text-xs">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                  All customer invoices and payment allocations are balanced without variance.
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end pt-3 border-t border-slate-100">
            <Button variant="outline" size="sm" onClick={() => setShowDetailsModal(false)}>
              Close Audit
            </Button>
          </div>
        </div>
      </Modal>

      {/* Metric Definitions Modal */}
      <Modal
        isOpen={showDefinitionsModal}
        onClose={() => setShowDefinitionsModal(false)}
        title="Metric Definitions & Formulas"
        description="Definitions, accounting standards, and formulas for all figures shown on the dashboard."
        maxWidth="lg"
      >
        <div className="space-y-3">
          {Object.entries(METRIC_DEFINITIONS).map(([key, def]) => (
            <div key={key} className="p-3 border border-slate-100 rounded-xl bg-slate-50 space-y-1">
              <div className="text-xs font-bold text-navy-800 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-teal-600" />
                {def.title}
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">{def.definition}</p>
              <div className="text-[11px] font-mono text-slate-700 bg-white border border-slate-200 px-2 py-1 rounded">
                Formula: {def.formula}
              </div>
            </div>
          ))}
          <div className="flex justify-end pt-2">
            <Button variant="primary" size="sm" onClick={() => setShowDefinitionsModal(false)}>
              Understood
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
