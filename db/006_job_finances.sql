-- ============================================================
-- TORO MOVERS CRM v2 — Job finances (tips + expenses)
-- ============================================================
-- Adds columns so a completed job can track the full P&L:
--   customer_total   — invoiced to customer (unchanged)
--   tip_amount       — customer tip, pass-through to crew (NEW)
--   sub_payout_flat  — crew hourly payout (rate × movers × hours) — existing
--   sub_bonus        — crew bonus on top of hourly — existing
--   expenses         — truck rental, fuel, materials not invoiced (NEW)
--   internal_cost_total — sub_payout_flat + sub_bonus + expenses (computed in app)
--   margin           — customer_total − internal_cost_total (computed in app)
--   (tip is NOT in margin math — it's a customer-to-crew pass-through)
--
-- Safe to re-run.
-- ============================================================

alter table public.jobs add column if not exists tip_amount numeric(10,2) default 0;
alter table public.jobs add column if not exists expenses numeric(10,2) default 0;
