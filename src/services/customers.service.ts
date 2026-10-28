import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';
import { Customer } from '@/types';
import { calculateInvoiceBalance, roundMoney } from '@/lib/money';

export function mapDbCustomer(row: any, currentReceivable: number = 0): Customer {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    companyName: row.company_name || undefined,
    phone: row.phone || undefined,
    email: row.email || undefined,
    billingAddress: row.billing_address || undefined,
    deliveryAddress: row.delivery_address || undefined,
    gstin: row.gstin || undefined,
    pan: row.pan || undefined,
    creditLimit: Number(row.credit_limit) || 0,
    creditDays: Number(row.credit_days) || 30,
    avatarUrl: undefined,
    isActive: Boolean(row.is_active),
    currentReceivable,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const customersService = {
  async getCustomers(orgId: string, isMockAuth: boolean = false): Promise<Customer[]> {
    if (isMockAuth || !supabase) {
      return storage.getCustomers(orgId);
    }

    const { data: dbCustomers, error } = await supabase
      .from('customers')
      .select('*')
      .eq('organization_id', orgId)
      .order('name');

    if (error) {
      throw new Error(`Failed to fetch customers: ${error.message}`);
    }

    if (!dbCustomers || dbCustomers.length === 0) {
      return [];
    }

    // Calculate customer receivables from invoices
    const { data: invoices, error: invErr } = await supabase
      .from('invoices')
      .select('customer_id, total_amount, total_paid, status')
      .eq('organization_id', orgId)
      .not('status', 'in', '("PAID","CANCELLED")');

    if (invErr) {
      console.warn('Failed to load customer invoice receivables:', invErr.message);
    }

    const receivableMap: Record<string, number> = {};
    if (!invErr && invoices) {
      for (const inv of invoices) {
        const bal = calculateInvoiceBalance(Number(inv.total_amount) || 0, Number(inv.total_paid) || 0);
        receivableMap[inv.customer_id] = roundMoney((receivableMap[inv.customer_id] || 0) + bal);
      }
    }

    return dbCustomers.map((c) => mapDbCustomer(c, receivableMap[c.id] || 0));
  },

  async createCustomer(
    orgId: string,
    input: Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'organizationId' | 'currentReceivable'>,
    isMockAuth: boolean = false
  ): Promise<Customer> {
    if (isMockAuth || !supabase) {
      return storage.createCustomer(orgId, input);
    }

    const payload = {
      organization_id: orgId,
      name: input.name.trim(),
      company_name: input.companyName?.trim() || null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      billing_address: input.billingAddress?.trim() || null,
      delivery_address: input.deliveryAddress?.trim() || null,
      gstin: input.gstin?.trim() || null,
      pan: input.pan?.trim() || null,
      credit_limit: input.creditLimit || 0,
      credit_days: input.creditDays || 30,
      is_active: input.isActive ?? true,
    };

    const { data, error } = await supabase
      .from('customers')
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create customer: ${error.message}`);
    }

    return mapDbCustomer(data, 0);
  },

  async updateCustomer(
    orgId: string,
    customerId: string,
    updates: Partial<Customer>,
    isMockAuth: boolean = false
  ): Promise<Customer> {
    if (isMockAuth || !supabase) {
      return storage.updateCustomer(orgId, customerId, updates);
    }

    const payload: any = { updated_at: new Date().toISOString() };
    if (updates.name !== undefined) payload.name = updates.name.trim();
    if (updates.companyName !== undefined) payload.company_name = updates.companyName?.trim() || null;
    if (updates.phone !== undefined) payload.phone = updates.phone?.trim() || null;
    if (updates.email !== undefined) payload.email = updates.email?.trim() || null;
    if (updates.billingAddress !== undefined) payload.billing_address = updates.billingAddress?.trim() || null;
    if (updates.deliveryAddress !== undefined) payload.delivery_address = updates.deliveryAddress?.trim() || null;
    if (updates.gstin !== undefined) payload.gstin = updates.gstin?.trim() || null;
    if (updates.pan !== undefined) payload.pan = updates.pan?.trim() || null;
    if (updates.creditLimit !== undefined) payload.credit_limit = updates.creditLimit;
    if (updates.creditDays !== undefined) payload.credit_days = updates.creditDays;
    if (updates.isActive !== undefined) payload.is_active = updates.isActive;

    const { data, error } = await supabase
      .from('customers')
      .update(payload)
      .eq('id', customerId)
      .eq('organization_id', orgId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update customer: ${error.message}`);
    }

    return mapDbCustomer(data, updates.currentReceivable || 0);
  },
};
