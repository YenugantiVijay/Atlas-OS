import { supabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';
import { Supplier } from '@/types';

export function mapDbSupplier(row: any): Supplier {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    companyName: row.company_name || undefined,
    contactPerson: row.contact_person || undefined,
    phone: row.phone || undefined,
    email: row.email || undefined,
    address: row.address || undefined,
    gstin: row.gstin || undefined,
    pan: row.pan || undefined,
    paymentTerms: row.payment_terms || undefined,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const suppliersService = {
  async getSuppliers(orgId: string, isMockAuth: boolean = false): Promise<Supplier[]> {
    if (isMockAuth || !supabase) {
      return storage.getSuppliers(orgId);
    }

    const { data: dbSuppliers, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('organization_id', orgId)
      .order('name');

    if (error) {
      throw new Error(`Failed to fetch suppliers: ${error.message}`);
    }

    return (dbSuppliers || []).map(mapDbSupplier);
  },

  async createSupplier(
    orgId: string,
    input: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt' | 'organizationId'>,
    isMockAuth: boolean = false
  ): Promise<Supplier> {
    if (isMockAuth || !supabase) {
      return storage.createSupplier(orgId, input);
    }

    const payload = {
      organization_id: orgId,
      name: input.name.trim(),
      company_name: input.companyName?.trim() || null,
      contact_person: input.contactPerson?.trim() || null,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
      address: input.address?.trim() || null,
      gstin: input.gstin?.trim() || null,
      pan: input.pan?.trim() || null,
      payment_terms: input.paymentTerms?.trim() || null,
      is_active: input.isActive ?? true,
    };

    const { data, error } = await supabase
      .from('suppliers')
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create supplier: ${error.message}`);
    }

    return mapDbSupplier(data);
  },

  async updateSupplier(
    orgId: string,
    supplierId: string,
    updates: Partial<Supplier>,
    isMockAuth: boolean = false
  ): Promise<Supplier> {
    if (isMockAuth || !supabase) {
      return storage.updateSupplier(orgId, supplierId, updates);
    }

    const payload: any = { updated_at: new Date().toISOString() };
    if (updates.name !== undefined) payload.name = updates.name.trim();
    if (updates.companyName !== undefined) payload.company_name = updates.companyName?.trim() || null;
    if (updates.contactPerson !== undefined) payload.contact_person = updates.contactPerson?.trim() || null;
    if (updates.phone !== undefined) payload.phone = updates.phone?.trim() || null;
    if (updates.email !== undefined) payload.email = updates.email?.trim() || null;
    if (updates.address !== undefined) payload.address = updates.address?.trim() || null;
    if (updates.gstin !== undefined) payload.gstin = updates.gstin?.trim() || null;
    if (updates.pan !== undefined) payload.pan = updates.pan?.trim() || null;
    if (updates.paymentTerms !== undefined) payload.payment_terms = updates.paymentTerms?.trim() || null;
    if (updates.isActive !== undefined) payload.is_active = updates.isActive;

    const { data, error } = await supabase
      .from('suppliers')
      .update(payload)
      .eq('id', supplierId)
      .eq('organization_id', orgId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update supplier: ${error.message}`);
    }

    return mapDbSupplier(data);
  },
};
