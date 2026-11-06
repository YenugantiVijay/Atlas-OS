import { useState } from "react";
import {
  LayoutDashboard,
  Receipt,
  Boxes,
  Users,
  FileSpreadsheet,
  CheckCircle2,
  TrendingUp,
  Download,
} from "lucide-react";

type TabKey =
  "dashboard" | "invoicing" | "inventory" | "receivables" | "reports";

export default function InteractivePreview() {
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");

  return (
    <div className="w-full rounded-2xl border border-border/80 bg-white/95 shadow-glow backdrop-blur-md overflow-hidden transition-all duration-300">
      {/* Top Application Header Bar */}
      <div className="px-4 sm:px-6 py-3.5 bg-surface-dark border-b border-border/20 flex flex-wrap items-center justify-between gap-3 text-white">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500/80 inline-block"></span>
            <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block"></span>
            <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block"></span>
          </div>
          <span className="text-xs font-mono text-content-muted border-l border-white/10 pl-3">
            Sri Lakshmi Electrical Distributors • Organization ID: org-hyd-882
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide bg-brand-500/20 text-brand-300 border border-brand-500/30">
            Interactive Product Concept Preview
          </span>
        </div>
      </div>

      {/* Workspace Tabs Navigation */}
      <div className="px-4 sm:px-6 py-2 bg-surface-secondary border-b border-border flex items-center gap-2 overflow-x-auto scrollbar-none">
        <button
          type="button"
          onClick={() => setActiveTab("dashboard")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer whitespace-nowrap ${
            activeTab === "dashboard"
              ? "bg-brand-600 text-white shadow-sm"
              : "text-content-secondary hover:text-content-primary hover:bg-white"
          }`}
        >
          <LayoutDashboard className="w-4 h-4" />
          <span>Executive Dashboard</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("invoicing")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer whitespace-nowrap ${
            activeTab === "invoicing"
              ? "bg-brand-600 text-white shadow-sm"
              : "text-content-secondary hover:text-content-primary hover:bg-white"
          }`}
        >
          <Receipt className="w-4 h-4" />
          <span>Commercial Invoicing</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("inventory")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer whitespace-nowrap ${
            activeTab === "inventory"
              ? "bg-brand-600 text-white shadow-sm"
              : "text-content-secondary hover:text-content-primary hover:bg-white"
          }`}
        >
          <Boxes className="w-4 h-4" />
          <span>Multi-UOM Inventory</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("receivables")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer whitespace-nowrap ${
            activeTab === "receivables"
              ? "bg-brand-600 text-white shadow-sm"
              : "text-content-secondary hover:text-content-primary hover:bg-white"
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Customer Receivables</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("reports")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer whitespace-nowrap ${
            activeTab === "reports"
              ? "bg-brand-600 text-white shadow-sm"
              : "text-content-secondary hover:text-content-primary hover:bg-white"
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>1-Click Excel Exports</span>
        </button>
      </div>

      {/* Tab Panels */}
      <div className="p-5 sm:p-7 min-h-[380px] bg-white">
        {/* TAB 1: EXECUTIVE DASHBOARD */}
        {activeTab === "dashboard" && (
          <div className="space-y-6 animate-fade-in">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl border border-border bg-surface-secondary space-y-1">
                <span className="text-xs font-semibold text-content-secondary uppercase tracking-wider">
                  Recognized Sales (FY)
                </span>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-display text-content-primary">
                    ₹48,24,500
                  </span>
                  <span className="text-xs font-semibold text-emerald-600 flex items-center gap-0.5">
                    <TrendingUp className="w-3.5 h-3.5" /> +14.2%
                  </span>
                </div>
                <span className="text-[11px] text-content-muted">
                  From 182 verified tax invoices
                </span>
              </div>

              <div className="p-4 rounded-xl border border-border bg-surface-secondary space-y-1">
                <span className="text-xs font-semibold text-content-secondary uppercase tracking-wider">
                  Outstanding Receivables
                </span>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-display text-brand-700">
                    ₹12,40,250
                  </span>
                  <span className="text-xs font-medium text-amber-600">
                    32 open accounts
                  </span>
                </div>
                <span className="text-[11px] text-content-muted">
                  Within approved credit limits
                </span>
              </div>

              <div className="p-4 rounded-xl border border-border bg-surface-secondary space-y-1">
                <span className="text-xs font-semibold text-content-secondary uppercase tracking-wider">
                  Total Inventory Valuation
                </span>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-display text-content-primary">
                    ₹36,18,900
                  </span>
                  <span className="text-xs font-semibold text-emerald-600">
                    Healthy
                  </span>
                </div>
                <span className="text-[11px] text-content-muted">
                  1,840 active electrical SKUs
                </span>
              </div>

              <div className="p-4 rounded-xl border border-border bg-surface-secondary space-y-1">
                <span className="text-xs font-semibold text-content-secondary uppercase tracking-wider">
                  Cash Collections (MTD)
                </span>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-display text-content-primary">
                    ₹14,92,000
                  </span>
                  <span className="text-xs font-medium text-content-secondary">
                    86 receipts
                  </span>
                </div>
                <span className="text-[11px] text-content-muted">
                  RTGS (72%), UPI (18%), Cash (10%)
                </span>
              </div>
            </div>

            {/* Quick Orders Stream */}
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-3 bg-surface-secondary border-b border-border flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-content-primary">
                  Recent Commercial Transactions
                </span>
                <span className="text-xs text-brand-600 font-medium">
                  Real-Time Ledger Sync
                </span>
              </div>
              <div className="divide-y divide-border text-xs">
                <div className="px-4 py-3 flex items-center justify-between hover:bg-surface-secondary/50">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-semibold text-brand-700">
                      INV-2026-0842
                    </span>
                    <div>
                      <p className="font-semibold text-content-primary">
                        Gayatri Electrical Contractors
                      </p>
                      <p className="text-content-secondary text-[11px]">
                        Wires & MCBs • Place of Supply: Andhra Pradesh (37)
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-content-primary">₹1,18,500</p>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Paid in Full
                    </span>
                  </div>
                </div>

                <div className="px-4 py-3 flex items-center justify-between hover:bg-surface-secondary/50">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-semibold text-brand-700">
                      INV-2026-0841
                    </span>
                    <div>
                      <p className="font-semibold text-content-primary">
                        Kavitha Power & Control Systems
                      </p>
                      <p className="text-content-secondary text-[11px]">
                        Switchgear & Heavy Cables • Interstate IGST
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-content-primary">₹2,84,200</p>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                      Partially Paid (₹1.5L Rec.)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: INVOICING */}
        {activeTab === "invoicing" && (
          <div className="space-y-4 animate-fade-in">
            <div className="p-4 rounded-xl border border-brand-200 bg-brand-50/40 flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-brand-800">
                  Statutory Tax Invoice Details
                </span>
                <p className="text-sm font-semibold text-content-primary">
                  Invoice Number: INV-2026-0842
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white border border-brand-200 text-brand-700">
                  GSTIN: 37AAAAA1234A1Z5
                </span>
                <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-100 text-emerald-800">
                  ISSUED • STATUTORY COMPLIANT
                </span>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-secondary border-b border-border text-content-secondary uppercase">
                  <tr>
                    <th className="px-3.5 py-2.5">Item & Rating</th>
                    <th className="px-3 py-2.5">HSN</th>
                    <th className="px-3 py-2.5">Qty / UOM</th>
                    <th className="px-3 py-2.5">Unit Rate</th>
                    <th className="px-3 py-2.5">Tax (GST)</th>
                    <th className="px-3.5 py-2.5 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr>
                    <td className="px-3.5 py-3 font-medium text-content-primary">
                      Polycab 2.5 sq mm FR-LSH Copper Wire (Red)
                    </td>
                    <td className="px-3 py-3 font-mono text-content-secondary">
                      8544
                    </td>
                    <td className="px-3 py-3 font-semibold text-brand-700">
                      10 Coils
                    </td>
                    <td className="px-3 py-3">₹2,450.00</td>
                    <td className="px-3 py-3">18% (₹4,410)</td>
                    <td className="px-3.5 py-3 text-right font-bold">
                      ₹28,910.00
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3.5 py-3 font-medium text-content-primary">
                      Schneider Acti9 32A TP MCB C-Curve 10kA
                    </td>
                    <td className="px-3 py-3 font-mono text-content-secondary">
                      8536
                    </td>
                    <td className="px-3 py-3 font-semibold text-brand-700">
                      25 Nos
                    </td>
                    <td className="px-3 py-3">₹1,180.00</td>
                    <td className="px-3 py-3">18% (₹5,310)</td>
                    <td className="px-3.5 py-3 text-right font-bold">
                      ₹34,810.00
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3.5 py-3 font-medium text-content-primary">
                      Finolex 1-inch Heavy Gauge PVC Conduit Pipes
                    </td>
                    <td className="px-3 py-3 font-mono text-content-secondary">
                      3917
                    </td>
                    <td className="px-3 py-3 font-semibold text-brand-700">
                      15 Bundles
                    </td>
                    <td className="px-3 py-3">₹3,200.00</td>
                    <td className="px-3 py-3">18% (₹8,640)</td>
                    <td className="px-3.5 py-3 text-right font-bold">
                      ₹56,640.00
                    </td>
                  </tr>
                </tbody>
                <tfoot className="bg-surface-secondary/70 font-semibold border-t border-border">
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3.5 py-2.5 text-content-secondary text-right"
                    >
                      Subtotal: ₹1,00,100 • Total GST (9% CGST + 9% SGST):
                      ₹18,018
                    </td>
                    <td
                      colSpan={2}
                      className="px-3.5 py-2.5 text-right text-sm font-bold text-brand-700"
                    >
                      Grand Total: ₹1,18,118.00
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: INVENTORY */}
        {activeTab === "inventory" && (
          <div className="space-y-4 animate-fade-in">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-content-primary">
                  Filter By Category:
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-brand-50 text-brand-700 border border-brand-200 font-medium">
                  Wires & Cables (428)
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-surface-secondary text-content-secondary border border-border">
                  Switchgear (312)
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-surface-secondary text-content-secondary border border-border">
                  Conduits (95)
                </span>
              </div>
              <span className="text-content-muted">
                Physical Unit Integrity Enforced
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-secondary border-b border-border text-content-secondary uppercase">
                  <tr>
                    <th className="px-3.5 py-2.5">SKU Code</th>
                    <th className="px-3 py-2.5">Product Name & Brand</th>
                    <th className="px-3 py-2.5">Unit (UOM)</th>
                    <th className="px-3 py-2.5">Available Stock</th>
                    <th className="px-3 py-2.5">Committed</th>
                    <th className="px-3.5 py-2.5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr>
                    <td className="px-3.5 py-3 font-mono font-semibold text-brand-700">
                      WIR-POL-2.5-RD
                    </td>
                    <td className="px-3 py-3 font-medium text-content-primary">
                      Polycab 2.5mm Wire (Red 90m)
                    </td>
                    <td className="px-3 py-3">Coils</td>
                    <td className="px-3 py-3 font-bold text-content-primary">
                      148
                    </td>
                    <td className="px-3 py-3 text-content-secondary">
                      20 Coils
                    </td>
                    <td className="px-3.5 py-3 text-right">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        In Stock
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3.5 py-3 font-mono font-semibold text-brand-700">
                      MCB-SCH-32-TP
                    </td>
                    <td className="px-3 py-3 font-medium text-content-primary">
                      Schneider Acti9 32A 3-Pole MCB
                    </td>
                    <td className="px-3 py-3">Nos</td>
                    <td className="px-3 py-3 font-bold text-amber-600">8</td>
                    <td className="px-3 py-3 text-content-secondary">5 Nos</td>
                    <td className="px-3.5 py-3 text-right">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                        Reorder Recommended
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3.5 py-3 font-mono font-semibold text-brand-700">
                      CND-FIN-25-HV
                    </td>
                    <td className="px-3 py-3 font-medium text-content-primary">
                      Finolex 25mm Heavy Conduit
                    </td>
                    <td className="px-3 py-3">Bundles</td>
                    <td className="px-3 py-3 font-bold text-content-primary">
                      85
                    </td>
                    <td className="px-3 py-3 text-content-secondary">
                      15 Bundles
                    </td>
                    <td className="px-3.5 py-3 text-right">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        In Stock
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: RECEIVABLES */}
        {activeTab === "receivables" && (
          <div className="space-y-4 animate-fade-in">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-lg border border-border bg-surface-secondary">
                <span className="text-content-secondary">
                  Total Active Debtors:
                </span>
                <p className="text-base font-bold text-content-primary mt-0.5">
                  32 Accounts
                </p>
              </div>
              <div className="p-3 rounded-lg border border-border bg-surface-secondary">
                <span className="text-content-secondary">
                  Overdue (&gt;30 Days):
                </span>
                <p className="text-base font-bold text-amber-600 mt-0.5">
                  ₹1,84,000 (3 Accounts)
                </p>
              </div>
              <div className="p-3 rounded-lg border border-border bg-surface-secondary">
                <span className="text-content-secondary">
                  Average Collection Period:
                </span>
                <p className="text-base font-bold text-content-primary mt-0.5">
                  24.5 Days
                </p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-secondary border-b border-border text-content-secondary uppercase">
                  <tr>
                    <th className="px-3.5 py-2.5">Customer / Company</th>
                    <th className="px-3 py-2.5">Credit Limit</th>
                    <th className="px-3 py-2.5">Current Balance</th>
                    <th className="px-3 py-2.5">Oldest Due Date</th>
                    <th className="px-3.5 py-2.5 text-right">Credit Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr>
                    <td className="px-3.5 py-3 font-medium text-content-primary">
                      Gayatri Electrical Contractors
                      <span className="block text-[11px] text-content-secondary">
                        GSTIN: 37AAAAA1234A1Z5
                      </span>
                    </td>
                    <td className="px-3 py-3">₹5,00,000</td>
                    <td className="px-3 py-3 font-bold text-content-primary">
                      ₹1,42,500
                    </td>
                    <td className="px-3 py-3 text-content-secondary">
                      18 Days Remaining
                    </td>
                    <td className="px-3.5 py-3 text-right">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Healthy (28% Utilized)
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3.5 py-3 font-medium text-content-primary">
                      Sri Venkateswara Infrastructure
                      <span className="block text-[11px] text-content-secondary">
                        GSTIN: 37BBBBB5678B2Z1
                      </span>
                    </td>
                    <td className="px-3 py-3">₹10,00,000</td>
                    <td className="px-3 py-3 font-bold text-brand-700">
                      ₹6,85,000
                    </td>
                    <td className="px-3 py-3 text-content-secondary">
                      5 Days Remaining
                    </td>
                    <td className="px-3.5 py-3 text-right">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Within Limit (68%)
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: REPORTS */}
        {activeTab === "reports" && (
          <div className="space-y-4 animate-fade-in">
            <div className="p-4 rounded-xl border border-border bg-surface-secondary flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-content-secondary">
                  One-Click Statutory Export Engine
                </p>
                <p className="text-sm font-semibold text-content-primary">
                  Indian Financial Year: FY 2026-27 (April 1 to March 31)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold shadow-xs">
                  <Download className="w-3.5 h-3.5" /> Export .XLSX
                  (Multi-Sheet)
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 text-xs">
              <div className="p-3 rounded-xl border border-brand-200 bg-brand-50/60">
                <p className="font-bold text-brand-900">
                  Sheet 1: Reconciliation
                </p>
                <p className="text-[11px] text-brand-700 mt-1">
                  Recognized revenue vs. non-revenue draft/cancelled separation.
                </p>
              </div>
              <div className="p-3 rounded-xl border border-border bg-white">
                <p className="font-bold text-content-primary">
                  Sheet 2: Invoices
                </p>
                <p className="text-[11px] text-content-secondary mt-1">
                  All issued invoices, Place of Supply, and live balance due.
                </p>
              </div>
              <div className="p-3 rounded-xl border border-border bg-white">
                <p className="font-bold text-content-primary">
                  Sheet 3: Products
                </p>
                <p className="text-[11px] text-content-secondary mt-1">
                  Billed line items, HSN, quantity, and authoritative tax rates.
                </p>
              </div>
              <div className="p-3 rounded-xl border border-border bg-white">
                <p className="font-bold text-content-primary">
                  Sheet 4: Receipts
                </p>
                <p className="text-[11px] text-content-secondary mt-1">
                  Collected payment transactions across RTGS, NEFT, UPI, Cash.
                </p>
              </div>
              <div className="p-3 rounded-xl border border-border bg-white">
                <p className="font-bold text-content-primary">
                  Sheet 5: Allocations
                </p>
                <p className="text-[11px] text-content-secondary mt-1">
                  Exact cross-period settlement links per customer receipt.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Info Stripe */}
      <div className="px-6 py-2.5 bg-surface-secondary border-t border-border flex flex-wrap items-center justify-between text-[11px] text-content-secondary">
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          <span>
            Zero redundant queries • Server-side bounded pagination • Immutable
            GST snapshots
          </span>
        </span>
        <span className="font-mono text-brand-700 font-medium">
          Production Database Architecture v0.2.0
        </span>
      </div>
    </div>
  );
}
