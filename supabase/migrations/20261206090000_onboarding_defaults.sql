-- Agency self-onboarding, Slice 2 (docs/onboarding/plan.md §7.1 M4 + trial).
-- Fixes D4 (new agencies had no subscription row) and D5 (every new agency was
-- seeded with Sri Lankan country/currency/timezone and LKR add-on prices).
-- Existing agencies are untouched.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. country_locale_defaults — what a new agency in a given country starts with.
--    Reference data only; the owner can change every value in Settings.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.country_locale_defaults (
  country_code        text primary key check (country_code ~ '^[A-Z]{2}$'),
  currency            text not null,
  timezone            text not null,
  supported_languages text[] not null default '{en}'
);

comment on table public.country_locale_defaults is
  'Starting currency, timezone and languages for a new agency, by ISO country code (docs/onboarding/plan.md M4). Reference data, read-only to the app.';

insert into public.country_locale_defaults (country_code, currency, timezone, supported_languages) values
  ('GB', 'GBP', 'Europe/London',        '{en}'),
  ('IE', 'EUR', 'Europe/Dublin',        '{en}'),
  ('DE', 'EUR', 'Europe/Berlin',        '{en}'),
  ('FR', 'EUR', 'Europe/Paris',         '{en}'),
  ('NL', 'EUR', 'Europe/Amsterdam',     '{en}'),
  ('TR', 'TRY', 'Europe/Istanbul',      '{en}'),
  ('US', 'USD', 'America/New_York',     '{en}'),
  ('CA', 'CAD', 'America/Toronto',      '{en}'),
  ('AU', 'AUD', 'Australia/Sydney',     '{en}'),
  ('ZA', 'ZAR', 'Africa/Johannesburg',  '{en}'),
  ('NG', 'NGN', 'Africa/Lagos',         '{en}'),
  ('EG', 'EGP', 'Africa/Cairo',         '{en}'),
  ('AE', 'AED', 'Asia/Dubai',           '{en}'),
  ('SA', 'SAR', 'Asia/Riyadh',          '{en}'),
  ('QA', 'QAR', 'Asia/Qatar',           '{en}'),
  ('KW', 'KWD', 'Asia/Kuwait',          '{en}'),
  ('OM', 'OMR', 'Asia/Muscat',          '{en}'),
  ('BH', 'BHD', 'Asia/Bahrain',         '{en}'),
  ('IN', 'INR', 'Asia/Kolkata',         '{en}'),
  ('PK', 'PKR', 'Asia/Karachi',         '{en}'),
  ('BD', 'BDT', 'Asia/Dhaka',           '{en}'),
  ('MV', 'MVR', 'Indian/Maldives',      '{en}'),
  ('MY', 'MYR', 'Asia/Kuala_Lumpur',    '{en}'),
  ('SG', 'SGD', 'Asia/Singapore',       '{en}'),
  ('ID', 'IDR', 'Asia/Jakarta',         '{en}'),
  ('LK', 'LKR', 'Asia/Colombo',         '{en,si,ta}')
on conflict (country_code) do nothing;

alter table public.country_locale_defaults enable row level security;
revoke all on public.country_locale_defaults from public, anon, authenticated;
grant select on public.country_locale_defaults to authenticated;
create policy country_locale_defaults_read on public.country_locale_defaults
  for select to authenticated using (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- B. provision_agency — same behaviour, plus locale. The three new parameters
--    default to null so operator-side callers using the old five arguments keep
--    working. The old five-argument function is dropped so the two cannot
--    become ambiguous overloads.
--
--    With no country the agency starts on neutral values (USD / UTC / English)
--    rather than Sri Lankan ones; the setup guide asks for the real ones.
--    LKR agencies get exactly the add-on prices they always did; any other
--    currency starts with unpriced add-ons (default_amount null) instead of
--    LKR figures under the wrong currency.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.provision_agency(text, text, uuid, text, text);

create or replace function public.provision_agency(
  p_name text,
  p_slug text,
  p_owner_user_id uuid,
  p_owner_full_name text,
  p_owner_email text,
  p_country text default null,
  p_currency text default null,
  p_timezone text default null
) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_agency_id uuid;
  v_branch_id uuid;
  v_had_membership boolean;
  v_country text := nullif(upper(trim(coalesce(p_country, ''))), '');
  v_locale public.country_locale_defaults%rowtype;
  v_currency text;
  v_timezone text;
  v_languages text[];
begin
  if v_country is not null then
    select * into v_locale from public.country_locale_defaults where country_code = v_country;
  end if;

  v_currency  := coalesce(nullif(trim(coalesce(p_currency, '')), ''), v_locale.currency, 'USD');
  v_timezone  := coalesce(nullif(trim(coalesce(p_timezone, '')), ''), v_locale.timezone, 'UTC');
  v_languages := coalesce(v_locale.supported_languages, '{en}');

  insert into public.agencies (name, slug, status)
  values (p_name, nullif(trim(p_slug), ''), 'ACTIVE')
  returning id into v_agency_id;

  if v_country is null then
    insert into public.agency_settings (agency_id, default_currency, timezone, default_language, supported_languages)
    values (v_agency_id, v_currency, v_timezone, 'en', v_languages)
    on conflict (agency_id) do nothing;
  else
    insert into public.agency_settings (agency_id, default_country, default_currency, timezone, default_language, supported_languages)
    values (v_agency_id, v_country, v_currency, v_timezone, 'en', v_languages)
    on conflict (agency_id) do nothing;
  end if;

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
    (agency_id, code, name, category, default_amount, currency, unit, creates_deviation, journey_types)
  select v_agency_id, s.code, s.name, s.category,
         case when v_currency = 'LKR' then s.lkr_amount else null::numeric end,
         v_currency, s.unit, s.creates_deviation, '{HAJJ,UMRAH}'::text[]
  from (values
    ('QURBANI',          'Qurbani / Hadi',            'RITUAL',      28000, 'FLAT',    false),
    ('WHEELCHAIR',       'Wheelchair assistance',     'ASSISTANCE',      0, 'FLAT',    true),
    ('EXTRA_BAGGAGE',    'Extra baggage allowance',   'FLIGHT',       4500, 'PER_KG',  true),
    ('MEET_GREET',       'Airport meet & greet',      'ASSISTANCE',   9000, 'FLAT',    true),
    ('ZIYARAT_MAKKAH',   'Additional Makkah ziyarat', 'OTHER',        6500, 'FLAT',    true),
    ('ZIYARAT_MADINAH',  'Additional Madinah ziyarat','OTHER',        6500, 'FLAT',    true),
    ('LAUNDRY',          'Laundry service',           'OTHER',        2500, 'PER_DAY', false),
    ('TRAVEL_INSURANCE', 'Travel insurance',          'INSURANCE',    7500, 'FLAT',    false),
    ('IHRAM_KIT',        'Ihram & travel kit',        'MERCHANDISE',  5500, 'FLAT',    false),
    ('PRIVATE_TRANSFER', 'Private airport transfer',  'TRANSPORT',   18000, 'FLAT',    true)
  ) as s(code, name, category, lkr_amount, unit, creates_deviation)
  on conflict on constraint agency_service_addons_code_agency_unique do nothing;

  insert into public.ai_settings (agency_id) values (v_agency_id)
  on conflict (agency_id) do nothing;

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

comment on function public.provision_agency(text, text, uuid, text, text, text, text, text) is
  'Creates one agency and seeds its baseline data + owner membership in one transaction (F5). Optional country/currency/timezone drive agency_settings and add-on currency (docs/onboarding/plan.md M4). service-role only.';

revoke all on function public.provision_agency(text, text, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.provision_agency(text, text, uuid, text, text, text, text, text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. provision_agency_from_signup — same contract as 20261205090100, now passing
--    the signup's country to provision_agency and starting a 14-day STARTER
--    trial so entitlement resolution never returns "no subscription" (D4).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.provision_agency_from_signup(
  p_pending_id uuid,
  p_user_id uuid,
  p_email text
) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_pending public.pending_agency_signups%rowtype;
  v_base_slug text;
  v_slug text;
  v_agency_id uuid;
  v_attempt int := 0;
  v_existing uuid;
begin
  select * into v_pending
  from public.pending_agency_signups
  where id = p_pending_id
  for update;

  if not found then
    raise exception 'pending_signup_not_found';
  end if;

  if lower(v_pending.email) <> lower(p_email) then
    raise exception 'pending_signup_email_mismatch';
  end if;

  if v_pending.consumed_at is not null then
    if v_pending.agency_id is not null then
      return v_pending.agency_id;
    end if;
    select agency_id into v_existing
    from public.agency_members
    where user_id = p_user_id and status = 'ACTIVE'
    order by is_default desc, created_at asc
    limit 1;
    if v_existing is not null then
      return v_existing;
    end if;
    raise exception 'pending_signup_expired';
  end if;

  if v_pending.expires_at < now() then
    raise exception 'pending_signup_expired';
  end if;

  v_base_slug := trim(both '-' from regexp_replace(lower(v_pending.agency_name), '[^a-z0-9]+', '-', 'g'));
  if v_base_slug is null or v_base_slug = '' then
    v_base_slug := 'agency-' || substr(replace(p_pending_id::text, '-', ''), 1, 8);
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_slug := case
      when v_attempt = 1 then v_base_slug
      when v_attempt <= 20 then v_base_slug || '-' || v_attempt
      else v_base_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)
    end;

    if exists (select 1 from public.agencies where slug = v_slug) then
      continue;
    end if;

    begin
      v_agency_id := public.provision_agency(
        v_pending.agency_name,
        v_slug,
        p_user_id,
        v_pending.owner_full_name,
        lower(p_email),
        v_pending.country_code
      );
      exit;
    exception
      when unique_violation then
        if v_attempt >= 40 then
          raise;
        end if;
    end;
  end loop;

  -- Trial: STARTER for 14 days. Until it is decided what happens at expiry
  -- (docs/onboarding/plan.md §13 Q1), nothing reads trial_ends_at to restrict
  -- access — the row exists so plan limits and AI budgets resolve.
  insert into public.agency_subscriptions
    (agency_id, plan_code, status, current_period_start, current_period_end, trial_ends_at)
  values
    (v_agency_id, 'STARTER', 'TRIAL', current_date, (current_date + interval '14 days')::date, now() + interval '14 days')
  on conflict (agency_id) do nothing;

  update public.pending_agency_signups
  set consumed_at = now(),
      agency_id = v_agency_id
  where id = p_pending_id;

  return v_agency_id;
end;
$$;

comment on function public.provision_agency_from_signup(uuid, uuid, text) is
  'Atomically turns one confirmed self-serve signup into one agency with a 14-day STARTER trial. Idempotent per signup: repeat calls return the same agency. Rejects unknown, expired and email-mismatched signups. service-role only.';

revoke all on function public.provision_agency_from_signup(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.provision_agency_from_signup(uuid, uuid, text) to service_role;
