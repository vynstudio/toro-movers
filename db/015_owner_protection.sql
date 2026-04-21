-- ============================================================
-- TORO MOVERS CRM v2 — Owner protection
-- ============================================================
-- public.users.is_owner flag + RLS tightening so admins can do
-- everything EXCEPT modify/delete an owner's row (unless it's
-- their own — the owner can still self-edit).
--
-- Diler (hello@vyn.studio) is the sole owner. Other admins added
-- later (Stephanie, etc.) are effectively "managers" — full admin
-- powers minus touching the owner.
--
-- Already applied via inline DDL. Safe to re-run.
-- ============================================================

alter table public.users add column if not exists is_owner boolean not null default false;

update public.users set is_owner = true where email = 'hello@vyn.studio';

drop policy if exists users_admin_write on public.users;
create policy users_admin_write on public.users for all
  using (
    public.current_user_role() = 'admin'
    and (not is_owner or auth.uid() = id)
  )
  with check (
    public.current_user_role() = 'admin'
    and (not is_owner or auth.uid() = id)
  );
