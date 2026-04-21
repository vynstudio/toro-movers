-- ============================================================
-- TORO MOVERS CRM v2 — Booking trigger (Phase 3d)
-- ============================================================
-- When a lead advances Quoted → Booked, auto-insert a jobs row
-- seeded from the most recent quotes row for that lead.
--
-- Idempotent: if a job already exists for that quote, skip.
-- If no quote exists yet, record an 'booked_without_quote' event
-- instead of failing (lets sales rescue manually).
--
-- Safe to re-run (drops + recreates trigger and function).
-- ============================================================

create or replace function public.create_job_on_booking()
returns trigger language plpgsql security definer as $$
declare
  q record;
begin
  -- Only act on a real stage transition into 'booked' from 'quoted'.
  if old.stage is distinct from new.stage
     and old.stage = 'quoted'
     and new.stage = 'booked' then

    select * into q
      from public.quotes
      where lead_id = new.id
      order by created_at desc
      limit 1;

    if q is null then
      insert into public.activity_log (entity_type, entity_id, actor_id, event_type, payload)
      values ('lead', new.id, auth.uid(), 'booked_without_quote', '{}'::jsonb);
      return new;
    end if;

    -- Dedupe: if a job already exists for this quote, don't create another.
    if exists (select 1 from public.jobs where quote_id = q.id) then
      return new;
    end if;

    insert into public.jobs (
      lead_id, quote_id, customer_id,
      scheduled_date,
      hourly_rate, materials, fees,
      customer_total, deposit_paid, balance_due,
      payment_status
    ) values (
      new.id, q.id, new.customer_id,
      new.move_date,
      q.hourly_rate, 0,
      case when q.truck_included then q.truck_fee else 0 end,
      q.total, 0, q.total,
      'unpaid'
    );

    insert into public.activity_log (entity_type, entity_id, actor_id, event_type, payload)
    values ('lead', new.id, auth.uid(), 'booked',
            jsonb_build_object('quote_id', q.id, 'total', q.total));
  end if;

  return new;
end $$;

drop trigger if exists leads_book_job on public.leads;
create trigger leads_book_job after update on public.leads
  for each row execute function public.create_job_on_booking();

-- ============================================================
-- Verify (manual):
--   update public.leads set stage='quoted' where id = <some lead>;
--   insert into public.quotes (lead_id, type, crew_size, hourly_rate,
--     estimated_hours, truck_included, truck_fee, deposit_amount, total)
--   values (<lead>, 'custom', 2, 75, 4, true, 275, 125, 875);
--   update public.leads set stage='booked' where id = <same lead>;
--   select * from public.jobs where lead_id = <same lead>;
-- ============================================================
