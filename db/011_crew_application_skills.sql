-- ============================================================
-- TORO MOVERS CRM v2 — Crew skills
-- ============================================================
-- Free-text array of skills the crew/applicant is strong at.
-- Known values (UI enforces, DB tolerates anything):
--   loading, unloading, driving, directing, packing, unpacking,
--   assembly_disassembly, organizing_truck
--
-- Added to both crew_applications (from the public form) and crews
-- (carries over when admin approves an application).
--
-- Already applied via inline DDL. Safe to re-run.
-- ============================================================

alter table public.crew_applications add column if not exists skills text[] default '{}';
alter table public.crews add column if not exists skills text[] default '{}';
