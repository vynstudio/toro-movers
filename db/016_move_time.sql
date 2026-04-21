-- ============================================================
-- TORO MOVERS CRM v2 — move_time column
-- ============================================================
-- Adds time-of-day to leads so the CRM can edit/store the
-- appointment time alongside move_date. The booking trigger
-- that copies lead→job already carries move_date; jobs.move_time
-- (if/when needed) will be added separately.
--
-- Safe to re-run.
-- ============================================================

alter table public.leads add column if not exists move_time time;
