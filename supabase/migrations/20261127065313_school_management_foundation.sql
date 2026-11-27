-- School is an opt-in organization category. Commit its enum before core RPCs use it.
ALTER TYPE public.business_category_type ADD VALUE IF NOT EXISTS 'school';
