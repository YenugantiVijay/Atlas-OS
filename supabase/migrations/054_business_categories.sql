-- Commit new enum values before eligibility functions use them.
ALTER TYPE public.business_category_type ADD VALUE IF NOT EXISTS 'agricultural_inputs';
ALTER TYPE public.business_category_type ADD VALUE IF NOT EXISTS 'general_retail';
ALTER TYPE public.business_category_type ADD VALUE IF NOT EXISTS 'general_wholesale';
ALTER TYPE public.business_category_type ADD VALUE IF NOT EXISTS 'electronics_trade';
ALTER TYPE public.business_category_type ADD VALUE IF NOT EXISTS 'hardware_trade';
