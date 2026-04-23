-- ============================================================
-- TORO MOVERS CRM v2 — atomic + idempotent deposit / balance apply
-- ============================================================
-- Audit (2026-04-23) flagged _lib/crm-stripe.js as racy: it did a
-- read-modify-write on public.jobs.deposit_paid, so two concurrent
-- Stripe webhook deliveries (retries, live + duplicate events) could
-- both read the same starting value and each write +amountPaid,
-- losing one increment.
--
-- This migration introduces apply_job_payment() — a single SQL call
-- that:
--   1. Short-circuits (returns null) if the exact (job_id, payment_intent)
--      combo is already recorded, giving us webhook idempotency.
--   2. Applies the deposit increment + recomputes balance + status
--      in one UPDATE under row-level locking, so concurrent calls
--      serialize cleanly.
--   3. Returns the new state so the caller can log / notify with
--      authoritative values.
--
-- SECURITY DEFINER so functions calling with the anon/service-role
-- client can invoke it without granting direct UPDATE on jobs.
--
-- Safe to re-run.
-- ============================================================

create or replace function public.apply_job_payment(
  p_job_id uuid,
  p_amount numeric,
  p_payment_intent text,
  p_payment_method payment_method default 'card',
  p_tip_amount numeric default 0
)
returns table (
  job_id uuid,
  deposit_paid numeric,
  balance_due numeric,
  tip_amount numeric,
  payment_status payment_status,
  was_applied boolean
)
language plpgsql
security definer
as $$
declare
  j public.jobs%rowtype;
begin
  -- Lock the row so concurrent invocations serialize.
  select * into j from public.jobs where id = p_job_id for update;
  if not found then
    return query select p_job_id, 0::numeric, 0::numeric, 0::numeric, 'unpaid'::payment_status, false;
    return;
  end if;

  -- Idempotency: same PI already recorded → no-op, return current state.
  if p_payment_intent is not null
     and j.stripe_payment_intent_id is not null
     and j.stripe_payment_intent_id = p_payment_intent then
    return query select j.id, j.deposit_paid, j.balance_due, j.tip_amount, j.payment_status, false;
    return;
  end if;

  -- Apply the increment atomically.
  update public.jobs
    set deposit_paid              = coalesce(deposit_paid, 0) + p_amount,
        tip_amount                = coalesce(tip_amount, 0) + p_tip_amount,
        balance_due               = greatest(0, coalesce(customer_total, 0) - (coalesce(deposit_paid, 0) + p_amount)),
        payment_method            = coalesce(p_payment_method, payment_method),
        payment_status            = case
                                      when greatest(0, coalesce(customer_total, 0) - (coalesce(deposit_paid, 0) + p_amount)) <= 0 then 'paid'::payment_status
                                      when (coalesce(deposit_paid, 0) + p_amount) <= 0 then 'unpaid'::payment_status
                                      else 'partial'::payment_status
                                    end,
        stripe_payment_intent_id  = coalesce(p_payment_intent, stripe_payment_intent_id),
        payment_received_at       = coalesce(payment_received_at, now())
    where id = p_job_id
    returning id, deposit_paid, balance_due, tip_amount, payment_status into j.id, j.deposit_paid, j.balance_due, j.tip_amount, j.payment_status;

  return query select j.id, j.deposit_paid, j.balance_due, j.tip_amount, j.payment_status, true;
end $$;

grant execute on function public.apply_job_payment(uuid, numeric, text, payment_method, numeric) to service_role;

notify pgrst, 'reload schema';
