-- Leads module — integrity (docs/security/leads-module-security-audit-and-remediation-plan.md, Phase 2: LD-09, LD-10, LD-17).
--
--   A. allocate_references(): lead and quote reference numbers from a per-agency, per-year counter instead of `max + 1` over rows a caller happened
--      to have read (three copies of that logic raced each other, and a scoped read cannot see the agency's highest number at all).
--   B. leads.converting_at: a claim taken before a booking is created, so a double click or two staff members cannot both convert one lead.
--   C. set_lead_consent(): the consent change, its audit row and its timeline entry in ONE transaction, with the actor looked up from the session,
--      and the rule that only an administrator can lift do-not-contact enforced where it cannot be skipped.
--
-- Callers fall back / fail clearly when these functions do not exist yet (lib/data/lead-references.ts), so the code can be deployed first.

-- ── A. Reference counters ────────────────────────────────────────────────────
create table if not exists public.agency_reference_counters (
  agency_id  uuid    not null references public.agencies (id) on delete cascade,
  kind       text    not null check (kind in ('LEAD', 'QUOTE')),
  year       integer not null,
  last_value integer not null default 0 check (last_value >= 0),
  primary key (agency_id, kind, year)
);

comment on table public.agency_reference_counters is
  'Last LD-/QT- number issued per agency, kind and year. Written only by allocate_references(); no policy is granted to any role.';

alter table public.agency_reference_counters enable row level security;
revoke all on public.agency_reference_counters from anon, authenticated;

-- Returns `p_count` consecutive references, e.g. {LD-2027-0041, LD-2027-0042}. A staff session always allocates for its own agency; `p_agency_id` is
-- honoured only when there is no signed-in user (service role: the WhatsApp agent, cron), and only service_role can execute it that way.
create or replace function public.allocate_references(p_kind text, p_count integer default 1, p_agency_id uuid default null)
  returns text[]
  language plpgsql security definer set search_path = public as $$
declare
  v_agency uuid;
  v_year   integer;
  v_prefix text;
  v_seed   integer;
  v_last   integer;
  v_out    text[] := '{}';
  i        integer;
begin
  if p_kind not in ('LEAD', 'QUOTE') then
    raise exception 'Unknown reference kind %', p_kind using errcode = '22023';
  end if;
  if p_count is null or p_count < 1 or p_count > 1000 then
    raise exception 'Reference count must be between 1 and 1000' using errcode = '22023';
  end if;

  if auth.uid() is not null then
    v_agency := public.current_agency_id();
    if v_agency is null or not public.staff_role_in('ADMIN', 'MARKETING') then
      raise exception 'Not allowed to allocate references' using errcode = '42501';
    end if;
  else
    v_agency := p_agency_id;
    if v_agency is null then
      raise exception 'An agency is required' using errcode = '22023';
    end if;
  end if;

  v_year   := extract(year from (now() at time zone 'Asia/Colombo'))::integer;
  v_prefix := case p_kind when 'LEAD' then 'LD-' else 'QT-' end || v_year::text || '-';

  -- Only used the first time this agency issues this kind this year: continue after whatever the old scheme already handed out. Revision suffixes
  -- (QT-2027-0001-R1) do not match and are ignored.
  if p_kind = 'LEAD' then
    select coalesce(max(substring(reference from '^LD-' || v_year::text || '-(\d+)$')::integer), 0) into v_seed
    from public.leads
    where agency_id = v_agency and reference ~ ('^LD-' || v_year::text || '-\d+$');
  else
    select coalesce(max(substring(reference from '^QT-' || v_year::text || '-(\d+)$')::integer), 0) into v_seed
    from public.lead_quotes
    where agency_id = v_agency and reference ~ ('^QT-' || v_year::text || '-\d+$');
  end if;

  insert into public.agency_reference_counters as c (agency_id, kind, year, last_value)
  values (v_agency, p_kind, v_year, v_seed + p_count)
  on conflict (agency_id, kind, year) do update set last_value = c.last_value + p_count
  returning last_value into v_last;

  for i in 0 .. p_count - 1 loop
    v_out := v_out || (v_prefix || lpad((v_last - p_count + 1 + i)::text, 4, '0'));
  end loop;
  return v_out;
end $$;

revoke all on function public.allocate_references(text, integer, uuid) from public, anon;
grant execute on function public.allocate_references(text, integer, uuid) to authenticated, service_role;

comment on function public.allocate_references(text, integer, uuid) is
  'Issues LD-/QT- reference numbers atomically from agency_reference_counters. Staff sessions allocate for their own agency (ADMIN/MARKETING); the service role passes p_agency_id.';

-- ── B. Conversion claim ──────────────────────────────────────────────────────
alter table public.leads add column if not exists converting_at timestamptz;

comment on column public.leads.converting_at is
  'Set (compare-and-swap) just before a booking is created from this lead and cleared when the lead is linked; a claim older than a few minutes is stale and may be retaken.';

-- ── C. Consent: change + audit + timeline in one transaction ──────────────────
alter table public.consent_events add column if not exists actor_id uuid;

create or replace function public.set_lead_consent(
  p_lead_id  uuid,
  p_status   text,
  p_dnc      boolean,
  p_channels text[],
  p_source   text,
  p_note     text default null
) returns void
  language plpgsql set search_path = public as $$
declare
  v_old    public.leads;
  v_name   text;
  v_action text;
  v_source text := btrim(coalesce(p_source, ''));
begin
  -- The same roles the leads UPDATE policy allows. Without this a read-only role would pass the row lock below, change nothing (RLS) and still
  -- leave a consent_events row behind.
  if not public.staff_role_in('ADMIN', 'MARKETING') then
    raise exception 'Your role cannot record consent decisions.' using errcode = '42501';
  end if;
  if p_status not in ('UNKNOWN', 'OPTED_IN', 'OPTED_OUT') then
    raise exception 'Unknown consent status' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_channels, '{}')) ch where ch not in ('WHATSAPP', 'EMAIL', 'SMS', 'CALL')) then
    raise exception 'Unknown contact channel' using errcode = '22023';
  end if;
  if v_source = '' or length(v_source) > 200 then
    raise exception 'Say where this decision came from' using errcode = '22023';
  end if;

  select * into v_old from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'That lead no longer exists.' using errcode = 'P0002';
  end if;

  if v_old.do_not_contact and not p_dnc and not public.staff_role_in('ADMIN') then
    raise exception 'Only an administrator can clear do-not-contact.' using errcode = '42501';
  end if;

  -- Who did it comes from the session, never from the caller.
  select full_name into v_name from public.staff_profiles where id = auth.uid();
  v_name := coalesce(v_name, 'Staff');

  v_action := case
    when p_dnc and not v_old.do_not_contact then 'DNC_SET'
    when not p_dnc and v_old.do_not_contact then 'DNC_CLEARED'
    when p_status = 'OPTED_IN'  and v_old.consent_status <> 'OPTED_IN'  then 'OPT_IN'
    when p_status = 'OPTED_OUT' and v_old.consent_status <> 'OPTED_OUT' then 'OPT_OUT'
    else 'CHANNELS_UPDATED'
  end;

  update public.leads
     set consent_status       = p_status,
         consent_source       = v_source,
         consent_at           = now(),
         do_not_contact       = p_dnc,
         contactable_channels = coalesce(p_channels, '{}')
   where id = p_lead_id;

  insert into public.consent_events (subject_type, subject_id, action, channel, source, note, actor_name, actor_id)
  values ('LEAD', p_lead_id, v_action, null, v_source, nullif(btrim(coalesce(p_note, '')), ''), v_name, auth.uid());

  insert into public.lead_activity (lead_id, type, message, actor_name)
  values (
    p_lead_id,
    'CONSENT_UPDATED',
    'Consent set to ' || lower(replace(p_status, '_', ' ')) || case when p_dnc then ' · marked do-not-contact' else '' end || '.',
    v_name
  );
end $$;

revoke all on function public.set_lead_consent(uuid, text, boolean, text[], text, text) from public, anon;
grant execute on function public.set_lead_consent(uuid, text, boolean, text[], text, text) to authenticated;

comment on function public.set_lead_consent(uuid, text, boolean, text[], text, text) is
  'Records a consent / do-not-contact decision on a lead: the change, its consent_events row and its timeline entry succeed or fail together. Runs as the caller, so row-level security applies.';

notify pgrst, 'reload schema';
