-- ============================================================
-- TORO MOVERS CRM v2 — Seed Data (TEST/DEV ONLY)
-- ============================================================
-- Run this in Supabase SQL Editor AFTER 001_init.sql.
-- Creates 12 realistic leads across all 6 stages.
-- Safe to re-run: uses deterministic UUIDs via md5().
-- ============================================================

-- Helper to create a stable UUID from a string
create or replace function public._seed_uuid(s text) returns uuid
  language sql immutable as $$
  select md5(s)::uuid
$$;

-- ============== Customers ==============
insert into public.customers (id, full_name, email, phone, language_preference, source) values
  (public._seed_uuid('cust-sarah'),  'Sarah Chen',     'sarah.c@email.com',   '+13215550142', 'en', 'website'),
  (public._seed_uuid('cust-mike'),   'Mike Ortiz',     'mortiz@email.com',    '+14075550188', 'en', 'website'),
  (public._seed_uuid('cust-patel'),  'J. Patel',       'jp@email.com',        '+13215550177', 'en', 'referral'),
  (public._seed_uuid('cust-maria'),  'Maria Santos',   'maria.s@email.com',   '+14075550201', 'es', 'website'),
  (public._seed_uuid('cust-rivera'), 'Daniel Rivera',  'd.rivera@email.com',  '+13215550155', 'en', 'website'),
  (public._seed_uuid('cust-kelly'),  'Kelly Nguyen',   'kelly.n@email.com',   '+14075550099', 'en', 'website'),
  (public._seed_uuid('cust-alex'),   'Alex Thompson',  'alex.t@email.com',    '+13215550165', 'en', 'referral'),
  (public._seed_uuid('cust-rosa'),   'Rosa Mendez',    'rosa.m@email.com',    '+14075550123', 'es', 'website'),
  (public._seed_uuid('cust-linda'),  'Linda Park',     'l.park@email.com',    '+13215550144', 'en', 'website'),
  (public._seed_uuid('cust-sarang'), 'Sarang P.',      'sarang.p@email.com',  '+14075550111', 'en', 'referral'),
  (public._seed_uuid('cust-maggie'), 'Maggie Calder',  'maggie.c@email.com',  '+13215550102', 'en', 'website'),
  (public._seed_uuid('cust-tomas'),  'Tomás G.',       'tg@email.com',        '+14075550177', 'es', 'website')
on conflict (id) do nothing;

-- ============== Leads ==============
insert into public.leads (
  id, customer_id, stage, from_zone, to_zone, move_date, size, stairs,
  source, source_url_path, estimated_value, notes, created_at
) values
  (public._seed_uuid('lead-sarah'),  public._seed_uuid('cust-sarah'),  'new',
   'winter_park_springs_oviedo', 'sanford_lake_mary',
   current_date + 7, '2br', 'none',
   'toromovers.net / #book', '/', 875,
   '2-BR apartment to new place in Lake Mary. Flexible on timing.',
   now() - interval '2 days'),

  (public._seed_uuid('lead-mike'),   public._seed_uuid('cust-mike'),   'new',
   'orlando_area', 'winter_park_springs_oviedo',
   current_date + 5, 'studio', '1_flight',
   '/orlando-movers', '/orlando-movers', 300,
   'Studio, mostly boxes. Needs Sat before noon.',
   now() - interval '2 days'),

  (public._seed_uuid('lead-patel'),  public._seed_uuid('cust-patel'),  'new',
   'lake_nona_hunters_creek', 'winter_park_springs_oviedo',
   current_date + 12, '3br', 'elevator',
   'google / referral', '/', 1450,
   '3-BR townhouse. Has a baby grand piano — flagged.',
   now() - interval '3 days'),

  (public._seed_uuid('lead-maria'),  public._seed_uuid('cust-maria'),  'contacted',
   'kissimmee_st_cloud', 'kissimmee_st_cloud',
   current_date + 8, '2br', 'none',
   '/mudanza', '/mudanza', 720,
   'Spoke Saturday — waiting on quote. Bilingual crew preferred.',
   now() - interval '3 days'),

  (public._seed_uuid('lead-rivera'), public._seed_uuid('cust-rivera'), 'quoted',
   'orlando_area', 'apopka_ocoee_winter_garden',
   current_date + 6, '1br', 'none',
   'toromovers.net / #book', '/', 875,
   'Quote sent Friday. Following up today.',
   now() - interval '4 days'),

  (public._seed_uuid('lead-kelly'),  public._seed_uuid('cust-kelly'),  'quoted',
   'lake_nona_hunters_creek', 'lake_nona_hunters_creek',
   current_date + 14, '3br', 'none',
   '/lake-nona-movers', '/lake-nona-movers', 1625,
   '3-BR house within Lake Nona. Declined "Big Move" package, wants custom.',
   now() - interval '5 days'),

  (public._seed_uuid('lead-alex'),   public._seed_uuid('cust-alex'),   'booked',
   'winter_park_springs_oviedo', 'winter_park_springs_oviedo',
   current_date + 6, '2br', '1_flight',
   'referral', '/', 875,
   'Saturday 9am start. Deposit paid. Crew A assigned.',
   now() - interval '7 days'),

  (public._seed_uuid('lead-rosa'),   public._seed_uuid('cust-rosa'),   'booked',
   'kissimmee_st_cloud', 'orlando_area',
   current_date + 7, '3br', 'none',
   '/mudanza', '/mudanza', 1175,
   'Sunday 10am. Bilingual crew B. 3-BR family move.',
   now() - interval '8 days'),

  (public._seed_uuid('lead-linda'),  public._seed_uuid('cust-linda'),  'booked',
   'orlando_area', 'orlando_area',
   current_date + 8, 'studio', '1_flight',
   '/orlando-movers', '/orlando-movers', 300,
   'Loading help only — she has a U-Haul.',
   now() - interval '4 days'),

  (public._seed_uuid('lead-sarang'), public._seed_uuid('cust-sarang'), 'done',
   'sanford_lake_mary', 'sanford_lake_mary',
   current_date - 7, '3br', 'none',
   'referral', '/', 1175,
   'Paid. Left 5-star review on Google.',
   now() - interval '20 days'),

  (public._seed_uuid('lead-maggie'), public._seed_uuid('cust-maggie'), 'done',
   'orlando_area', 'orlando_area',
   current_date - 10, '2br', 'none',
   '/orlando-movers', '/orlando-movers', 875,
   'Finished in 2.75 hrs. Paid via Zelle. Review pending.',
   now() - interval '23 days'),

  (public._seed_uuid('lead-tomas'),  public._seed_uuid('cust-tomas'),  'lost',
   'long_distance', 'long_distance',
   current_date + 25, '4br_plus', 'none',
   '/mudanza', '/mudanza', 0,
   'Out-of-state move, too big for our fleet. Referred to partner.',
   now() - interval '8 days')
on conflict (id) do nothing;

-- Update lost reason for Tomás
update public.leads set lost_reason = 'out_of_scope'
  where id = public._seed_uuid('lead-tomas');

-- Clean up helper
drop function public._seed_uuid(text);

-- Verify:
-- select stage, count(*) from public.leads group by stage order by stage;
