-- ============================================================
-- TORO MOVERS CRM v2 — Structured references on applications
-- ============================================================
-- Replaces the freeform references_text with a structured list of
-- at least 3 references (name + phone + relationship). Also records
-- whether the applicant previously worked at a moving company, so
-- we can enforce "one of the references must be a prior manager" in
-- the apply function.
--
-- references_text is kept for backward compatibility (old rows).
--
-- Already applied via inline DDL. Safe to re-run.
-- ============================================================

alter table public.crew_applications
  add column if not exists references_list jsonb default '[]'::jsonb;

alter table public.crew_applications
  add column if not exists worked_for_moving_co boolean default false;
