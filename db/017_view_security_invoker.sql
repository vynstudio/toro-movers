-- ============================================================
-- TORO MOVERS CRM v2 — fix Security Definer View (advisor)
-- ============================================================
-- Supabase security advisor flagged public.jobs_customer_view as a
-- SECURITY DEFINER view (critical). Postgres 15+ defaults views to
-- run with the privileges of the view creator, which bypasses RLS
-- on the underlying jobs table.
--
-- Fix: recreate the view with security_invoker=true so the calling
-- user's RLS policies apply. jobs already has granular policies
-- (admin/dispatch see everything; sales sees authenticated rows)
-- plus column-level grants that hide sub_payout_flat / sub_bonus /
-- internal_cost_total / margin from non-admin callers — so this
-- change tightens security without changing observed behavior for
-- any current role.
--
-- Safe to re-run.
-- ============================================================

create or replace view public.jobs_customer_view
with (security_invoker = true) as
  select id, lead_id, quote_id, customer_id, crew_id,
         scheduled_date, arrival_window_start, arrival_window_end,
         actual_start, actual_end, actual_hours,
         hourly_rate, materials, fees, customer_total, deposit_paid, balance_due,
         payment_status, payment_method, payment_received_at,
         review_requested_at, review_outcome, created_at
  from public.jobs;

grant select on public.jobs_customer_view to authenticated;
