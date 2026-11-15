import { supabase } from '@/lib/supabase';
import { toPaise } from '@/lib/money';

export const staffPageSize = 25;
export const payBases = {
  monthly: 'Monthly salary',
  daily: 'Daily rate',
  hourly: 'Hourly rate',
} as const;
export type PayBasis = keyof typeof payBases;
export interface StaffLocation { id: string; name: string }
export interface StaffProfile {
  id: string;
  display_name: string;
  joining_on: string;
  staff_location_assignments: Array<{ location_id: string }>;
}
export interface StaffPayRate { effective_on: string; basis: PayBasis; amount_paise: number }

function cloud() {
  if (!supabase) throw new Error('Sign in to a cloud workspace to manage staff pay.');
  return supabase;
}

export function parseStaffPayAmount(input: string): number {
  const value = input.trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(value) || Number(value) <= 0) {
    throw new Error('Enter a positive pay rate with up to two decimal places.');
  }
  return toPaise(Number(value));
}

export const staffPayService = {
  async listLocations(orgId: string): Promise<StaffLocation[]> {
    const locations: StaffLocation[] = [];
    const pageSize = 100;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await cloud().from('staff_locations').select('id,name')
        .eq('organization_id', orgId).order('name').order('id').range(offset, offset + pageSize - 1);
      if (error) throw new Error('Could not load work locations.');
      locations.push(...data);
      if (data.length < pageSize) return locations;
    }
  },

  async listStaff(orgId: string, page: number): Promise<{ rows: StaffProfile[]; count: number }> {
    const from = page * staffPageSize;
    const { data, error, count } = await cloud().from('staff_profiles')
      .select('id,display_name,joining_on,staff_location_assignments(location_id)', { count: 'exact' })
      .eq('organization_id', orgId).order('display_name').order('id').range(from, from + staffPageSize - 1);
    if (error || count === null) throw new Error('Could not load staff profiles.');
    return { rows: data, count };
  },

  async listRates(orgId: string, staffId: string, today: string, page: number) {
    function rates() {
      return cloud().from('staff_pay_rates').select('effective_on,basis,amount_paise', { count: 'exact' })
        .eq('organization_id', orgId).eq('staff_id', staffId).order('effective_on', { ascending: false });
    }
    const from = page * staffPageSize;
    const [history, current] = await Promise.all([
      rates().range(from, from + staffPageSize - 1),
      rates().lte('effective_on', today).limit(1).maybeSingle<StaffPayRate>(),
    ]);
    if (history.error || history.count === null || current.error) throw new Error('Could not load pay rates.');
    return { rows: history.data as StaffPayRate[], count: history.count, current: current.data };
  },

  async addLocation(orgId: string, name: string) {
    const label = name.trim();
    const { error } = await cloud().from('staff_locations').insert({
      id: crypto.randomUUID(), organization_id: orgId, name: label,
    });
    if (error?.code === '23505') throw new Error('A work location with this name already exists.');
    if (error) throw new Error('Could not add the location. Refresh the list before retrying.');
  },

  async addStaff(orgId: string, id: string, name: string, joiningOn: string, locations: string[]) {
    const { error } = await cloud().rpc('add_staff_profile', {
      p_org_id: orgId, p_staff_id: id, p_name: name.trim(), p_joining_on: joiningOn, p_location_ids: locations,
    });
    if (error) throw new Error('Could not save this staff profile. Check the name, date, and locations, then retry.');
  },

  async assignLocation(orgId: string, staffId: string, locationId: string) {
    const { error } = await cloud().from('staff_location_assignments').upsert({
      organization_id: orgId, staff_id: staffId, location_id: locationId,
    }, { ignoreDuplicates: true, onConflict: 'organization_id,staff_id,location_id' });
    if (error) throw new Error('Could not assign the location.');
  },

  async addRate(orgId: string, staff: StaffProfile, effectiveOn: string, basis: PayBasis, amountPaise: number) {
    const { error } = await cloud().from('staff_pay_rates').insert({
      organization_id: orgId, staff_id: staff.id, joining_on: staff.joining_on,
      effective_on: effectiveOn, basis, amount_paise: amountPaise,
    });
    if (error?.code === '23505') {
      const { data } = await cloud().from('staff_pay_rates').select('basis,amount_paise')
        .eq('organization_id', orgId).eq('staff_id', staff.id).eq('effective_on', effectiveOn).maybeSingle();
      if (data?.basis === basis && data.amount_paise === amountPaise) return;
      throw new Error('A different pay rate already exists for this effective date.');
    }
    if (error) throw new Error('Could not save the pay rate. Check that the effective date is on or after joining.');
  },
};
