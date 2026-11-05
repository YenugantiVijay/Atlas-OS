import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';
import { Customer, PaginationParams, PaginatedResult } from '@/types';
import { roundMoney } from '@/lib/money';
import { buildPaginatedResult, paginateArray } from '@/lib/pagination';

export function mapDbCustomer(row: any, currentReceivable?: number): Customer {
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
    creditDays: Number(row.credit_days ?? 30),
    avatarUrl: undefined,
    isActive: Boolean(row.is_active),
    currentReceivable: currentReceivable !== undefined ? roundMoney(currentReceivable) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const customersService = {
  async getCustomersPaginated(
    orgId: string,
    params: PaginationParams = {},
    isMockAuth: boolean = false
  ): Promise<PaginatedResult<Customer>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.max(1, Math.min(100, params.pageSize || 25));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    if (isMockAuth) {
      const allCustomers = await storage.getCustomers(orgId);
      return paginateArray(
        allCustomers,
        params,
        (c, s) =>
          c.name.toLowerCase().includes(s) ||
          Boolean(c.companyName && c.companyName.toLowerCase().includes(s)) ||
          Boolean(c.phone && c.phone.toLowerCase().includes(s)) ||
          Boolean(c.email && c.email.toLowerCase().includes(s)) ||
          Boolean(c.gstin && c.gstin.toLowerCase().includes(s)),
        (a, b) => a.name.localeCompare(b.name)
      );
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    let query = supabase
      .from('customers')
      .select('*', { count: 'exact' })
      .eq('organization_id', orgId);

    if (params.search && params.search.trim()) {
      // Sanitize search term to prevent PostgREST grammar breakage
      const s = params.search.trim().replace(/[,()":\\]/g, ' ').trim();
      if (s) {
        query = query.or(`name.ilike.%${s}%,company_name.ilike.%${s}%,phone.ilike.%${s}%,gstin.ilike.%${s}%`);
      }
    }

    if (params.isActive !== undefined) {
      query = query.eq('is_active', params.isActive);
    }

    // Allowlisted sort fields to prevent invalid SQL column errors
    const ALLOWED_CUST_SORT_FIELDS: Record<string, string> = {
      name: 'name',
      companyName: 'company_name',
      phone: 'phone',
      email: 'email',
      gstin: 'gstin',
      createdAt: 'created_at',
    };
    const sortBy = ALLOWED_CUST_SORT_FIELDS[params.sortBy || 'name'] || 'name';
    const ascending = params.sortOrder === 'desc' ? false : true;

    // Deterministic sorting with secondary tie-breaker by primary key id
    query = query.order(sortBy, { ascending }).order('id', { ascending: true }).range(from, to);

    const { data: dbCustomers, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch customers: ${error.message}`);
    }

    const totalCount = count || 0;
    if (!dbCustomers || dbCustomers.length === 0) {
      return buildPaginatedResult([], totalCount, page, pageSize);
    }

    // Page-scoped authoritative customer receivables calculated strictly in PostgreSQL engine
    const pageCustomerIds = dbCustomers.map((c) => c.id);
    let receivables: unknown = null;

    const { data: pageRecv, error: pageRecvErr } = await supabase.rpc('get_page_customer_receivables', {
      p_org_id: orgId,
      p_customer_ids: pageCustomerIds,
    });

    if (pageRecvErr) {
      // Resilient fallback to get_customer_receivables if page RPC is unavailable
      const { data: fallbackRecv, error: fallbackErr } = await supabase.rpc('get_customer_receivables', {
        p_org_id: orgId,
      });
      if (fallbackErr) {
        throw new Error(`Failed to load customer receivables: ${fallbackErr.message}`);
      }
      receivables = fallbackRecv;
    } else {
      receivables = pageRecv;
    }

    const receivableMap = new Map<string, number>();
    if (Array.isArray(receivables)) {
      for (const r of receivables as Array<{ customer_id: string; current_receivable: number | string }>) {
        const parsed = Number(r.current_receivable);
        receivableMap.set(r.customer_id, Number.isFinite(parsed) ? roundMoney(parsed) : 0);
      }
    }

    const mappedCustomers = dbCustomers.map((c) => {
      const receivable = receivableMap.has(c.id) ? receivableMap.get(c.id)! : 0;
      return mapDbCustomer(c, receivable);
    });

    return buildPaginatedResult(mappedCustomers, totalCount, page, pageSize);
  },

  async getCustomerById(orgId: string, customerId: string, isMockAuth: boolean = false): Promise<Customer | null> {
    if (isMockAuth) {
      const cust = storage.getCustomers(orgId).find((c) => c.id === customerId);
      return cust || null;
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
    }

    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('organization_id', orgId)
      .eq('id', customerId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch customer: ${error.message}`);
    }

    if (!data) return null;
    return mapDbCustomer(data);
  },

  async getCustomers(orgId: string, isMockAuth: boolean = false): Promise<Customer[]> {
    if (isMockAuth) {
      return storage.getCustomers(orgId);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
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

    // Authoritative customer receivables calculated strictly in PostgreSQL engine
    const { data: receivables, error: recvErr } = await supabase.rpc('get_customer_receivables', {
      p_org_id: orgId,
    });

    if (recvErr) {
      throw new Error(`Failed to load customer receivables: ${recvErr.message}`);
    }

    if (!Array.isArray(receivables)) {
      throw new Error('Authoritative customer receivables service returned an invalid response structure.');
    }

    const receivableMap = new Map<string, number>();
    for (const r of (receivables as Array<{ customer_id: string; current_receivable: number | string }>)) {
      const parsed = Number(r.current_receivable);
      receivableMap.set(r.customer_id, Number.isFinite(parsed) ? roundMoney(parsed) : 0);
    }

    return dbCustomers.map((c) => {
      // If customer is present in authoritative receivables aggregate, pass its exact value (including zero).
      // If missing from aggregate, pass undefined so callers distinguish missing data from settled zero.
      const receivable = receivableMap.has(c.id) ? receivableMap.get(c.id)! : undefined;
      return mapDbCustomer(c, receivable);
    });
  },

  async createCustomer(
    orgId: string,
    input: Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'organizationId' | 'currentReceivable'>,
    isMockAuth: boolean = false
  ): Promise<Customer> {
    if (isMockAuth) {
      return storage.createCustomer(orgId, input);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
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
      credit_days: input.creditDays ?? 30,
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
    if (isMockAuth) {
      return storage.updateCustomer(orgId, customerId, updates);
    }

    if (!supabase) {
      throw new Error('Cloud backend is not configured: Supabase client is uninitialized.');
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

    return mapDbCustomer(data, updates.currentReceivable);
  },
};
