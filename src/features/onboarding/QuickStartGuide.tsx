import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  CheckCircle2,
  FileSpreadsheet,
  PackagePlus,
  ArrowRight,
  RotateCcw,
  Store,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { useOrg } from '@/features/organizations/OrgContext';
import { storage } from '@/lib/storage';
import { guidedImportService } from '@/features/import-preview/guided-import.service';

interface QuickStartGuideProps {
  onOpenImportModal?: () => void;
}

export const QuickStartGuide: React.FC<QuickStartGuideProps> = ({ onOpenImportModal }) => {
  const { currentOrg, isMockAuth } = useOrg();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [isExpanded, setIsExpanded] = useState(true);
  const [isSeeding, setIsSeeding] = useState(false);
  const [productCount, setProductCount] = useState(0);
  const [recentBatches, setRecentBatches] = useState<any[]>([]);
  const [undoingBatchId, setUndoingBatchId] = useState<string | null>(null);

  const refreshStatus = useCallback(() => {
    if (!currentOrg) return;
    if (isMockAuth) {
      const prods = storage.getProducts(currentOrg.id);
      setProductCount(prods.length);
      const batches = storage.getImportBatches(currentOrg.id);
      setRecentBatches(batches.slice(0, 3));
    }
  }, [currentOrg, isMockAuth]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const handleSeedCatalog = async () => {
    if (!currentOrg || isSeeding) return;
    setIsSeeding(true);
    try {
      const res = await guidedImportService.seedStarterElectricalCatalog(currentOrg.id, isMockAuth);
      showToast(
        'success',
        'Catalog Initialized',
        `Added ${res.seededCount} standard electrical items (Wires, MCBs, Switches, Conduit) with HSN codes & GST rates.`
      );
      refreshStatus();
    } catch (err: any) {
      showToast('error', 'Seeding Failed', err.message || 'Unable to seed starter catalog');
    } finally {
      setIsSeeding(false);
    }
  };

  const handleUndoBatch = async (batchId: string) => {
    if (!currentOrg || undoingBatchId) return;
    setUndoingBatchId(batchId);
    try {
      const res = await guidedImportService.undoImportBatch(currentOrg.id, batchId, isMockAuth);
      if (res.success) {
        showToast('success', 'Import Rolled Back', res.message);
      } else {
        showToast('warning', 'Undo Blocked', res.message);
      }
      refreshStatus();
    } catch (err: any) {
      showToast('error', 'Rollback Failed', err.message || 'Error undoing import batch');
    } finally {
      setUndoingBatchId(null);
    }
  };

  if (!currentOrg) return null;

  return (
    <div className="rounded-2xl border border-teal-200/80 bg-gradient-to-r from-teal-50/50 via-white to-slate-50 p-4 sm:p-5 shadow-xs transition-all">
      <div className="flex items-start justify-between gap-3 sm:items-center">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="p-2 rounded-xl bg-teal-600 text-white shadow-xs">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-navy-800">Fast-Track Setup Guide</h3>
              <Badge variant="teal" size="sm" className="min-w-0 whitespace-normal">
                Indian Electrical Retail & Distribution
              </Badge>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Launch your catalog and create your first tax invoice in under 2 minutes.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="shrink-0 text-slate-400 hover:text-slate-600 p-1 rounded-lg"
          aria-label={isExpanded ? 'Collapse Quick Start' : 'Expand Quick Start'}
        >
          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-slate-200/70 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Step 1: Business Identity */}
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-1">
                  <span>1. Business Identity</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                </div>
                <p className="text-xs text-slate-600">
                  {currentOrg.name}
                  {currentOrg.gstin ? (
                    <span className="block text-slate-500 font-mono text-[11px] mt-0.5">
                      GSTIN: {currentOrg.gstin}
                    </span>
                  ) : (
                    <span className="block text-amber-700 text-[11px] mt-0.5">
                      GSTIN not set (Optional for small dealers)
                    </span>
                  )}
                </p>
              </div>
              <div className="mt-3 pt-2 border-t border-slate-100">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/settings')}
                  className="w-full text-xs h-7"
                >
                  Manage Org Profile
                </Button>
              </div>
            </div>

            {/* Step 2: Instant Catalog Setup */}
            <div className="rounded-xl border border-teal-300 bg-teal-50/40 p-3.5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-teal-900 mb-1">
                  <span>2. Catalog & Stock</span>
                  {productCount > 0 ? (
                    <span className="text-[11px] font-semibold text-emerald-700">
                      {productCount} Items Live
                    </span>
                  ) : (
                    <Badge variant="warning" size="sm">Action Needed</Badge>
                  )}
                </div>
                <p className="text-xs text-slate-600">
                  Seed fast-moving electrical SKUs or upload your distributor Excel sheet.
                </p>
              </div>

              <div className="mt-3 pt-2 border-t border-teal-200/50 flex flex-col gap-2 md:flex-row">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSeedCatalog}
                  disabled={isSeeding}
                  leftIcon={<PackagePlus className="w-3.5 h-3.5" />}
                  className="w-full text-xs h-7 bg-teal-600 hover:bg-teal-700 text-white md:w-auto md:flex-1"
                >
                  {isSeeding ? 'Seeding...' : '1-Click Starter SKUs'}
                </Button>
                {onOpenImportModal && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onOpenImportModal}
                    leftIcon={<FileSpreadsheet className="w-3.5 h-3.5" />}
                    className="w-full text-xs h-7 border-teal-300 bg-white md:w-auto"
                  >
                    Import Excel
                  </Button>
                )}
              </div>
            </div>

            {/* Step 3: First Sale */}
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-1">
                  <span>3. First Bill or Quotation</span>
                  <Store className="w-4 h-4 text-slate-400" />
                </div>
                <p className="text-xs text-slate-600">
                  Open Retail Counter for fast OTC billing or create a B2B contractor tax invoice.
                </p>
              </div>
              <div className="mt-3 pt-2 border-t border-slate-100 flex flex-col gap-2 md:flex-row">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/pos')}
                  rightIcon={<ArrowRight className="w-3 h-3" />}
                  className="w-full text-xs h-7 text-navy-800 md:w-auto md:flex-1"
                >
                  Retail Counter
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/invoices')}
                  className="w-full text-xs h-7 md:w-auto"
                >
                  Invoices
                </Button>
              </div>
            </div>
          </div>

          {/* Recent Import Batches & Undo Recovery */}
          {recentBatches.length > 0 && (
            <div className="pt-2 border-t border-slate-200/60">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Recent Imports (Safe Undo Available)
              </div>
              <div className="space-y-1.5">
                {recentBatches.map((batch) => (
                  <div
                    key={batch.batchId}
                    className="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-slate-200 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-teal-600" />
                      <span className="font-medium text-navy-800">
                        {batch.dataset === 'products' ? 'Product Catalog Batch' : 'Customer Master Batch'}
                      </span>
                      <span className="text-slate-500 text-[11px]">
                        ({batch.count} records • {new Date(batch.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                      </span>
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleUndoBatch(batch.batchId)}
                      disabled={undoingBatchId === batch.batchId}
                      leftIcon={<RotateCcw className="w-3 h-3 text-rose-600" />}
                      className="text-xs h-6 px-2 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                    >
                      {undoingBatchId === batch.batchId ? 'Rolling back...' : 'Undo Import'}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
