import type { PricingTier } from '../types';

export const PRICING_TIERS: PricingTier[] = [
  {
    id: 'starter',
    name: 'Atlas Counter',
    description: 'For shops that bill customers at a counter and reconcile collections at shift close.',
    priceDisplay: '₹999',
    billingPeriod: '/ month',
    features: ['Counter billing with stock and selling price lookup', 'Cash and UPI collections', 'Drawer closing and daily reconciliation', 'Branded customer receipt and daily totals'],
  },
  {
    id: 'professional',
    name: 'Atlas Trade',
    description: 'For wholesalers and distributors managing incoming stock, supplier rates and customer balances.',
    priceDisplay: '₹2,499',
    billingPeriod: '/ month',
    isFeatured: true,
    features: ['Counter billing and collections', 'Notebook-style bulk goods receiving', 'Purchase orders and supplier price history', 'Quotations, outstanding invoices and payments', 'Customer and counter receipts on one sheet'],
  },
  {
    id: 'enterprise-network',
    name: 'Atlas Network',
    description: 'Planned for businesses that need to coordinate stock and approvals across branches.',
    priceDisplay: 'Planned',
    billingPeriod: '',
    features: ['Planned branch stock transfers', 'Planned branch-wise reports and approvals'],
  },
];
