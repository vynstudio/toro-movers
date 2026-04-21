-- ============================================================
-- TORO MOVERS CRM v2 — Crew service zones
-- ============================================================
-- Each crew can cover multiple service_zone values (the same enum
-- already used on public.leads.from_zone / to_zone). Used in the CRM
-- to filter which crews are relevant for a given lead.
--
-- Already applied via inline DDL. Safe to re-run.
-- ============================================================

alter table public.crews add column if not exists service_zones service_zone[] default '{}';
