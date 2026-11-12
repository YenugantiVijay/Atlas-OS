import { supabase } from '@/lib/supabase';

export type RateReviewStatus = 'OPEN' | 'REQUESTED' | 'REVIEWED';
export type RateReviewScope = { quotationId: string; rateId?: never } | { rateId: string; quotationId?: never };

export interface QuotationRateImpact {
  quotation_id: string;
  quotation_number: string;
  item_id: string;
  product_name: string;
  rate_id: string;
  supplier_name: string | null;
  previous_cost: number | null;
  current_cost: number | null;
  previous_margin: number | null;
  current_margin: number | null;
  review_status: RateReviewStatus;
}

const requireCloud = () => {
  if (!supabase) throw new Error('Quotation rate reviews require a configured cloud backend.');
  return supabase;
};

export const RATE_REVIEW_PAGE_SIZE = 20;

export const quotationRateReviewService = {
  async list(organizationId: string, scope: RateReviewScope, page: number) {
    const { data, error } = await requireCloud().rpc('list_quotation_rate_impacts', {
      p_org_id: organizationId,
      p_quotation_id: scope.quotationId ?? null,
      p_rate_id: scope.rateId ?? null,
      p_offset: page * RATE_REVIEW_PAGE_SIZE,
    });
    if (error) throw new Error(error.message);
    if (!Array.isArray(data) || data.length > RATE_REVIEW_PAGE_SIZE + 1) {
      throw new Error('Invalid quotation rate review results.');
    }
    return {
      rows: data.slice(0, RATE_REVIEW_PAGE_SIZE) as QuotationRateImpact[],
      hasNext: data.length > RATE_REVIEW_PAGE_SIZE,
    };
  },

  async save(organizationId: string, impact: QuotationRateImpact, status: Exclude<RateReviewStatus, 'OPEN'>) {
    const { data, error } = await requireCloud().rpc('save_quotation_rate_review', {
      p_org_id: organizationId,
      p_quotation_id: impact.quotation_id,
      p_item_id: impact.item_id,
      p_rate_id: impact.rate_id,
      p_status: status,
    });
    if (error) throw new Error(error.message);
    if (data !== 'REQUESTED' && data !== 'REVIEWED') throw new Error('The review was not confirmed.');
    return data;
  },
};
