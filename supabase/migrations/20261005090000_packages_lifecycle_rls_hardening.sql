-- Packages RLS hardening — closes the gap between what
-- `lib/access/packages-access.ts` actually enforces and what the database
-- allowed any authenticated PostgREST caller to do directly.
--
-- Findings this migration fixes (see
-- docs/modules/packages-production-readiness-plan.md, Phase 0):
--
--   A3. UPDATE was granted to `ADMIN, OPERATIONS, FINANCE, MARKETING` on
--       EVERY package, unconditionally. `capabilitiesForPackages()` gives
--       FINANCE no `editPackage` at all, and gives MARKETING only
--       `toggleFeatured` (never `editPackage`) scoped to packages it can
--       actually see (`canRoleViewPackage`: Open for Sale, or its own
--       Draft). None of that was true at the RLS layer — a MARKETING or
--       FINANCE session using the Supabase client directly (or a leaked
--       anon/service key misused as a session) could rewrite any package's
--       title, pricing policy, itinerary, or lifecycle status, for any
--       package, regardless of who owns it.
--
--   Related: the INSERT policy from `20260822090000_rls_hardening.sql`
--       checked only the caller's role, having silently dropped the
--       `owner_id = auth.uid()` check the table's original policy
--       (`20260808090000_create_packages.sql`) had — so a caller could
--       insert a package row and stamp a DIFFERENT user as its `owner_id`,
--       corrupting authorship and `canRoleViewPackage`'s "own draft" rule
--       for that other user. Also tightened to drop FINANCE (no
--       `createPackage`/`duplicatePackage` capability) and to stop a
--       MARKETING insert from landing as anything other than an unfeatured
--       Draft — the only shape `duplicatePackageAction` ever produces for
--       that role, application-side.
--
-- UPDATE is now:
--   * Full row/column access for ADMIN and OPERATIONS (both have
--     `editPackage`).
--   * MARKETING may touch only rows it could see anyway (Open for Sale, or
--     its own Draft) — enforced by the policy's row filter — and, on those
--     rows, may change ONLY `featured` — enforced by the trigger below,
--     because RLS itself is row-grain, not column-grain (same limitation
--     `20260822090000_rls_hardening.sql`'s header already documents for
--     every other module).
--   * FINANCE, VISA, CEO and GUIDE lose UPDATE entirely — none of them has
--     any capability in `packages-access.ts` that performs one today.
--     (`editPricing` exists as a capability but nothing in the application
--     currently uses it to write `packages` — see finding D3. Re-grant
--     FINANCE a scoped UPDATE here if/when that capability is wired up.)
--
-- This is deliberately conservative: it does not attempt to enforce every
-- publish/lifecycle rule Phase 1 will add (state machine, uniqueness,
-- optimistic concurrency) — only that the database can no longer be used to
-- bypass the ROLE and OWNERSHIP checks the application already makes.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. INSERT — restore the owner_id check, drop FINANCE, and keep a
--    MARKETING-authored row honest (Draft, unfeatured) at the database
--    layer, not only in `duplicatePackageAction`.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "staff insert packages" on public.packages;
create policy "staff insert packages" on public.packages
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (
      public.staff_role_in('ADMIN', 'OPERATIONS')
      or (
        public.staff_role_in('MARKETING')
        and status = 'Draft'
        and featured = false
      )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- B. UPDATE — row-grain restriction. FINANCE loses the grant outright;
--    MARKETING is scoped to the rows `canRoleViewPackage()` already lets it
--    see. Column-grain restriction for MARKETING is the trigger in section C.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "staff update packages" on public.packages;
create policy "staff update packages" on public.packages
  for update to authenticated
  using (
    public.staff_role_in('ADMIN', 'OPERATIONS')
    or (
      public.staff_role_in('MARKETING')
      and (status = 'Open for Sale' or owner_id = (select auth.uid()))
    )
  )
  with check (
    public.staff_role_in('ADMIN', 'OPERATIONS')
    or (
      public.staff_role_in('MARKETING')
      and (status = 'Open for Sale' or owner_id = (select auth.uid()))
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Column-grain guard for MARKETING's UPDATE: only `featured` may change.
--
-- Compares OLD and NEW as jsonb with the allowed keys stripped out, rather
-- than hand-listing every one of the table's ~120 columns — a hand-written
-- list is one added column away from silently permitting a field it was
-- never meant to. `updated_at` is excluded only because
-- `packages_set_updated_at` (a same-statement BEFORE trigger) stamps it on
-- every write regardless of who is writing; it carries no authorization
-- weight of its own.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.packages_enforce_marketing_column_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  acting_role text := public.current_staff_role();
  scope_exclusions text[] := array['featured', 'updated_at'];
begin
  if acting_role in ('ADMIN', 'OPERATIONS') then
    return new;
  end if;

  if acting_role = 'MARKETING' then
    if (to_jsonb(old) - scope_exclusions) is distinct from (to_jsonb(new) - scope_exclusions) then
      raise exception
        'MARKETING may only change a package''s featured flag, not its other fields.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Every other role's UPDATE is already refused by the RLS policy above
  -- before this trigger can run; this is a fail-closed backstop, not the
  -- primary enforcement.
  raise exception 'Your role cannot update packages.' using errcode = '42501';
end;
$$;

comment on function public.packages_enforce_marketing_column_scope() is
  'BEFORE UPDATE guard: ADMIN/OPERATIONS may change any column; MARKETING may change only `featured` (row visibility for MARKETING is scoped by the "staff update packages" RLS policy); every other role is refused. See docs/modules/packages-production-readiness-plan.md, findings A1/A3.';

drop trigger if exists packages_enforce_marketing_scope on public.packages;
create trigger packages_enforce_marketing_scope
  before update on public.packages
  for each row execute function public.packages_enforce_marketing_column_scope();

notify pgrst, 'reload schema';
