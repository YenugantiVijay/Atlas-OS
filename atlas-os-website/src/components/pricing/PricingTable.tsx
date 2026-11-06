import { Check, ArrowRight, Sparkles, Info } from "lucide-react";
import { PRICING_TIERS } from "../../data/pricing";

/**
 * Informational edition comparison. No purchase is possible until server-side
 * subscription entitlements, billing and approved prices are implemented.
 */
export default function PricingTable() {
  return (
    <div className="space-y-10">
      <div className="mx-auto max-w-2xl text-center space-y-3">
        <h2 className="text-2xl sm:text-3xl font-bold font-heading text-content-primary">
          Choose the way you want to work
        </h2>
        <p className="text-sm sm:text-base text-content-secondary leading-relaxed">
          Start with everyday business tasks or explore additional distributor workflows.
          Both editions are being prepared for commercial release.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto items-stretch">
        {PRICING_TIERS.map((tier) => (
          <article
            key={tier.id}
            className={`relative rounded-3xl border bg-white shadow-card flex flex-col overflow-hidden ${
              tier.isFeatured ? "border-brand-500 ring-1 ring-brand-100" : "border-border"
            }`}
          >
            <div className="p-6 sm:p-8 flex-1 space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-brand-50 border border-brand-100 px-3 py-1 text-[11px] font-bold text-brand-800">
                  {tier.badge}
                </span>
                {tier.isFeatured && <Sparkles aria-hidden="true" className="w-4 h-4 text-brand-600" />}
              </div>

              <div className="space-y-2">
                <h3 className="text-2xl font-bold font-heading text-content-primary">{tier.name}</h3>
                <p className="text-base font-semibold text-brand-700">{tier.tagline}</p>
                <p className="text-sm leading-relaxed text-content-secondary">{tier.description}</p>
              </div>

              <div className="rounded-2xl bg-surface-secondary border border-border px-5 py-4 space-y-1">
                <span className="text-xs uppercase tracking-wide font-bold text-brand-700">
                  {tier.statusText}
                </span>
                <p className="text-lg font-bold text-content-primary">{tier.priceDisplay}</p>
                <p className="text-sm text-content-secondary">{tier.billingPeriod}</p>
              </div>

              <h4 className="text-sm font-bold text-content-primary">What this edition is designed for</h4>
              <ul className="space-y-3">
                {tier.features.map((feature) => (
                  <li key={feature.name} className="flex items-start gap-3 text-sm leading-relaxed">
                    <span className={`mt-0.5 rounded-full p-1 shrink-0 ${
                      feature.included ? "bg-brand-50 text-brand-700" : "bg-amber-50 text-amber-700"
                    }`}>
                      {feature.included
                        ? <Check aria-hidden="true" className="w-3.5 h-3.5" />
                        : <Info aria-hidden="true" className="w-3.5 h-3.5" />}
                    </span>
                    <span className="text-content-primary">
                      {feature.name}
                      {feature.note && (
                        <span className="ml-2 inline-block rounded bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                          {feature.note}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="p-6 sm:p-8 pt-0">
              <a
                href={tier.ctaHref}
                className={`inline-flex w-full min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-3 font-bold text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
                  tier.isFeatured
                    ? "bg-brand-600 hover:bg-brand-700 text-white"
                    : "bg-surface-secondary hover:bg-brand-50 text-content-primary border border-border"
                }`}
              >
                {tier.ctaText}
                <ArrowRight aria-hidden="true" className="w-4 h-4" />
              </a>
            </div>
          </article>
        ))}
      </div>
      <div className="max-w-5xl mx-auto rounded-2xl border border-brand-200 bg-brand-50 px-5 py-5 text-sm text-content-primary leading-relaxed">
        <strong>Important:</strong> Edition names describe our planned product packaging. Actual pricing, account limits
        and paid feature access are not active yet. The Simple View / Full Navigation switch inside Atlas OS
        changes only the menu layout, not your subscription or permissions.
      </div>
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl border border-border bg-surface-secondary p-6">
        <div>
          <h3 className="text-base font-bold text-content-primary">Managing multiple branches or complex operations?</h3>
          <p className="text-sm text-content-secondary mt-1">Tell us what you need. Enterprise capabilities are being planned separately.</p>
        </div>
        <a className="inline-flex items-center gap-2 font-semibold text-brand-700 hover:text-brand-800" href="/request-demo?tier=enterprise">
          Discuss Your Business <ArrowRight aria-hidden="true" className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}
