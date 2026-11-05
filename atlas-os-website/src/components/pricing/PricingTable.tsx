import { useState } from "react";
import { Check, X, Sparkles, ArrowRight, ShieldCheck } from "lucide-react";
import { PRICING_TIERS } from "../../data/pricing";

export default function PricingTable() {
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">(
    "monthly",
  );

  return (
    <div className="space-y-12">
      {/* Billing Interval Selector */}
      <div className="flex flex-col items-center justify-center space-y-3">
        <div className="p-1 rounded-2xl bg-surface-secondary border border-border inline-flex items-center gap-1 shadow-2xs">
          <button
            type="button"
            onClick={() => setBillingCycle("monthly")}
            className={`px-5 py-2 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer ${
              billingCycle === "monthly"
                ? "bg-brand-600 text-white shadow-sm"
                : "text-content-secondary hover:text-content-primary"
            }`}
          >
            Monthly Billing
          </button>
          <button
            type="button"
            onClick={() => setBillingCycle("annual")}
            className={`px-5 py-2 rounded-xl text-xs font-semibold transition-all duration-200 cursor-pointer flex items-center gap-1.5 ${
              billingCycle === "annual"
                ? "bg-brand-600 text-white shadow-sm"
                : "text-content-secondary hover:text-content-primary"
            }`}
          >
            <span>Annual Billing</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
              Save 20% on Launch
            </span>
          </button>
        </div>

        <p className="text-xs text-content-secondary text-center">
          Transparent wholesale pricing • 7-day complimentary commercial trial •
          Zero initial credit card required
        </p>
      </div>

      {/* Pricing Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
        {PRICING_TIERS.map((tier) => (
          <div
            key={tier.id}
            className={`rounded-3xl flex flex-col justify-between transition-all duration-200 relative ${
              tier.isFeatured
                ? "border-2 border-brand-500 bg-white shadow-glow-lg -translate-y-1"
                : "border border-border bg-white shadow-md hover:shadow-lg"
            }`}
          >
            {tier.isFeatured && (
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-brand-600 text-white text-xs font-bold uppercase tracking-wider shadow-sm flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                <span>{tier.badge}</span>
              </div>
            )}

            <div className="p-6 sm:p-8 space-y-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold font-display text-content-primary">
                    {tier.name}
                  </h3>
                  {!tier.isFeatured && tier.badge && (
                    <span className="px-2.5 py-0.5 rounded-md text-[11px] font-medium bg-surface-secondary text-content-secondary border border-border">
                      {tier.badge}
                    </span>
                  )}
                </div>
                <p className="text-xs text-content-secondary leading-relaxed min-h-[36px]">
                  {tier.tagline}
                </p>
              </div>

              {/* Price Display */}
              <div className="p-4 rounded-2xl bg-surface-secondary border border-border space-y-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-brand-700 font-display">
                  {tier.statusText}
                </span>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-extrabold font-display text-content-primary">
                    {tier.priceDisplay}
                  </span>
                </div>
                <span className="text-[11px] text-content-muted block">
                  {tier.billingPeriod}
                </span>
              </div>

              {/* Features List */}
              <div className="space-y-3 pt-2">
                <p className="text-xs font-bold uppercase tracking-wider text-content-primary font-display">
                  Included Capabilities:
                </p>
                <ul className="space-y-2.5 text-xs">
                  {tier.features.map((feat, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      {feat.included ? (
                        <div className="w-4 h-4 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center shrink-0 mt-0.5">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </div>
                      ) : (
                        <div className="w-4 h-4 rounded-full bg-surface-secondary text-content-muted flex items-center justify-center shrink-0 mt-0.5">
                          <X className="w-3 h-3" />
                        </div>
                      )}
                      <span
                        className={
                          feat.included
                            ? "text-content-primary"
                            : "text-content-muted line-through"
                        }
                      >
                        {feat.name}
                        {feat.note && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                            {feat.note}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Card CTA Footer */}
            <div className="p-6 sm:p-8 pt-0 border-t border-border/50 mt-6">
              <a
                href={tier.ctaHref}
                className={`w-full h-11 rounded-xl text-xs font-bold font-display flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer shadow-sm ${
                  tier.isFeatured
                    ? "bg-brand-600 hover:bg-brand-700 text-white shadow-glow"
                    : "bg-surface-secondary hover:bg-surface-tertiary text-content-primary border border-border"
                }`}
              >
                <span>{tier.ctaText}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        ))}
      </div>

      {/* Trial & Guarantee Banner */}
      <div className="p-6 sm:p-8 rounded-3xl border border-border bg-surface-secondary flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-2xl bg-brand-100 text-brand-700 shrink-0">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h4 className="text-base font-bold font-display text-content-primary">
              Our 7-Day Commercial Integrity Promise
            </h4>
            <p className="text-xs text-content-secondary leading-relaxed max-w-2xl">
              Distributors operate on trust. When Atlas OS launches publicly,
              your business receives a 7-day full-access trial to verify
              inventory accuracy, contractor receivables, and Excel reporting
              with zero card details required.
            </p>
          </div>
        </div>

        <a
          href="/request-demo"
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-white border border-brand-200 text-brand-700 text-xs font-bold font-display hover:bg-brand-50 transition-colors shadow-2xs shrink-0"
        >
          <span>Schedule Demo Today</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}
