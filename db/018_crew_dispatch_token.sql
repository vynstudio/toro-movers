-- ============================================================
-- TORO MOVERS CRM v2 — missing crew_dispatch_token column
-- ============================================================
-- Audit (2026-04-23) flagged this: dispatch-crew.js writes
-- jobs.crew_dispatch_token and crm-crew-response.js reads it, but
-- no migration ever declared the column. Writes were silently
-- landing via PostgREST's forgiving schema cache or erroring out
-- depending on the exact state; dispatch emails are unreliable.
--
-- Rotating per-dispatch UUID; response function validates it to
-- prevent cross-job spoofing via a stale link.
--
-- Safe to re-run.
-- ============================================================

alter table public.jobs
  add column if not exists crew_dispatch_token text;

-- Unique where non-null (a job can be redispatched with a new token,
-- but at any moment each active token maps to exactly one job).
drop index if exists jobs_crew_dispatch_token_uniq;
create unique index jobs_crew_dispatch_token_uniq
  on public.jobs (crew_dispatch_token)
  where crew_dispatch_token is not null;

-- PostgREST schema cache reload — makes the column available to functions
-- without a manual dashboard poke.
notify pgrst, 'reload schema';
