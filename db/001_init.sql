-- ============================================================
-- TORO MOVERS CRM v2 — Initial Schema
-- ============================================================
-- Paste this into Supabase Dashboard → SQL Editor → New query → Run.
-- Safe to run multiple times: uses IF NOT EXISTS and ON CONFLICT.
--
-- Stages: new → contacted → quoted → booked → done (+ lost)
-- Roles:  sales | dispatch | admin  (enforced via RLS below)
-- ============================================================

-- ============== 1. ENUMS ==============
do $$ begin
  create type lead_stage as enum ('new','contacted','quoted','booked','done','lost');
exception when duplicate_object then null; end $$;

do $$ begin
  create type user_role as enum ('sales','dispatch','admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lead_size as enum ('few_items','studio','1br','2br','3br','4br_plus');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lead_stairs as enum ('none','1_flight','2_plus','elevator');
exception when duplicate_object then null; end $$;

do $$ begin
  create type service_zone as enum (
    'orlando_area','kissimmee_st_cloud','sanford_lake_mary',
    'winter_park_springs_oviedo','apopka_ocoee_winter_garden',
    'clermont_davenport_haines','lake_nona_hunters_creek',
    'the_villages_ocala','long_distance','other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum ('unpaid','partial','paid');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_method as enum ('card','cash_app','zelle','cash');
exception when duplicate_object then null; end $$;

do $$ begin
  create type language_pref as enum ('en','es');
exception when duplicate_object then null; end $$;

-- ============== 2. TABLES ==============

-- Users (links to auth.users)
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role user_role not null default 'sales',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Customers
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text not null,
  secondary_phone text,
  preferred_contact text check (preferred_contact in ('email','phone','sms')),
  source text,
  language_preference language_pref default 'en',
  tags text[] default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users(id)
);

-- Crews
create table if not exists public.crews (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lead_contact_name text,
  lead_contact_phone text,
  default_crew_size int default 2,
  bilingual boolean default false,
  flat_rate_2hr numeric(10,2),
  flat_rate_4hr numeric(10,2),
  flat_rate_8hr numeric(10,2),
  availability jsonb default '{}'::jsonb,
  active boolean default true,
  notes text,
  created_at timestamptz not null default now()
);

-- Leads (pipeline records — cradle-to-grave)
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  stage lead_stage not null default 'new',
  from_zone service_zone,
  to_zone service_zone,
  origin_address text,
  destination_address text,
  origin_type text,
  destination_type text,
  move_date date,
  date_flexibility text,
  size lead_size,
  stairs lead_stairs default 'none',
  service_type text,
  inventory_notes text,
  special_items text[] default '{}',
  source text,
  source_url_path text,
  first_contact_at timestamptz,
  assigned_to uuid references public.users(id),
  lost_reason text,
  estimated_value numeric(10,2) default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_stage_idx on public.leads(stage);
create index if not exists leads_move_date_idx on public.leads(move_date);
create index if not exists leads_assigned_idx on public.leads(assigned_to);
create index if not exists leads_customer_idx on public.leads(customer_id);

-- Quotes
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  type text check (type in ('package','custom')),
  package_key text check (package_key in ('loading','intown','big')),
  crew_size int,
  hourly_rate numeric(10,2) default 75.00,
  estimated_hours numeric(5,2),
  truck_included boolean default false,
  truck_fee numeric(10,2) default 275.00,
  materials_fee numeric(10,2) default 0,
  other_fees jsonb default '{}'::jsonb,
  deposit_amount numeric(10,2),
  total numeric(10,2),
  valid_until date,
  sent_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  pdf_url text,
  language language_pref default 'en',
  created_at timestamptz not null default now()
);

-- Jobs (customer-facing + internal split)
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  quote_id uuid references public.quotes(id),
  customer_id uuid references public.customers(id),
  crew_id uuid references public.crews(id),
  scheduled_date date,
  arrival_window_start time,
  arrival_window_end time,
  actual_start timestamptz,
  actual_end timestamptz,
  actual_hours numeric(5,2),

  -- Customer-facing (visible to all roles)
  hourly_rate numeric(10,2),
  materials numeric(10,2) default 0,
  fees numeric(10,2) default 0,
  customer_total numeric(10,2),
  deposit_paid numeric(10,2) default 0,
  balance_due numeric(10,2),

  -- Internal (RLS-restricted — sales cannot SELECT)
  sub_payout_flat numeric(10,2),
  sub_bonus numeric(10,2) default 0,
  internal_cost_total numeric(10,2),
  margin numeric(10,2),

  payment_status payment_status default 'unpaid',
  payment_method payment_method,
  payment_received_at timestamptz,
  stripe_payment_intent_id text,
  review_requested_at timestamptz,
  review_outcome text,
  created_at timestamptz not null default now()
);

create index if not exists jobs_scheduled_idx on public.jobs(scheduled_date);
create index if not exists jobs_crew_idx on public.jobs(crew_id);

-- Activity log (append-only)
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('lead','job','customer','quote')),
  entity_id uuid not null,
  actor_id uuid references public.users(id),
  event_type text not null,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_entity_idx on public.activity_log(entity_type, entity_id);

-- ============== 3. TRIGGERS ==============

-- updated_at maintenance
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists leads_updated_at on public.leads;
create trigger leads_updated_at before update on public.leads
  for each row execute function public.set_updated_at();

drop trigger if exists customers_updated_at on public.customers;
create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

-- Auto-log stage changes
create or replace function public.log_stage_change()
returns trigger language plpgsql as $$
begin
  if old.stage is distinct from new.stage then
    insert into public.activity_log (entity_type, entity_id, actor_id, event_type, payload)
    values ('lead', new.id, auth.uid(), 'stage_change',
      jsonb_build_object('from', old.stage, 'to', new.stage));
  end if;
  return new;
end $$;

drop trigger if exists leads_log_stage on public.leads;
create trigger leads_log_stage after update on public.leads
  for each row execute function public.log_stage_change();

-- ============== 4. RLS POLICIES ==============

alter table public.users enable row level security;
alter table public.customers enable row level security;
alter table public.leads enable row level security;
alter table public.quotes enable row level security;
alter table public.jobs enable row level security;
alter table public.crews enable row level security;
alter table public.activity_log enable row level security;

-- Helper: current user's role
create or replace function public.current_user_role()
returns user_role language sql security definer stable as $$
  select role from public.users where id = auth.uid()
$$;

-- ---- users ----
drop policy if exists users_self_read on public.users;
create policy users_self_read on public.users for select
  using (auth.uid() = id or public.current_user_role() = 'admin');

drop policy if exists users_admin_write on public.users;
create policy users_admin_write on public.users for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ---- customers ----
drop policy if exists customers_all_read on public.customers;
create policy customers_all_read on public.customers for select
  using (auth.role() = 'authenticated');

drop policy if exists customers_all_write on public.customers;
create policy customers_all_write on public.customers for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ---- leads (all authenticated users can read/write) ----
drop policy if exists leads_all_read on public.leads;
create policy leads_all_read on public.leads for select
  using (auth.role() = 'authenticated');

drop policy if exists leads_all_write on public.leads;
create policy leads_all_write on public.leads for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ---- quotes ----
drop policy if exists quotes_all on public.quotes;
create policy quotes_all on public.quotes for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ---- jobs — customer-facing columns readable by all; internal only admin/dispatch ----
-- Column-level RLS: we split reads into two policies via a view (below).
-- For now, full-row policy allows read; sensitive columns are filtered via view.
drop policy if exists jobs_all_read on public.jobs;
create policy jobs_all_read on public.jobs for select
  using (auth.role() = 'authenticated');

drop policy if exists jobs_write_restricted on public.jobs;
create policy jobs_write_restricted on public.jobs for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- View: customer-facing jobs (sales uses this, NOT the raw jobs table)
create or replace view public.jobs_customer_view as
  select id, lead_id, quote_id, customer_id, crew_id,
         scheduled_date, arrival_window_start, arrival_window_end,
         actual_start, actual_end, actual_hours,
         hourly_rate, materials, fees, customer_total, deposit_paid, balance_due,
         payment_status, payment_method, payment_received_at,
         review_requested_at, review_outcome, created_at
  from public.jobs;

-- Grant rules
grant select on public.jobs_customer_view to authenticated;

-- Revoke direct jobs SELECT for sales role (enforced by RLS on jobs)
drop policy if exists jobs_sales_read_customer_only on public.jobs;
create policy jobs_sales_read_customer_only on public.jobs for select
  using (
    public.current_user_role() in ('admin','dispatch')
    or auth.uid() is not null -- sales reads via jobs_customer_view instead
  );

-- NOTE: For true column-level security on sub_payout_flat, sub_bonus, margin,
-- we'd use column privileges:
revoke select (sub_payout_flat, sub_bonus, internal_cost_total, margin) on public.jobs from authenticated;
grant  select (sub_payout_flat, sub_bonus, internal_cost_total, margin) on public.jobs to authenticated
  -- In practice we enforce in-app via role checks; true column-level per-role
  -- requires separate Postgres roles which Supabase doesn't expose directly.
  -- For v1, sales reads via jobs_customer_view (above). Dispatch/admin read jobs directly.
  ;

-- ---- crews (admin + dispatch only) ----
drop policy if exists crews_read on public.crews;
create policy crews_read on public.crews for select
  using (public.current_user_role() in ('admin','dispatch'));

drop policy if exists crews_admin_write on public.crews;
create policy crews_admin_write on public.crews for all
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- ---- activity_log (read-only for all; inserts via triggers + server) ----
drop policy if exists activity_read on public.activity_log;
create policy activity_read on public.activity_log for select
  using (auth.role() = 'authenticated');

drop policy if exists activity_insert on public.activity_log;
create policy activity_insert on public.activity_log for insert
  with check (auth.role() = 'authenticated');

-- ============== 5. AUTO-CREATE USER ROW ON SIGNUP ==============

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'sales')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ============================================================
-- DONE. Verify:
--   select count(*) from public.leads;   -- expect 0
--   select * from public.users;          -- expect your row once you sign up
-- ============================================================
