export const SUPPORT_AREAS = [
  { value: 'general', label: 'General or other' },
  { value: 'orders', label: 'Sales and e-commerce' },
  { value: 'inventory', label: 'Inventory and purchasing' },
  { value: 'billing', label: 'Invoices and GST' },
  { value: 'payments', label: 'Payments and reports' },
  { value: 'account', label: 'Account or subscription' },
  { value: 'website', label: 'Website' },
] as const;
export type SupportArea = typeof SUPPORT_AREAS[number]['value'];
export type TicketStatus = 'open' | 'investigating' | 'resolved';
export const supportAreaLabel = (area: SupportArea) => SUPPORT_AREAS.find(item => item.value === area)?.label ?? area;
export const ticketStatusLabel = { open: 'Open', investigating: 'Investigating', resolved: 'Resolved' } satisfies Record<TicketStatus, string>;
