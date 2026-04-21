-- ============================================================
-- TORO MOVERS CRM v2 — Crew dispatch token
-- ============================================================
-- Per-dispatch random UUID that the crew-response links must carry.
-- Each (re)dispatch regenerates it server-side, so old/forwarded emails
-- stop working once a crew has been re-offered the job.
--
-- Already applied via inline DDL. Safe to re-run.
-- ============================================================

alter table public.jobs add column if not exists crew_dispatch_token uuid;
