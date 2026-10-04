-- Leads: the agency's sales command centre, from first WhatsApp/Facebook/walk-in
-- contact until the enquiry becomes a Booking, is postponed, or is marked lost.
--
-- A lead never reserves a seat. `selected_departure_group_id` records interest;
-- only a row in `departure_group_bookings` (via `booking_id` here) holds seats.
-- That table already carries an unconstrained `lead_id` column
-- ("No leads table yet") — this migration adds the FK now that one exists.

-- ── Lead sources (the "Manage Lead Sources" screen) ─────────────────────────
-- Independent of the fixed `leads.source` check constraint below: this table is
-- the editable label/ordering layer shown in the More menu, seeded from the
-- same codes the app already used as a hardcoded enum.
create table if not exists public.lead_sources (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  label       text not null,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

insert into public.lead_sources (code, label, sort_order) values
  ('WHATSAPP', 'WhatsApp', 1),
  ('PHONE_CALL', 'Phone', 2),
  ('WALK_IN', 'Walk-in', 3),
  ('FACEBOOK', 'Facebook', 4),
  ('INSTAGRAM', 'Instagram', 5),
  ('WEBSITE', 'Website', 6),
  ('GOOGLE', 'Google', 7),
  ('REFERRAL', 'Referral', 8),
  ('REPEAT_CUSTOMER', 'Repeat Customer', 9),
  ('COMMUNITY_EVENT', 'Mosque Event', 10),
  ('OTHER', 'Other', 11)
on conflict (code) do nothing;

-- ── Leads ────────────────────────────────────────────────────────────────────
create table if not exists public.leads (
  id                          uuid primary key default gen_random_uuid(),
  reference                   text not null unique,               -- LD-YYYY-NNNN

  full_name                   text not null,
  mobile                      text not null,                      -- normalised 9-digit subscriber number
  email                       text,
  city                        text not null default '',
  preferred_language          text not null default 'English',
  preferred_channel           text not null default 'WHATSAPP'
                                check (preferred_channel in ('WHATSAPP', 'CALL', 'EMAIL', 'SMS', 'IN_PERSON')),

  journey_type                text not null default 'UMRAH'
                                check (journey_type in ('UMRAH', 'HAJJ', 'EARLY_REGISTRATION')),
  interested_in               text not null default '',
  desired_package_id          uuid references public.packages (id) on delete set null,
  desired_package_name        text,
  preferred_period            text not null default '',
  adults                      integer not null default 1 check (adults >= 1),
  children                    integer not null default 0 check (children >= 0),
  room_preference             text not null default 'UNDECIDED'
                                check (room_preference in ('QUAD', 'TRIPLE', 'DOUBLE', 'SINGLE', 'UNDECIDED')),
  departure_city               text not null default '',
  budget_range                text not null default 'Not discussed',
  quota_waitlist_interest     boolean not null default false,

  source                      text not null default 'WHATSAPP'
                                check (source in ('WHATSAPP', 'PHONE_CALL', 'WALK_IN', 'FACEBOOK',
                                  'INSTAGRAM', 'WEBSITE', 'GOOGLE', 'REFERRAL', 'REPEAT_CUSTOMER',
                                  'COMMUNITY_EVENT', 'OTHER')),
  campaign_reference           text,
  referral_name                text,
  assigned_to_id               text not null,
  assigned_to_name             text not null,
  stage                        text not null default 'NEW_LEAD'
                                check (stage in ('NEW_LEAD', 'CONTACTED', 'QUALIFIED', 'PROPOSAL_SENT',
                                  'NEGOTIATION', 'DEPOSIT_PENDING', 'BOOKED', 'LOST', 'POSTPONED',
                                  'DUPLICATE', 'SPAM')),
  temperature                  text not null default 'WARM'
                                check (temperature in ('HOT', 'WARM', 'COLD')),
  estimated_value_lkr          bigint not null default 0 check (estimated_value_lkr >= 0),

  -- Sales-cycle links. Nullable until the customer commits; a Lead itself never
  -- reserves a seat, so nothing here decrements departure-group capacity.
  selected_departure_group_id  uuid references public.departure_groups (id) on delete set null,
  booking_id                   uuid references public.departure_group_bookings (id) on delete set null,

  next_follow_up_at            timestamptz,
  follow_up_type                text
                                check (follow_up_type is null or follow_up_type in ('CALL', 'WHATSAPP_MESSAGE',
                                  'SEND_QUOTE', 'SEND_BROCHURE', 'IN_PERSON_VISIT', 'DEPOSIT_REMINDER')),
  follow_up_owner_id            text,
  follow_up_owner_name          text,
  follow_up_attempts            integer not null default 0 check (follow_up_attempts >= 0),
  first_response_at             timestamptz,
  last_contacted_at             timestamptz,

  lost_reason                  text
                                check (lost_reason is null or lost_reason in ('PRICE_TOO_HIGH',
                                  'DATE_UNAVAILABLE', 'NO_SEATS', 'COMPETITOR', 'VISA_CONCERN',
                                  'NO_RESPONSE', 'POSTPONED_TRAVEL', 'PAYMENT_ISSUE', 'DUPLICATE', 'OTHER')),
  lost_note                    text,
  postponed_until               date,
  duplicate_of_lead_id          uuid references public.leads (id) on delete set null,
  duplicate_override_reason     text,

  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

comment on table public.leads is
  'Sales pipeline: enquiries from first contact until Booked, Lost, Postponed, Duplicate or Spam. Never reserves seats — only departure_group_bookings does.';

create index if not exists leads_stage_followup_idx on public.leads (stage, next_follow_up_at);
create index if not exists leads_assigned_idx       on public.leads (assigned_to_id, stage);
create index if not exists leads_mobile_idx         on public.leads (mobile);
create index if not exists leads_email_idx          on public.leads (lower(email));
create index if not exists leads_created_at_idx     on public.leads (created_at desc);
create index if not exists leads_group_idx          on public.leads (selected_departure_group_id);

-- Now that `leads` exists, constrain the booking's back-reference to it. The
-- previous "no leads table yet" comment in the departure-groups migration is
-- resolved here rather than there, so that migration keeps building standalone.
alter table public.departure_group_bookings
  drop constraint if exists departure_group_bookings_lead_id_fkey;
alter table public.departure_group_bookings
  add constraint departure_group_bookings_lead_id_fkey
  foreign key (lead_id) references public.leads (id) on delete set null;

-- ── Activity timeline (immutable) ───────────────────────────────────────────
create table if not exists public.lead_activity (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads (id) on delete cascade,
  type        text not null,
  message     text not null,
  actor_name  text not null,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists lead_activity_lead_idx on public.lead_activity (lead_id, created_at desc);

-- ── Internal notes ───────────────────────────────────────────────────────────
-- Never portal-visible; the UI must label these "Internal only".
create table if not exists public.lead_notes (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads (id) on delete cascade,
  body        text not null,
  author_name text not null,
  created_at  timestamptz not null default now()
);

create index if not exists lead_notes_lead_idx on public.lead_notes (lead_id, created_at desc);

-- ── Quotes ───────────────────────────────────────────────────────────────────
-- Pricing is a snapshot at send time: a later package repricing must not
-- silently rewrite a quote a customer already received.
create table if not exists public.lead_quotes (
  id                    uuid primary key default gen_random_uuid(),
  lead_id               uuid not null references public.leads (id) on delete cascade,
  reference             text not null unique,          -- QT-YYYY-NNNN
  package_id            uuid references public.packages (id) on delete set null,
  departure_group_id    uuid references public.departure_groups (id) on delete set null,
  pricing_snapshot      jsonb not null default '{}'::jsonb,
  adults                integer not null default 1 check (adults >= 1),
  children              integer not null default 0 check (children >= 0),
  room_preference       text not null default 'UNDECIDED'
                          check (room_preference in ('QUAD', 'TRIPLE', 'DOUBLE', 'SINGLE', 'UNDECIDED')),
  total_lkr             bigint not null default 0 check (total_lkr >= 0),
  deposit_lkr           bigint not null default 0 check (deposit_lkr >= 0),
  valid_until           timestamptz not null,
  sent_via              text check (sent_via is null or sent_via in ('WHATSAPP', 'EMAIL', 'PDF')),
  sent_at               timestamptz,
  created_by_name        text not null,
  created_at             timestamptz not null default now()
);

create index if not exists lead_quotes_lead_idx on public.lead_quotes (lead_id, created_at desc);

-- ── updated_at maintenance ──────────────────────────────────────────────────
-- `public.set_updated_at()` already exists (created by the packages migration).
drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Same posture as packages/departure_groups: any signed-in staff member may
-- read and write. Tighten to real per-role policies once staff roles exist in
-- the database — `lib/access/leads-access.ts` is the single place that would
-- need new queries plumbed in.
alter table public.leads         enable row level security;
alter table public.lead_activity enable row level security;
alter table public.lead_notes    enable row level security;
alter table public.lead_quotes   enable row level security;
alter table public.lead_sources  enable row level security;

do $$
declare
  tbl text;
begin
  foreach tbl in array array['leads', 'lead_activity', 'lead_notes', 'lead_quotes', 'lead_sources']
  loop
    execute format('drop policy if exists "staff read %s"  on public.%I', tbl, tbl);
    execute format('drop policy if exists "staff write %s" on public.%I', tbl, tbl);
    execute format(
      'create policy "staff read %s" on public.%I for select to authenticated using (true)',
      tbl, tbl);
    execute format(
      'create policy "staff write %s" on public.%I for all to authenticated using (true) with check (true)',
      tbl, tbl);
  end loop;
end $$;
