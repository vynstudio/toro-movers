-- ============================================================
-- TORO MOVERS CRM v2 — Crew tools
-- ============================================================
-- Tools an applicant owns / has regular access to. Helps dispatch
-- match crews to jobs that need specific equipment.
--
-- Known values (UI constrains, DB tolerates any text):
--   hand_truck, furniture_dolly, blankets, straps, shrink_wrap,
--   tool_kit, wardrobe_boxes, sliders, appliance_dolly
--
-- Added to both crew_applications and crews so it carries over on
-- approval.
--
-- Already applied via inline DDL. Safe to re-run.
-- ============================================================

alter table public.crew_applications add column if not exists tools text[] default '{}';
alter table public.crews add column if not exists tools text[] default '{}';
