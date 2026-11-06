import type { PricingTier } from '../types';

/**
 * PUBLIC PRESENTATION ONLY.
 * These are PROPOSED editions, not active billing SKUs or enforced entitlements.
 * Do not convert the workspace navigation preference into a subscription plan.
 */
export const PRICING_TIERS: PricingTier[] = [
  {
    id: 'essentials',
    name: 'Atlas Essentials',
    tagline: 'A simpler way to manage your everyday business.',
    badge: 'For Shops & Small Businesses',
    statusText: 'Plan in Development',
    priceDisplay: 'Pricing to be announced',
    billingPeriod: 'Request a demonstration',
    description:
      'A focused starting point for electrical and hardware shops that need stock, bills, customers and payment records in one place.',
    isFeatured: false,
    features: [
      { name: 'Products, stock and customer records', included: true },
      { name: 'Sales orders and GST-aware invoices', included: true },
      { name: 'Payment recording and receivables', included: true },
      { name: 'Dashboard and everyday reports', included: true },
      { name: 'Reliable data access and permissions', included: true },
    ],
    ctaText: 'Ask About Essentials',
    ctaHref: '/request-demo?tier=essentials',
  },
  {
    id: 'professional',
    name: 'Atlas Professional',
    tagline: 'Deeper controls for growing distributors.',
    badge: 'For Wholesale & Distribution',
    statusText: 'Plan in Development',
    priceDisplay: 'Pricing to be announced',
    billingPeriod: 'Request a demonstration',
    description:
      'For teams that manage quotations, invoice collections, advanced reporting and complex distributor workflows.',
    isFeatured: true,
    features: [
      { name: 'Everything in Essentials', included: true },
      { name: 'Quotations and sales-order workflows', included: true },
      { name: 'Historical Excel financial reports', included: true },
      { name: 'Payment allocations and audit history', included: true },
      { name: 'Advanced purchasing, retail and credit policies', included: false, note: 'Planned' },
      { name: 'AI assistance and WhatsApp automation', included: false, note: 'Planned' },
    ],
    ctaText: 'Ask About Professional',
    ctaHref: '/request-demo?tier=professional',
  },
];
