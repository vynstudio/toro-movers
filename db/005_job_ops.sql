-- ============================================================
-- TORO MOVERS CRM v2 — Job ops + tasks
-- ============================================================
-- Adds columns and a tasks table so the CRM can:
--   * Record per-job notes + actual crew size + offered crew payout
--   * Dispatch the crew by email (crews.email)
--   * Track tasks per lead, assignable to CRM users
--
-- Safe to re-run.
-- ============================================================

-- Jobs: per-job notes, actual crew size, and the hourly payout offered to the crew.
alter table public.jobs add column if not exists notes text;
alter table public.jobs add column if not exists offered_hourly_rate numeric(10,2);
alter table public.jobs add column if not exists actual_movers int;

-- Crews: email for dispatch notifications.
alter table public.crews add column if not exists email text;

-- Tasks: simple todo list scoped to leads (or standalone if lead_id null).
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  details text,
  lead_id uuid references public.leads(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  assignee_id uuid references public.users(id) on delete set null,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null
);

create index if not exists tasks_open_idx on public.tasks(assignee_id, completed_at) where completed_at is null;
create index if not exists tasks_lead_idx on public.tasks(lead_id);

alter table public.tasks enable row level security;

drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select
  using (auth.role() = 'authenticated');

drop policy if exists tasks_write on public.tasks;
create policy tasks_write on public.tasks for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ============================================================
-- Verify:
--   \d+ public.jobs     -- notes, offered_hourly_rate, actual_movers
--   \d+ public.crews    -- email
--   \d+ public.tasks
-- ============================================================
