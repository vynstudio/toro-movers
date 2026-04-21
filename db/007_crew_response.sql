-- ============================================================
-- TORO MOVERS CRM v2 — Crew response status
-- ============================================================
-- Tracks how the crew replied to the dispatch email: accepted,
-- declined, asked for more info, or pending (default).
--
-- Already applied via inline DDL; this file is the canonical record.
-- Safe to re-run.
-- ============================================================

do $$ begin
  create type crew_response_status as enum ('pending', 'accepted', 'declined', 'needs_info');
exception when duplicate_object then null; end $$;

alter table public.jobs add column if not exists crew_response crew_response_status default 'pending';
alter table public.jobs add column if not exists crew_responded_at timestamptz;
alter table public.jobs add column if not exists crew_response_note text;
