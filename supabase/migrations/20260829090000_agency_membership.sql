-- Multi-tenancy Phase 3 — membership roster, agency provisioning, and
-- suspension enforcement. See docs/architecture/multi-tenancy-implementation-plan.md
-- Phase 3 (F4, F5, F6 partial, F7).
--
-- Deliberate scope note, read before touching anything here: the plan
-- document sketches `current_agency_id()` reading `agency_members` directly
-- as the resolver. This migration does NOT do that. `current_agency_id()`
-- and `current_staff_role()` keep reading `staff_profiles.agency_id` /
-- `.role` exactly as they do today — the source every one of the ~110 RLS
-- policies already depends on, unchanged. `agency_members` is the roster of
-- a person's memberships; "switching" is implemented as
-- `switch_active_agency()` writing the CHOSEN membership's agency_id and
-- role onto that one `staff_profiles` row. This is a narrower, lower-risk
-- design than a resolver rewrite: it adds multi-membership support without
-- touching the function every access-control check in the app already
-- trusts, and without this migration ever having run against a live
-- database to prove a resolver rewrite out first. The trade-off is real and
-- worth stating: switching agency in one browser tab changes the session
-- for every other open tab too, since both read the same underlying row.
-- Acceptable for a first cut; revisit if that surprises real users.
--
-- Safe on a database with 20260808…20260828 applied.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. agency_members — the roster. One row per (person, agency) they can work
--    in. Not yet the RLS resolver (see the note above) — today it powers
--    the agency switcher and `provision_agency()`'s bookkeeping.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.agency_members (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  agency_id   uuid not null references public.agencies (id) on delete cascade,
  role        text not null
                check (role in ('ADMIN','CEO','FINANCE','MARKETING','OPERATIONS','VISA','GUIDE')),
  status      text not null default 'ACTIVE'
                check (status in ('INVITED','ACTIVE','SUSPENDED','REMOVED')),
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, agency_id)
);

comment on table public.agency_members is
  'Roster of which agencies a person belongs to and at what role. staff_profiles stays the single row RLS resolves against (current_staff_role() / current_agency_id()) — switch_active_agency() below copies the chosen membership onto it. See this migration''s header for why.';

create unique index if not exists agency_members_one_default
  on public.agency_members (user_id) where is_default;
create index if not exists agency_members_agency_idx on public.agency_members (agency_id, status);

drop trigger if exists agency_members_set_updated_at on public.agency_members;
create trigger agency_members_set_updated_at
  before update on public.agency_members
  for each row execute function public.set_updated_at();

-- Backfill: one row per existing staff_profiles, marked as that person's
-- default (only membership today).
insert into public.agency_members (user_id, agency_id, role, status, is_default)
select
  sp.id,
  sp.agency_id,
  case when sp.role in ('ADMIN','CEO','FINANCE','MARKETING','OPERATIONS','VISA','GUIDE')
       then sp.role else 'GUIDE' end,
  case sp.status
    when 'ACTIVE'            then 'ACTIVE'
    when 'INVITED'           then 'INVITED'
    when 'DEACTIVATED'       then 'REMOVED'
    when 'SEASONAL_INACTIVE' then 'SUSPENDED'
    else 'SUSPENDED'
  end,
  true
from public.staff_profiles sp
where sp.agency_id is not null
on conflict (user_id, agency_id) do nothing;

alter table public.agency_members enable row level security;

-- Self-access only. This is deliberately NOT `agency_id = current_agency_id()`
-- — a person must be able to see every membership they hold (for the
-- switcher), including ones that are not their currently active agency, and
-- current_agency_id() only ever names one of them.
drop policy if exists agency_members_select on public.agency_members;
create policy agency_members_select on public.agency_members
  for select to authenticated
  using (user_id = auth.uid());

-- No insert/update/delete for `authenticated`. Every mutation goes through
-- provision_agency() or switch_active_agency() below, both security
-- definer and both validating what they write.

-- ─────────────────────────────────────────────────────────────────────────────
-- B. current_agency_id() — narrow addition only: null out for a suspended
--    or cancelled agency (F7 / D9). The resolution source (staff_profiles
--    .agency_id) is unchanged, so every existing policy keeps working
--    exactly as before for an ACTIVE agency, and starts denying everything
--    for one that is not — a suspended tenant's staff can still sign in,
--    they simply see no data anywhere in the app, which is the intended
--    "workspace suspended" state the application layer renders around.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.current_agency_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select sp.agency_id
  from public.staff_profiles sp
  join public.agencies a on a.id = sp.agency_id
  where sp.id = auth.uid() and a.status = 'ACTIVE'
$$;

comment on function public.current_agency_id() is
  'Security-definer helper: the calling user''s staff_profiles.agency_id, or null if they have no row or their agency is not ACTIVE (F7). The tenant filter folded into every RLS policy in 20260824090000_tenancy.sql §E.';

-- ─────────────────────────────────────────────────────────────────────────────
-- C. switch_active_agency(p_agency_id) — moves a verified membership onto
--    staff_profiles, the row every policy actually reads.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.switch_active_agency(p_agency_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  select m.role into v_role
  from public.agency_members m
  join public.agencies a on a.id = m.agency_id
  where m.user_id = auth.uid()
    and m.agency_id = p_agency_id
    and m.status = 'ACTIVE'
    and a.status = 'ACTIVE';

  if v_role is null then
    raise exception 'Not an active member of that agency.' using errcode = '42501';
  end if;

  update public.staff_profiles
  set agency_id = p_agency_id, role = v_role
  where id = auth.uid();

  update public.agency_members set is_default = false where user_id = auth.uid() and is_default;
  update public.agency_members set is_default = true where user_id = auth.uid() and agency_id = p_agency_id;
end;
$$;

comment on function public.switch_active_agency(uuid) is
  'Moves the caller''s active agency + role onto staff_profiles, after verifying an ACTIVE membership in an ACTIVE agency. See this migration''s header for why this mutates staff_profiles rather than being read indirectly.';

revoke all on function public.switch_active_agency(uuid) from public;
grant execute on function public.switch_active_agency(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- D. provision_agency() — creates an agency and seeds every default row a
--    fresh tenant needs, in one transaction (F5). Seed data mirrors the
--    rows 20260821090000_agency_settings.sql, 20260812100000_create_leads.sql
--    and 20260826090000_pilgrim_service_customisation.sql seeded once for
--    the single pre-existing agency — every agency after this one gets the
--    same starting point.
--
-- Assumes the owner's auth.users row already exists (created by Supabase
-- Auth — invite or signup — before this is called; provisioning a database
-- row for a person is not the same as provisioning their credential).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.provision_agency(
  p_name text,
  p_slug text,
  p_owner_user_id uuid,
  p_owner_full_name text,
  p_owner_email text
) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_agency_id uuid;
  v_branch_id uuid;
  v_had_membership boolean;
begin
  insert into public.agencies (name, slug, status)
  values (p_name, nullif(trim(p_slug), ''), 'ACTIVE')
  returning id into v_agency_id;

  -- agency_settings: every non-PK column already has a table-level default
  -- (20260821090000), so this alone reproduces the same starting settings
  -- every agency has had since that migration.
  insert into public.agency_settings (agency_id) values (v_agency_id)
  on conflict (agency_id) do nothing;

  insert into public.branches (agency_id, name, code, status, is_primary)
  select v_agency_id, 'Head Office', 'HQ', 'ACTIVE', true
  where not exists (
    select 1 from public.branches where agency_id = v_agency_id and upper(code) = 'HQ'
  );
  select id into v_branch_id from public.branches where agency_id = v_agency_id and upper(code) = 'HQ';

  insert into public.lead_sources (agency_id, code, label, sort_order) values
    (v_agency_id, 'WHATSAPP',        'WhatsApp',        1),
    (v_agency_id, 'PHONE_CALL',      'Phone',           2),
    (v_agency_id, 'WALK_IN',         'Walk-in',         3),
    (v_agency_id, 'FACEBOOK',        'Facebook',        4),
    (v_agency_id, 'INSTAGRAM',       'Instagram',       5),
    (v_agency_id, 'WEBSITE',         'Website',         6),
    (v_agency_id, 'GOOGLE',          'Google',          7),
    (v_agency_id, 'REFERRAL',        'Referral',        8),
    (v_agency_id, 'REPEAT_CUSTOMER', 'Repeat Customer', 9),
    (v_agency_id, 'COMMUNITY_EVENT', 'Mosque Event',    10),
    (v_agency_id, 'OTHER',           'Other',           11)
  on conflict on constraint lead_sources_code_agency_unique do nothing;

  insert into public.integration_connections (agency_id, provider, status, connected_account, notes) values
    (v_agency_id, 'WHATSAPP_BUSINESS', 'NOT_CONNECTED', null, null),
    (v_agency_id, 'EMAIL',             'NOT_CONNECTED', null, null),
    (v_agency_id, 'SMS',               'NOT_CONNECTED', null, null),
    (v_agency_id, 'PAYMENT_GATEWAY',   'NOT_CONNECTED', null, null),
    (v_agency_id, 'FILE_STORAGE',      'CONNECTED', 'agency-assets (Supabase Storage)', null),
    (v_agency_id, 'ACCOUNTING',        'NOT_CONNECTED', null, null),
    (v_agency_id, 'NUSUK',             'MANUAL_WORKFLOW', null,
       'Visa submissions are handled manually through the official Nusuk portal today. No API integration exists.')
  on conflict on constraint integration_connections_provider_agency_unique do nothing;

  insert into public.agency_service_addons
    (agency_id, code, name, category, default_amount, unit, creates_deviation, journey_types) values
    (v_agency_id, 'QURBANI',          'Qurbani / Hadi',            'RITUAL',      28000, 'FLAT',    false, '{HAJJ,UMRAH}'),
    (v_agency_id, 'WHEELCHAIR',       'Wheelchair assistance',     'ASSISTANCE',      0, 'FLAT',    true,  '{HAJJ,UMRAH}'),
    (v_agency_id, 'EXTRA_BAGGAGE',    'Extra baggage allowance',   'FLIGHT',       4500, 'PER_KG',  true,  '{HAJJ,UMRAH}'),
    (v_agency_id, 'MEET_GREET',       'Airport meet & greet',      'ASSISTANCE',   9000, 'FLAT',    true,  '{HAJJ,UMRAH}'),
    (v_agency_id, 'ZIYARAT_MAKKAH',   'Additional Makkah ziyarat', 'OTHER',        6500, 'FLAT',    true,  '{HAJJ,UMRAH}'),
    (v_agency_id, 'ZIYARAT_MADINAH',  'Additional Madinah ziyarat','OTHER',        6500, 'FLAT',    true,  '{HAJJ,UMRAH}'),
    (v_agency_id, 'LAUNDRY',          'Laundry service',           'OTHER',        2500, 'PER_DAY', false, '{HAJJ,UMRAH}'),
    (v_agency_id, 'TRAVEL_INSURANCE', 'Travel insurance',          'INSURANCE',    7500, 'FLAT',    false, '{HAJJ,UMRAH}'),
    (v_agency_id, 'IHRAM_KIT',        'Ihram & travel kit',        'MERCHANDISE',  5500, 'FLAT',    false, '{HAJJ,UMRAH}'),
    (v_agency_id, 'PRIVATE_TRANSFER', 'Private airport transfer',  'TRANSPORT',   18000, 'FLAT',    true,  '{HAJJ,UMRAH}')
  on conflict on constraint agency_service_addons_code_agency_unique do nothing;

  insert into public.ai_settings (agency_id) values (v_agency_id)
  on conflict (agency_id) do nothing;

  -- The owner. staff_profiles is one row per person platform-wide — if this
  -- auth user already has a row (they are being made the owner of a SECOND
  -- agency), this only adds the agency_members row and leaves their
  -- existing active agency/role on staff_profiles untouched; they can
  -- switch into the new one via switch_active_agency() same as anyone else.
  select exists(select 1 from public.staff_profiles where id = p_owner_user_id) into v_had_membership;

  if not v_had_membership then
    insert into public.staff_profiles
      (id, full_name, email, role, branch, branch_id, employment_type, status, agency_id, activated_at)
    values
      (p_owner_user_id, p_owner_full_name, lower(p_owner_email), 'ADMIN', 'ALL', v_branch_id,
       'PERMANENT', 'ACTIVE', v_agency_id, now());
  end if;

  select exists(
    select 1 from public.agency_members where user_id = p_owner_user_id
  ) into v_had_membership;

  insert into public.agency_members (user_id, agency_id, role, status, is_default)
  values (p_owner_user_id, v_agency_id, 'ADMIN', 'ACTIVE', not v_had_membership)
  on conflict (user_id, agency_id) do nothing;

  return v_agency_id;
end;
$$;

comment on function public.provision_agency(text, text, uuid, text, text) is
  'Creates one agency and seeds its baseline data + owner membership in one transaction (F5). service-role only — see revoke below.';

revoke all on function public.provision_agency(text, text, uuid, text, text) from public, authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- E. agencies — widen the read policy so the switcher can resolve every
--    membership's agency name/status, not only the currently active one.
--
-- 20260824090000_tenancy.sql §G scoped this to `id = current_agency_id()`,
-- correct for a world with one agency per person. `getCurrentStaffRole()`'s
-- membership list embeds `agencies(name, status)` on each `agency_members`
-- row — under the old policy every row except the active membership would
-- come back with a null embed (PostgREST applies RLS to embedded tables
-- too), silently breaking the switcher. This adds exactly the membership
-- case; a user still can never see an agency they do not belong to.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists agencies_select on public.agencies;
create policy agencies_select on public.agencies
  for select to authenticated
  using (
    id = (select public.current_agency_id())
    or exists (
      select 1 from public.agency_members m
      where m.agency_id = agencies.id and m.user_id = auth.uid() and m.status = 'ACTIVE'
    )
  );
