-- Repairs schema drift that made every second agency fail to provision.
--
-- 20260828090000_tenant_uniqueness.sql meant to replace the global
-- UNIQUE (code) on agency_service_addons with UNIQUE (agency_id, code), but on
-- the live database the global constraint is still in place and the per-agency
-- one does not exist. provision_agency() seeds the add-on catalogue with
-- `on conflict on constraint agency_service_addons_code_agency_unique`, so:
--   * the named constraint is missing  -> "constraint ... does not exist", and
--   * even without that, a second agency's 'QURBANI' collides with the first
--     agency's under the global rule.
-- Both make self-serve signup (and operator-created agencies) fail at
-- provisioning.
--
-- Safe: today each code appears once (one agency's catalogue), so the composite
-- rule cannot be violated by existing rows. Idempotent.

alter table public.agency_service_addons drop constraint if exists agency_service_addons_code_unique;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agency_service_addons_code_agency_unique'
      and conrelid = 'public.agency_service_addons'::regclass
  ) then
    alter table public.agency_service_addons
      add constraint agency_service_addons_code_agency_unique unique (agency_id, code);
  end if;
end $$;
