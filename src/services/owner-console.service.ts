import { getOwnerSupabase } from '@/lib/owner-supabase';
import type { SupportArea, TicketStatus } from '@/lib/support-reports';

export const EDITIONS = [
  { value: 'starter', label: 'Atlas Counter' },
  { value: 'professional', label: 'Atlas Trade' },
  { value: 'enterprise_network', label: 'Atlas Network' },
] as const;
export type Edition = typeof EDITIONS[number]['value'];
export const editionLabel = (name: string | null) => EDITIONS.find(item => item.value === name)?.label ?? name ?? 'Unassigned';

export interface PurchaseMonth { month: string; purchases: number; revenue: number }
export interface OwnerOverview {
  clients: number;
  active: number;
  open_reports: number;
  urgent_reports: number;
  overdue_reports: number;
  due_renewals: number;
  months: PurchaseMonth[];
  products: { product: Edition; purchases: number; revenue: number }[];
  report_areas: { area: SupportArea; reports: number }[];
  recent_reports: Pick<OwnerTicket, 'id' | 'subject' | 'area' | 'source' | 'priority' | 'created_at'>[];
  updated_at: string;
}
export interface OwnerClient {
  id: string;
  name: string;
  eligibility_status: string;
  declaration_updated_at: string | null;
  business_category: string | null;
  product_lines: string[] | null;
  sells_electrical_products: boolean | null;
  identity_present: boolean;
  plan_tier: string | null;
  subscription_status: string | null;
  subscription_updated_at: string | null;
  trial_ends_at: string | null;
  current_period_ends_at: string | null;
  grace_period_ends_at: string | null;
  last_activity: string | null;
  open_reports: number;
}
export interface OwnerTicket {
  id: string;
  source: 'erp' | 'website';
  area: SupportArea;
  subject: string;
  body: string;
  company: string | null;
  contact_email: string | null;
  client_update: string | null;
  status: TicketStatus;
  priority: 'normal' | 'urgent';
  created_at: string;
  updated_at: string;
}

export interface OwnerPurchase {
  id: string;
  company: string;
  product: Edition;
  amount: number;
  paid_on: string;
  payment_reference: string;
}

type OwnerAction = 'overview' | 'clients' | 'tickets' | 'purchases' | 'record_purchase' | 'set_subscription' | 'update_ticket' | 'review_declaration';
export async function ownerRequest<T>(action: OwnerAction, input: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const request = getOwnerSupabase().rpc('owner_console_request', { p_action: action, p_data: input });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) {
    if (error.code === '42501') throw new Error('Owner access and authenticator verification are required.');
    if (error.code === '40001') throw new Error('This record changed. Close the dialog, refresh the list and try again.');
    if (error.code === '23505') throw new Error('That payment reference is already recorded with different details.');
    if (error.code === '22023') throw new Error(error.message);
    if (error.message.includes('ERR_INVALID_APPROVAL')) throw new Error('This business declaration cannot be approved under the current rules.');
    throw new Error('The request could not be completed. Check the connection and try again.');
  }
  return data as T;
}

export async function generateOwnerSummary(): Promise<string> {
  const { data, error } = await getOwnerSupabase().functions.invoke<{ summary: string }>('owner-report-summary', { body: {} });
  if (error || !data?.summary) {
    const payload = error?.context instanceof Response
      ? await error.context.json().catch(() => null)
      : null;
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'The AI summary service is unavailable.');
  }
  return data.summary;
}
