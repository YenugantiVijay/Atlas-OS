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
  ShieldCheck,
  Building2,
  ArrowUpRight,
  Sparkles,
} from "lucide-react";

type TabKey =
  | "dashboard"
  | "invoicing"
  | "inventory"
  | "receivables"
  | "reports";

export default function InteractivePreview() {
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");

  return (
    <div className="w-full rounded-2xl border border-border/90 bg-white shadow-2xl overflow-hidden transition-all duration-300">
      {/* Desktop Window Top Chrome */}
      <div className="px-4 sm:px-6 py-3.5 bg-[#142B4D] border-b border-white/10 flex flex-wrap items-center justify-between gap-3 text-white">
        <div className="flex items-center gap-3">
          {/* Window Control Buttons */}
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="w-3 h-3 rounded-full bg-[#EF4444] inline-block shadow-xs"></span>
            <span className="w-3 h-3 rounded-full bg-[#F59E0B] inline-block shadow-xs"></span>
            <span className="w-3 h-3 rounded-full bg-[#10B981] inline-block shadow-xs"></span>
          </div>

          {/* Connected Organization Badge */}
          <div className="flex items-center gap-2 border-l border-white/15 pl-3">
            <Building2 className="w-3.5 h-3.5 text-teal-300 shrink-0" />
            <span className="text-xs font-medium text-slate-200 truncate max-w-[280px] sm:max-w-none">
              Bharat Electricals & Hardware Ltd. <span className="text-slate-400 font-mono text-[11px]">(GSTIN: 37AAAAA1234A1Z5)</span>
            </span>
          </div>
        </div>

        {/* Concept Preview Pill */}
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-semibold tracking-wide bg-teal-500/20 text-teal-200 border border-teal-400/30 shadow-xs">
            <Sparkles className="w-3 h-3 text-teal-300" />
            <span>Atlas OS Desktop Edition Preview</span>
          </span>
        </div>
      </div>

      {/* Navigation Tab Bar */}
      <div className="px-3 sm:px-6 py-2.5 bg-[#F5F7FA] border-b border-border flex items-center gap-1.5 sm:gap-2 overflow-x-auto scrollbar-none">
        <button
          type="button"
          onClick={() => setActiveTab("dashboard")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer whitespace-nowrap ${
            activeTab === "dashboard"
              ? "bg-[#142B4D] text-white shadow-sm"
              : "text-content-secondary hover:text-[#142B4D] hover:bg-white"
          }`}
          title="Executive Dashboard"
        >
          <LayoutDashboard className="w-4 h-4 text-teal-400" />
          <span>Executive Dashboard</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("invoicing")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer whitespace-nowrap ${
            activeTab === "invoicing"
              ? "bg-[#142B4D] text-white shadow-sm"
              : "text-content-secondary hover:text-[#142B4D] hover:bg-white"
          }`}
          title="Commercial Invoicing"
        >
          <Receipt className="w-4 h-4 text-teal-400" />
          <span>Commercial Invoicing</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("inventory")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer whitespace-nowrap ${
            activeTab === "inventory"
              ? "bg-[#142B4D] text-white shadow-sm"
              : "text-content-secondary hover:text-[#142B4D] hover:bg-white"
          }`}
          title="Multi-UOM Inventory"
        >
          <Boxes className="w-4 h-4 text-teal-400" />
          <span>Multi-UOM Inventory</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("receivables")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer whitespace-nowrap ${
            activeTab === "receivables"
              ? "bg-[#142B4D] text-white shadow-sm"
              : "text-content-secondary hover:text-[#142B4D] hover:bg-white"
          }`}
          title="Customer Receivables / Payments"
        >
          <Users className="w-4 h-4 text-teal-400" />
          <span>Customer Receivables</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("reports")}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-150 cursor-pointer whitespace-nowrap ${
            activeTab === "reports"
              ? "bg-[#142B4D] text-white shadow-sm"
              : "text-content-secondary hover:text-[#142B4D] hover:bg-white"
          }`}
          title="1-Click Excel Exports"
        >
          <FileSpreadsheet className="w-4 h-4 text-teal-400" />
          <span>1-Click Excel Exports</span>
        </button>
      </div>

      {/* Workspace Panel Canvas */}
      <div className="p-4 sm:p-7 min-h-[410px] bg-white">
        {/* TAB 1: EXECUTIVE DASHBOARD */}
        {activeTab === "dashboard" && (
          <div className="space-y-6 animate-fade-in">
            {/* 4 Primary KPI Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* KPI 1 */}
              <div className="p-4.5 rounded-xl border border-teal-100 bg-gradient-to-br from-teal-50/50 via-white to-slate-50 shadow-2xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-teal-800 uppercase tracking-wider">
                    Recognized Sales (FY)
                  </span>
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                    <TrendingUp className="w-3 h-3" /> +14.2% YoY
                  </span>
                </div>
                <div className="text-2xl sm:text-[26px] font-extrabold font-heading text-[#142B4D]">
                  ₹48,24,500
                </div>
                <div className="text-[11.5px] text-content-secondary flex items-center justify-between">
                  <span>182 verified tax invoices</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-teal-600" />
                </div>
              </div>

              {/* KPI 2 */}
              <div className="p-4.5 rounded-xl border border-amber-100 bg-gradient-to-br from-amber-50/40 via-white to-slate-50 shadow-2xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">
                    Outstanding Receivables
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                    32 Open Accounts
                  </span>
                </div>
                <div className="text-2xl sm:text-[26px] font-extrabold font-heading text-amber-700">
                  ₹12,40,250
                </div>
                <div className="text-[11.5px] text-content-secondary flex items-center justify-between">
                  <span>Within approved credit limits</span>
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                </div>
              </div>

              {/* KPI 3 */}
              <div className="p-4.5 rounded-xl border border-sky-100 bg-gradient-to-br from-sky-50/40 via-white to-slate-50 shadow-2xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-sky-800 uppercase tracking-wider">
                    Total Inventory Valuation
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                    Healthy (94% Active)
                  </span>
                </div>
                <div className="text-2xl sm:text-[26px] font-extrabold font-heading text-[#142B4D]">
                  ₹36,18,900
                </div>
                <div className="text-[11.5px] text-content-secondary flex items-center justify-between">
                  <span>1,840 active electrical SKUs</span>
                  <Boxes className="w-3.5 h-3.5 text-sky-600" />
                </div>
              </div>

              {/* KPI 4 */}
              <div className="p-4.5 rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50/40 via-white to-slate-50 shadow-2xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">
                    Cash Collections (MTD)
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-800">
                    86 Receipts
                  </span>
                </div>
                <div className="text-2xl sm:text-[26px] font-extrabold font-heading text-[#142B4D]">
                  ₹14,92,000
                </div>
                <div className="text-[11.5px] text-content-secondary flex items-center justify-between">
                  <span>RTGS (72%), UPI (18%), Cash (10%)</span>
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                </div>
              </div>
            </div>

            {/* Sales Activity Visualization & Recent Transactions Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left: Monthly Revenue Trend Visualization (5 cols) */}
              <div className="lg:col-span-5 p-4 sm:p-5 rounded-xl border border-border bg-[#F5F7FA] space-y-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-[#142B4D] uppercase tracking-wider">
                      Revenue Progression (FY 26-27)
                    </span>
                    <span className="text-[11px] font-semibold text-teal-700">
                      Target: ₹50L
                    </span>
                  </div>
                  <p className="text-[11px] text-content-secondary">
                    Recognized tax invoices cleared through bank reconciliation.
                  </p>
                </div>

                {/* Modern Bar Chart Visual */}
                <div className="pt-2 pb-1 space-y-2.5">
                  <div className="flex items-end justify-between gap-2 h-28 px-2 border-b border-border/80">
                    {[
                      { month: "Apr", val: "₹28.4L", height: "45%" },
                      { month: "May", val: "₹31.2L", height: "52%" },
                      { month: "Jun", val: "₹34.8L", height: "60%" },
                      { month: "Jul", val: "₹38.5L", height: "68%" },
                      { month: "Aug", val: "₹42.0L", height: "76%" },
                      { month: "Sep", val: "₹45.6L", height: "85%" },
                      { month: "Oct", val: "₹48.2L", height: "95%", current: true },
                    ].map((item) => (
                      <div key={item.month} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group">
                        <span className="text-[9px] font-mono text-content-muted opacity-0 group-hover:opacity-100 transition-opacity">
                          {item.val}
                        </span>
                        <div
                          style={{ height: item.height }}
                          className={`w-full max-w-[28px] rounded-t-md transition-all duration-300 ${
                            item.current
                              ? "bg-teal-600 shadow-sm"
                              : "bg-[#142B4D]/70 hover:bg-[#142B4D]"
                          }`}
                        ></div>
                        <span className={`text-[10.5px] font-semibold ${item.current ? "text-teal-700" : "text-content-secondary"}`}>
                          {item.month}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-content-muted pt-1">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-teal-600"></span>
                      <span>Current Month (October)</span>
                    </span>
                    <span className="font-semibold text-emerald-700">96.4% on-track</span>
                  </div>
                </div>
              </div>

              {/* Right: Recent Commercial Transactions (7 cols) */}
              <div className="lg:col-span-7 rounded-xl border border-border overflow-hidden flex flex-col justify-between">
                <div className="px-4 py-3 bg-[#F5F7FA] border-b border-border flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#142B4D]">
                    Recent Commercial Transactions
                  </span>
                  <span className="text-[11px] font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200">
                    Real-Time Ledger Sync
                  </span>
                </div>

                <div className="divide-y divide-border text-xs flex-1">
                  <div className="px-4 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center font-mono font-bold text-xs shrink-0">
                        INV
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-teal-800">
                            INV-2026-0842
                          </span>
                          <span className="text-[10px] text-content-muted font-mono">
                            Today, 11:30 AM
                          </span>
                        </div>
                        <p className="font-semibold text-[#142B4D] text-xs">
                          Gayatri Electrical Contractors
                        </p>
                        <p className="text-content-secondary text-[11px]">
                          Wires & MCBs • Place of Supply: Andhra Pradesh (37)
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-[#142B4D] text-sm">₹1,18,500</p>
                      <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Paid in Full
                      </span>
                    </div>
                  </div>

                  <div className="px-4 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center font-mono font-bold text-xs shrink-0">
                        INV
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-teal-800">
                            INV-2026-0841
                          </span>
                          <span className="text-[10px] text-content-muted font-mono">
                            Yesterday, 4:15 PM
                          </span>
                        </div>
                        <p className="font-semibold text-[#142B4D] text-xs">
                          Kavitha Power & Control Systems
                        </p>
                        <p className="text-content-secondary text-[11px]">
                          Switchgear & Heavy Cables • Interstate IGST
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-[#142B4D] text-sm">₹2,84,200</p>
                      <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                        Partially Paid (₹1.5L Rec.)
                      </span>
                    </div>
                  </div>

                  <div className="px-4 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-sky-50 text-sky-700 flex items-center justify-center font-mono font-bold text-xs shrink-0">
                        INV
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-teal-800">
                            INV-2026-0840
                          </span>
                          <span className="text-[10px] text-content-muted font-mono">
                            Yesterday, 1:40 PM
                          </span>
                        </div>
                        <p className="font-semibold text-[#142B4D] text-xs">
                          Sri Venkateswara Infrastructure
                        </p>
                        <p className="text-content-secondary text-[11px]">
                          Conduits & Lighting Panels • Intra-State (CGST+SGST)
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-[#142B4D] text-sm">₹4,12,000</p>
                      <span className="inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200">
                        Pending Verification
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: INVOICING */}
        {activeTab === "invoicing" && (
          <div className="space-y-4 animate-fade-in">
            <div className="p-4 rounded-xl border border-teal-200 bg-teal-50/50 flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-teal-800">
                  Statutory Tax Invoice Details
                </span>
                <p className="text-sm font-bold text-[#142B4D]">
                  Invoice Number: INV-2026-0842
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-semibold bg-white border border-teal-200 text-teal-800 shadow-2xs">
                  GSTIN: 37AAAAA1234A1Z5
                </span>
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                  ISSUED • STATUTORY COMPLIANT
                </span>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F5F7FA] border-b border-border text-content-secondary font-semibold uppercase tracking-wider">
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
                  <tr className="hover:bg-slate-50 transition-colors">
                    <td className="px-3.5 py-3 font-semibold text-[#142B4D]">
                      Polycab 2.5 sq mm FR-LSH Copper Wire (Red)
                    </td>
                    <td className="px-3 py-3 font-mono text-content-secondary">
                      8544
                    </td>
                    <td className="px-3 py-3 font-bold text-teal-700">
                      10 Coils
                    </td>
                    <td className="px-3 py-3">₹2,450.00</td>
                    <td className="px-3 py-3">18% (₹4,410)</td>
                    <td className="px-3.5 py-3 text-right font-bold text-[#142B4D]">
                      ₹28,910.00
                    </td>
                  </tr>
                  <tr className="hover:bg-slate-50 transition-colors">
                    <td className="px-3.5 py-3 font-semibold text-[#142B4D]">
                      Schneider Acti9 32A TP MCB C-Curve 10kA
                    </td>
                    <td className="px-3 py-3 font-mono text-content-secondary">
                      8536
                    </td>
                    <td className="px-3 py-3 font-bold text-teal-700">
                      25 Nos
                    </td>
                    <td className="px-3 py-3">₹1,180.00</td>
                    <td className="px-3 py-3">18% (₹5,310)</td>
                    <td className="px-3.5 py-3 text-right font-bold text-[#142B4D]">
                      ₹34,810.00
                    </td>
                  </tr>
                  <tr className="hover:bg-slate-50 transition-colors">
                    <td className="px-3.5 py-3 font-semibold text-[#142B4D]">
                      Finolex 1-inch Heavy Gauge PVC Conduit Pipes
                    </td>
                    <td className="px-3 py-3 font-mono text-content-secondary">
                      3917
                    </td>
                    <td className="px-3 py-3 font-bold text-teal-700">
                      15 Bundles
                    </td>
                    <td className="px-3 py-3">₹3,200.00</td>
                    <td className="px-3 py-3">18% (₹8,640)</td>
                    <td className="px-3.5 py-3 text-right font-bold text-[#142B4D]">
                      ₹56,640.00
                    </td>
                  </tr>
                </tbody>
                <tfoot className="bg-[#F5F7FA] font-semibold border-t border-border">
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3.5 py-2.5 text-content-secondary text-right"
                    >
                      Subtotal: ₹1,00,100 • Total GST (9% CGST + 9% SGST): ₹18,018
                    </td>
                    <td
                      colSpan={2}
                      className="px-3.5 py-2.5 text-right text-sm font-extrabold text-[#142B4D]"
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
                <span className="font-bold text-[#142B4D]">
                  Filter By Category:
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-teal-50 text-teal-800 border border-teal-200 font-semibold">
                  Wires & Cables (428)
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-[#F5F7FA] text-content-secondary border border-border">
                  Switchgear (312)
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-[#F5F7FA] text-content-secondary border border-border">
                  Conduits (95)
                </span>
              </div>
              <span className="text-content-muted font-medium">
                Physical Unit Integrity Enforced
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F5F7FA] border-b border-border text-content-secondary uppercase font-semibold">
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
                  <tr className="hover:bg-slate-50 transition-colors">
                    <td className="px-3.5 py-3 font-mono font-bold text-teal-800">
                      WIR-POL-2.5-RD
                    </td>
                    <td className="px-3 py-3 font-semibold text-[#142B4D]">
                      Polycab 2.5mm Wire (Red 90m)
                    </td>
                    <td className="px-3 py-3">Coils</td>
                    <td className="px-3 py-3 font-extrabold text-[#142B4D]">
                      148
                    </td>
                    <td className="px-3 py-3 text-content-secondary">
                      20 Coils
                    </td>
                    <td className="px-3.5 py-3 text-right">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        In Stock
                      </span>
                    </td>
                  </tr>
                  <tr className="hover:bg-slate-50 transition-colors">
                    <td className="px-3.5 py-3 font-mono font-bold text-teal-800">
                      MCB-SCH-32-TP
                    </td>
                    <td className="px-3 py-3 font-semibold text-[#142B4D]">
                      Schneider Acti9 32A 3-Pole MCB
                    </td>
                    <td className="px-3 py-3">Nos</td>
                    <td className="px-3 py-3 font-extrabold text-amber-600">8</td>
                    <td className="px-3 py-3 text-content-secondary">5 Nos</td>
                    <td className="px-3.5 py-3 text-right">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                        Reorder Recommended
                      </span>
                    </td>
                  </tr>
                  <tr className="hover:bg-slate-50 transition-colors">
                    <td className="px-3.5 py-3 font-mono font-bold text-teal-800">
                      CND-FIN-25-HV
                    </td>
                    <td className="px-3 py-3 font-semibold text-[#142B4D]">
                      Finolex 25mm Heavy Conduit
                    </td>
                    <td className="px-3 py-3">Bundles</td>
                    <td className="px-3 py-3 font-extrabold text-[#142B4D]">
                      85
                    </td>
                    <td className="px-3 py-3 text-content-secondary">
                      15 Bundles
                    </td>
                    <td className="px-3.5 py-3 text-right">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
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
              <div className="p-3.5 rounded-xl border border-border bg-[#F5F7FA]">
                <span className="text-content-secondary font-medium">
                  Total Active Debtors:
                </span>
                <p className="text-lg font-extrabold text-[#142B4D] mt-0.5">
                  32 Accounts
                </p>
              </div>
              <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/50">
                <span className="text-amber-800 font-medium">
                  Overdue (&gt;30 Days):
                </span>
                <p className="text-lg font-extrabold text-amber-700 mt-0.5">
                  ₹1,84,000 (3 Accounts)
                </p>
              </div>
              <div className="p-3.5 rounded-xl border border-teal-200 bg-teal-50/50">
                <span className="text-teal-800 font-medium">
                  Average Collection Period:
                </span>
                <p className="text-lg font-extrabold text-teal-900 mt-0.5">
                  24.5 Days
                </p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F5F7FA] border-b border-border text-content-secondary uppercase font-semibold">
                  <tr>
                    <th className="px-3.5 py-2.5">Customer / Company</th>
                    <th className="px-3 py-2.5">Credit Limit</th>
                    <th className="px-3 py-2.5">Current Balance</th>
                    <th className="px-3 py-2.5">Oldest Due Date</th>
                    <th className="px-3.5 py-2.5 text-right">Credit Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr className="hover:bg-slate-50 transition-colors">
                    <td className="px-3.5 py-3 font-semibold text-[#142B4D]">
                      Gayatri Electrical Contractors
                      <span className="block text-[11px] text-content-secondary font-mono font-normal">
                        GSTIN: 37AAAAA1234A1Z5
                      </span>
                    </td>
                    <td className="px-3 py-3">₹5,00,000</td>
                    <td className="px-3 py-3 font-extrabold text-[#142B4D]">
                      ₹1,42,500
                    </td>
                    <td className="px-3 py-3 text-content-secondary">
                      18 Days Remaining
                    </td>
                    <td className="px-3.5 py-3 text-right">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Healthy (28% Utilized)
                      </span>
                    </td>
                  </tr>
                  <tr className="hover:bg-slate-50 transition-colors">
                    <td className="px-3.5 py-3 font-semibold text-[#142B4D]">
                      Sri Venkateswara Infrastructure
                      <span className="block text-[11px] text-content-secondary font-mono font-normal">
                        GSTIN: 37BBBBB5678B2Z1
                      </span>
                    </td>
                    <td className="px-3 py-3">₹10,00,000</td>
                    <td className="px-3 py-3 font-extrabold text-teal-800">
                      ₹6,85,000
                    </td>
                    <td className="px-3 py-3 text-content-secondary">
                      5 Days Remaining
                    </td>
                    <td className="px-3.5 py-3 text-right">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
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
            <div className="p-4 rounded-xl border border-teal-200 bg-teal-50/50 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-teal-800">
                  One-Click Statutory Export Engine
                </p>
                <p className="text-sm font-bold text-[#142B4D]">
                  Indian Financial Year: FY 2026-27 (April 1 to March 31)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-bold shadow-xs">
                  <Download className="w-3.5 h-3.5" /> Export .XLSX (Multi-Sheet)
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 text-xs">
              <div className="p-3.5 rounded-xl border border-teal-200 bg-teal-50/70">
                <p className="font-bold text-teal-900">
                  Sheet 1: Reconciliation
                </p>
                <p className="text-[11px] text-teal-700 mt-1 leading-relaxed">
                  Recognized revenue vs. non-revenue draft/cancelled separation.
                </p>
              </div>
              <div className="p-3.5 rounded-xl border border-border bg-white shadow-2xs">
                <p className="font-bold text-[#142B4D]">
                  Sheet 2: Invoices
                </p>
                <p className="text-[11px] text-content-secondary mt-1 leading-relaxed">
                  All issued invoices, Place of Supply, and live balance due.
                </p>
              </div>
              <div className="p-3.5 rounded-xl border border-border bg-white shadow-2xs">
                <p className="font-bold text-[#142B4D]">
                  Sheet 3: Products
                </p>
                <p className="text-[11px] text-content-secondary mt-1 leading-relaxed">
                  Billed line items, HSN, quantity, and authoritative tax rates.
                </p>
              </div>
              <div className="p-3.5 rounded-xl border border-border bg-white shadow-2xs">
                <p className="font-bold text-[#142B4D]">
                  Sheet 4: Receipts
                </p>
                <p className="text-[11px] text-content-secondary mt-1 leading-relaxed">
                  Collected payment transactions across RTGS, NEFT, UPI, Cash.
                </p>
              </div>
              <div className="p-3.5 rounded-xl border border-border bg-white shadow-2xs">
                <p className="font-bold text-[#142B4D]">
                  Sheet 5: Allocations
                </p>
                <p className="text-[11px] text-content-secondary mt-1 leading-relaxed">
                  Exact cross-period settlement links per customer receipt.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Info Stripe */}
      <div className="px-4 sm:px-6 py-2.5 bg-[#F5F7FA] border-t border-border flex flex-wrap items-center justify-between gap-2 text-[11px] text-content-secondary">
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span>
            Zero redundant queries • Server-side bounded pagination • Immutable GST snapshots
          </span>
        </span>
        <span className="font-mono text-teal-800 font-semibold">
          Production Database Architecture v0.2.0
        </span>
      </div>
    </div>
  );
}
