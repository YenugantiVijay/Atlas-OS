import { z } from 'zod';
import { supabase } from '@/lib/supabase';

const checkoutRequest = z.object({
  requestId: z.string().min(1),
  shiftId: z.string().min(1),
  customerId: z.string().min(1),
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number().int().positive(),
    unitPrice: z.number().nonnegative(),
    discountPercent: z.number().min(0).max(100),
    taxRate: z.number().nonnegative(),
  })).min(1).max(50),
  tender: z.enum(['CASH', 'UPI']),
  notes: z.string().max(1000).nullable(),
});
export type PendingCounterCheckout = z.infer<typeof checkoutRequest>;

const checkoutResult = z.discriminatedUnion('state', [
  z.object({ state: z.literal('COMPLETED'), invoiceId: z.string().min(1), invoiceNumber: z.string().min(1),
    receiptId: z.string().min(1), receiptNumber: z.string().min(1) }),
  z.object({ state: z.literal('REJECTED'), message: z.string().min(1) }),
]);

export const counterCheckoutService = {
  async complete(orgId: string, checkout: PendingCounterCheckout) {
    if (!supabase) throw new Error('Cloud backend is unavailable.');
    const { data, error } = await supabase.rpc('complete_counter_checkout', {
      p_org_id: orgId,
      p_shift_id: checkout.shiftId,
      p_request_id: checkout.requestId,
      p_customer_id: checkout.customerId,
      p_items: checkout.items,
      p_tender: checkout.tender,
      p_notes: checkout.notes,
    });
    if (error) throw new Error(error.code === 'PGRST202'
      ? 'Paid checkout is unavailable until the workspace update is installed.'
      : 'The server could not confirm this checkout. Retry this saved request to verify its outcome.');
    return checkoutResult.parse(data);
  },
};

// Scope the one unresolved sale to the signed-in operator and workspace.
// Keep the exact request until the workspace confirms its outcome.
export function readPendingCounterCheckout(key: string): PendingCounterCheckout | null {
  const pending = localStorage.getItem(key);
  return pending ? checkoutRequest.parse(JSON.parse(pending)) : null;
}

export function savePendingCounterCheckout(key: string, checkout: PendingCounterCheckout) {
  localStorage.setItem(key, JSON.stringify(checkoutRequest.parse(checkout)));
}

export function clearPendingCounterCheckout(key: string, requestId: string) {
  if (readPendingCounterCheckout(key)?.requestId === requestId) localStorage.removeItem(key);
}
