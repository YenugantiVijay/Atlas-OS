export const INCOME_TAX_YEARS = [
  {
    id: '2026–27',
    label: 'Tax year 2026–27',
    reference: 'https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf',
  },
  {
    id: '2025–26',
    label: 'FY 2025–26 (AY 2026–27)',
    reference: 'https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-1',
  },
] as const;

export const DEFAULT_TAX_YEAR = INCOME_TAX_YEARS[0].id;
