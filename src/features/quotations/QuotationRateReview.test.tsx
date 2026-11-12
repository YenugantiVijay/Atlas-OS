import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOrg } from '@/features/organizations/OrgContext';
import { useActionPermission } from '@/hooks/useActionPermission';
import { quotationRateReviewService, type QuotationRateImpact } from '@/services/quotation-rate-review.service';
import { QuotationRateReview } from './QuotationRateReview';

vi.mock('@/features/organizations/OrgContext', () => ({ useOrg: vi.fn() }));
vi.mock('@/hooks/useActionPermission', () => ({ useActionPermission: vi.fn() }));
vi.mock('@/services/quotation-rate-review.service', () => ({
  quotationRateReviewService: { list: vi.fn(), save: vi.fn() },
}));

const impact: QuotationRateImpact = {
  quotation_id: 'quotation-1', quotation_number: 'QT-001', item_id: 'line-1',
  product_name: 'Modular Switch', rate_id: 'rate-1', supplier_name: null,
  previous_cost: null, current_cost: null, previous_margin: null, current_margin: null,
  review_status: 'OPEN',
};

describe('quotation rate review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useActionPermission).mockReturnValue({ check: vi.fn().mockReturnValue({ allowed: true }), can: vi.fn() });
  });

  it('lets sales request review without displaying purchase costs or margin', async () => {
    vi.mocked(useOrg).mockReturnValue({ currentRole: 'sales' } as ReturnType<typeof useOrg>);
    vi.mocked(quotationRateReviewService.list).mockResolvedValue({ rows: [impact], hasNext: false });
    vi.mocked(quotationRateReviewService.save).mockResolvedValue('REQUESTED');
    render(<MemoryRouter><QuotationRateReview organizationId="org-1" scope={{ quotationId: 'quotation-1' }} /></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: 'Request review' }));
    expect(quotationRateReviewService.save).toHaveBeenCalledWith('org-1', impact, 'REQUESTED');
    expect(await screen.findByText('Review requested')).toBeInTheDocument();
    expect(screen.queryByText(/Estimated margin|Unit rate/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark reviewed' })).not.toBeInTheDocument();
  });

  it('links affected quotes and shows authorized margin estimates', async () => {
    vi.mocked(useOrg).mockReturnValue({ currentRole: 'owner' } as ReturnType<typeof useOrg>);
    vi.mocked(quotationRateReviewService.list).mockResolvedValue({ rows: [{
      ...impact, supplier_name: 'Atlas Supplier', previous_cost: 120, current_cost: 138,
      previous_margin: 20, current_margin: 8, review_status: 'REQUESTED',
    }], hasNext: false });
    vi.mocked(quotationRateReviewService.save).mockResolvedValue('REVIEWED');
    render(<MemoryRouter><QuotationRateReview organizationId="org-1" scope={{ rateId: 'rate-1' }} /></MemoryRouter>);

    expect(await screen.findByRole('link', { name: 'QT-001' })).toHaveAttribute('href', '/quotations?quotationId=quotation-1');
    expect(screen.getByText('Estimated margin before GST 20% → 8%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));
    expect(await screen.findByText('Reviewed')).toBeInTheDocument();
  });
});
