-- ============================================================
-- TORO MOVERS CRM v2 — Background-check fee on applications
-- ============================================================
-- Applicants pay a $49 bg-check fee via Stripe after submitting the
-- form. The fee is refunded after: (1) they pass the check AND
-- (2) they complete their first Toro job.
--
-- Derived status (in app code):
--   bg_fee_paid_at IS NULL → 'pending'
--   bg_fee_refunded_at IS NOT NULL → 'refunded'
--   bg_fee_paid_at IS NOT NULL AND bg_fee_refunded_at IS NULL → 'paid'
--
-- Already applied via inline DDL. Safe to re-run.
-- ============================================================

alter table public.crew_applications add column if not exists bg_fee_paid_at timestamptz;
alter table public.crew_applications add column if not exists bg_fee_payment_intent_id text;
alter table public.crew_applications add column if not exists bg_fee_stripe_session_id text;
alter table public.crew_applications add column if not exists bg_fee_refunded_at timestamptz;
