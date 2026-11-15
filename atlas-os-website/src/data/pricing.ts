import type { PricingTier } from '../types';

export const PRICING_TIERS: PricingTier[] = [
  {
    id: 'starter',
    name: 'Atlas Starter',
    description: 'For a shop that needs simple stock, sales, and collections.',
    priceDisplay: '₹999',
    billingPeriod: '/ month',
    features: ['Products, stock and customer records', 'Sales orders, invoices and payments', 'Branded customer receipt and daily totals'],
  },
  {
    id: 'professional',
    name: 'Atlas Professional',
    description: 'For growing wholesalers, distributors, and busy counters.',
    priceDisplay: '₹2,499',
    billingPeriod: '/ month',
    isFeatured: true,
    features: ['Everything in Starter', 'Purchase orders and supplier follow-up', 'Supplier price history and quote review', 'Customer and counter receipts on one sheet'],
  },
  {
    id: 'enterprise-network',
    name: 'Enterprise Network',
    description: 'For businesses planning a rollout across multiple locations.',
    priceDisplay: 'Custom quote',
    billingPeriod: '',
    features: ['Everything in Professional', 'Customer and counter receipts on one sheet', 'Scoped rollout, training, and integration review'],
  },
];
