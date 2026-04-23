-- ============================================================
-- TORO MOVERS CRM v2 — activity_log insert-policy tightening
--                      + customer lookup indexes
-- ============================================================
-- Audit (2026-04-23) HIGH: the old activity_insert policy allowed
-- any authenticated user to insert rows with arbitrary entity_type
-- / entity_id / event_type / payload / actor_id. A rogue session
-- (or a disgruntled user) could forge "deposit_paid" or
-- "booking_confirmation_resent" entries, poisoning the timeline
-- that ops relies on to reconstruct what happened.
--
-- Fix: only server-side (service_role) inserts allowed. All our
-- Netlify functions use the service role via SUPABASE_SERVICE_ROLE_KEY,
-- which bypasses RLS — unchanged. Client-side direct inserts from
-- the browser (which shouldn't be happening anyway) are blocked.
--
-- Also: the audit flagged missing indexes on customers.phone and
-- customers.email. backfill-deposits + crew-apply do in-memory joins
-- against these columns, and lead-creation bridges dedupe by them.
-- Added partial indexes (only non-null) to keep them small.
--
-- Safe to re-run.
-- ============================================================

-- 1. Lock down activity_log inserts to server-side (service_role) only.
--    Service role bypasses RLS, so existing Netlify function inserts
--    are unaffected. A direct anon/authenticated INSERT from the
--    browser will now be denied.
drop policy if exists activity_insert on public.activity_log;
create policy activity_insert_server_only on public.activity_log for insert
  to service_role
  with check (true);

-- 2. Read policy stays the same — admins/staff need to see the timeline.
--    Already exists as activity_read; leave alone.

-- 3. Customer lookup indexes. Partial (where non-null) keeps them tight;
--    most rows have either email or phone, rarely both missing.
create index if not exists customers_phone_idx
  on public.customers (phone)
  where phone is not null;

create index if not exists customers_email_idx
  on public.customers (lower(email))
  where email is not null;

-- 4. Leads → stage index is already present (001_init.sql line 125).
--    Adding a lightweight index on leads(customer_id) to speed up the
--    "find the lead for this Stripe session's customer" joins that
--    backfill-deposits + the CRM v2 bridge do.
create index if not exists leads_customer_id_idx on public.leads (customer_id);

notify pgrst, 'reload schema';
