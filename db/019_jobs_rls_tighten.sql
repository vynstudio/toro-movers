-- ============================================================
-- TORO MOVERS CRM v2 — tighten jobs RLS
-- ============================================================
-- Audit (2026-04-23) flagged this: the old policies on public.jobs
-- granted SELECT to any authenticated user, not just admin/dispatch.
-- That leaked crew payouts (sub_payout_flat, sub_bonus),
-- internal_cost_total, and margin to sales staff even though the
-- schema comment claimed "sales reads via jobs_customer_view instead".
-- The revoke/grant on specific columns only works at the Postgres-
-- role level, which Supabase doesn't split per user — so sales WAS
-- able to SELECT those columns from the raw table.
--
-- This migration drops both permissive policies and replaces them
-- with admin/dispatch-only SELECT + write. Sales keeps access to
-- public.jobs_customer_view (sanitized columns, granted separately).
--
-- Safe to re-run.
-- ============================================================

-- Drop the two overlapping permissive SELECT policies.
drop policy if exists jobs_all_read on public.jobs;
drop policy if exists jobs_sales_read_customer_only on public.jobs;

-- New read policy — admin/dispatch only.
create policy jobs_staff_read on public.jobs for select
  using (public.current_user_role() in ('admin','dispatch'));

-- Tighten writes from "any authenticated" to admin/dispatch. Sales
-- has never needed to mutate jobs directly.
drop policy if exists jobs_write_restricted on public.jobs;
create policy jobs_staff_write on public.jobs for all
  using (public.current_user_role() in ('admin','dispatch'))
  with check (public.current_user_role() in ('admin','dispatch'));

-- jobs_customer_view already has security_invoker=true (migration 017)
-- and grant select to authenticated. Sales users continue to read via
-- the view, which only exposes customer-facing columns.

notify pgrst, 'reload schema';
