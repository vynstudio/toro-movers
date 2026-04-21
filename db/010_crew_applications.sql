-- ============================================================
-- TORO MOVERS CRM v2 — Crew applications
-- ============================================================
-- Stores applications from movers/crews who want to partner with Toro.
-- Collects the basics a background-check vendor (Checkr, GoodHire,
-- Sterling) needs to initiate a report — but NOT SSN. The applicant
-- gives SSN directly to the vendor in a later step to minimize our
-- PII exposure.
--
-- RLS: admin and dispatch roles only. Public inserts go through the
-- crew-apply Netlify function using the service role key.
--
-- Already applied via inline DDL. Safe to re-run.
-- ============================================================

do $$ begin
  create type crew_application_status as enum ('new', 'reviewing', 'approved', 'rejected', 'withdrawn');
exception when duplicate_object then null; end $$;

create table if not exists public.crew_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status crew_application_status not null default 'new',

  -- Personal
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text not null,
  dob date,
  address text,
  city text,
  state text,
  zip text,

  -- Business
  company_name text,

  -- ID for background check
  drivers_license_number text,
  dl_state text,
  dl_expiration date,

  -- Experience
  years_experience int,
  team_size int,
  bilingual boolean default false,
  has_truck boolean default false,
  truck_size text,

  -- Coverage + bio
  service_zones service_zone[] default '{}',
  about text,
  references_text text,

  -- Consent (FCRA)
  background_consent boolean not null,
  consent_ip text,
  consent_ua text,

  -- Review
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text
);

create index if not exists crew_apps_status_idx on public.crew_applications(status, created_at desc);

alter table public.crew_applications enable row level security;

drop policy if exists crew_apps_admin_all on public.crew_applications;
create policy crew_apps_admin_all on public.crew_applications for all
  using (public.current_user_role() in ('admin','dispatch'))
  with check (public.current_user_role() in ('admin','dispatch'));
