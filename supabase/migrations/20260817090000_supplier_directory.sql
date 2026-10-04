-- Supplier Directory — the agency-wide reusable partner directory.
--
-- Supplier            = reusable business partner (broker, hotel, transport, catering, ...).
-- Supplier Commitment  = one real service promise a supplier makes to one Departure Group.
-- Departure Group readiness reflects whether that commitment is confirmed — confirmation always
-- routes through the existing `markGroupAccommodationConfirmed` / `markGroupTransportConfirmed`
-- mutators in `lib/data/departure-groups.ts`, never a direct write to the service row.
--
-- Additive only. Safe on a database with 20260809090000 … 20260815090000 applied. Independent of
-- the still-unbuilt Operations migration reserved at 20260816090000.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. The supplier
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.suppliers (
  id                            uuid primary key default gen_random_uuid(),
  supplier_code                 text not null,
  name                           text not null,
  supplier_type                  text not null
                                   check (supplier_type in ('BROKER','HOTEL','TRANSPORT','CATERING','TICKETING',
                                                            'VISA_PARTNER','INSURANCE','GUIDE_PARTNER','ZIYARAH',
                                                            'ANCILLARY','OTHER')),
  status                         text not null default 'ACTIVE'
                                   check (status in ('ACTIVE','INACTIVE')),
  reliability                    text not null default 'RELIABLE'
                                   check (reliability in ('RELIABLE','NEEDS_ATTENTION','ON_HOLD','INACTIVE')),
  reliability_reason              text,
  reliability_reviewed_at         timestamptz,
  reliability_reviewed_by         uuid references auth.users (id) on delete set null,
  reliability_reviewed_by_name    text,
  city                           text,
  country                         text,
  currency                        text not null default 'SAR' check (currency in ('SAR','LKR','USD','AED','OTHER')),
  payment_terms                   text not null default 'PAY_AFTER_CONFIRMATION'
                                   check (payment_terms in ('DEPOSIT_REQUIRED','PAY_AFTER_CONFIRMATION','CUSTOM')),
  payment_terms_note              text,
  lead_time_days                  integer check (lead_time_days is null or lead_time_days >= 0),
  preferred_channel               text check (preferred_channel is null or preferred_channel in ('WHATSAPP','PHONE','EMAIL')),
  -- Broker notes and commercial context. Stripped in the repository for roles
  -- without viewInternalNotes — same posture as accommodations.internal_cost.
  internal_notes                  text,
  created_by                      uuid references auth.users (id) on delete set null,
  created_by_name                 text,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  constraint suppliers_code_unique unique (supplier_code)
);

create index if not exists suppliers_type_idx    on public.suppliers (supplier_type, status);
create index if not exists suppliers_city_idx    on public.suppliers (city) where city is not null;
create index if not exists suppliers_health_idx  on public.suppliers (reliability) where status = 'ACTIVE';

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists suppliers_set_updated_at on public.suppliers;
create trigger suppliers_set_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

alter table public.suppliers enable row level security;

drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers
  for select to authenticated using (true);

drop policy if exists suppliers_write on public.suppliers;
create policy suppliers_write on public.suppliers
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Service capabilities and rates — internal planning references only.
--    Never a source of truth for customer pricing (see Packages).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.supplier_services (
  id              uuid primary key default gen_random_uuid(),
  supplier_id     uuid not null references public.suppliers (id) on delete cascade,
  category        text not null
                    check (category in ('MAKKAH_ACCOMMODATION','MADINAH_ACCOMMODATION','ACCOMMODATION_OTHER',
                                        'AIRPORT_TRANSFER','INTERCITY_TRANSPORT','ZIYARAH_TRANSPORT',
                                        'CATERING','TICKETING','VISA_SERVICE','INSURANCE',
                                        'GUIDE_SERVICE','ANCILLARY','OTHER')),
  typical_service  text,
  typical_rate     numeric(14, 2) check (typical_rate is null or typical_rate >= 0),
  rate_currency    text check (rate_currency is null or rate_currency in ('SAR','LKR','USD','AED')),
  rate_unit        text,
  season           text check (season is null or season in ('STANDARD','RAMADAN','HAJJ','PEAK','OTHER')),
  notes            text,
  unique (supplier_id, category)
);

comment on column public.supplier_services.typical_rate is
  'Internal planning reference only. Customer pricing lives in Package Templates and group price overrides.';

create index if not exists supplier_services_category_idx on public.supplier_services (category);

alter table public.supplier_services enable row level security;

drop policy if exists supplier_services_select on public.supplier_services;
create policy supplier_services_select on public.supplier_services
  for select to authenticated using (true);

drop policy if exists supplier_services_write on public.supplier_services;
create policy supplier_services_write on public.supplier_services
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Contacts — a supplier can have many; at most one primary.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.supplier_contacts (
  id                    uuid primary key default gen_random_uuid(),
  supplier_id           uuid not null references public.suppliers (id) on delete cascade,
  name                  text not null,
  role_title            text,
  whatsapp_number       text,
  phone_number          text,
  email                 text,
  languages             text,
  is_primary            boolean not null default false,
  is_emergency          boolean not null default false,
  preferred_time_from   time,
  preferred_time_to     time,
  timezone              text,
  notes                 text,
  created_at            timestamptz not null default now()
);

create unique index if not exists supplier_contacts_one_primary_idx
  on public.supplier_contacts (supplier_id) where is_primary;
create index if not exists supplier_contacts_emergency_idx
  on public.supplier_contacts (supplier_id) where is_emergency;
create index if not exists supplier_contacts_supplier_idx
  on public.supplier_contacts (supplier_id);

alter table public.supplier_contacts enable row level security;

drop policy if exists supplier_contacts_select on public.supplier_contacts;
create policy supplier_contacts_select on public.supplier_contacts
  for select to authenticated using (true);

drop policy if exists supplier_contacts_write on public.supplier_contacts;
create policy supplier_contacts_write on public.supplier_contacts
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- D. The commitment — one supplier promise to one Departure Group. The core of
--    the module. `payment_status` is deliberately not stored; it is derived
--    from amount / amount_paid / payment_due_at, exactly as documented in the
--    implementation plan (D6), so it cannot drift from its inputs.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.supplier_commitments (
  id                     uuid primary key default gen_random_uuid(),
  supplier_id            uuid not null references public.suppliers (id) on delete restrict,
  departure_group_id     uuid not null references public.departure_groups (id) on delete cascade,
  reference_code         text not null,
  service_category       text not null,
  service_label          text not null default '',
  service_details        text,
  service_start_date     date,
  service_end_date       date,
  booking_reference      text,
  status                 text not null default 'DRAFT'
                           check (status in ('DRAFT','REQUESTED','SUPPLIER_RESPONDED','CONFIRMED',
                                             'COMPLETED','CANCELLED','DISPUTED')),
  -- The existing service row this commitment fulfils, when there is one.
  linked_entity_type     text check (linked_entity_type is null or linked_entity_type in
                                      ('ACCOMMODATION','TRANSPORT','FLIGHT')),
  linked_entity_id       uuid,
  owner_id               uuid references auth.users (id) on delete set null,
  owner_name             text,
  amount                 numeric(14, 2) check (amount is null or amount >= 0),
  currency               text not null default 'SAR' check (currency in ('SAR','LKR','USD','AED')),
  payment_terms_note     text,
  amount_paid            numeric(14, 2) not null default 0 check (amount_paid >= 0),
  payment_due_at         date,
  evidence_path          text,
  evidence_uploaded_at   timestamptz,
  confirmed_at           timestamptz,
  confirmed_by_name      text,
  notes                  text,
  created_by             uuid references auth.users (id) on delete set null,
  created_by_name        text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint supplier_commitments_reference_unique unique (reference_code),
  constraint supplier_commitments_dates check (service_end_date is null
                                                or service_start_date is null
                                                or service_end_date >= service_start_date)
);

create index if not exists supplier_commitments_supplier_idx on public.supplier_commitments (supplier_id, status);
create index if not exists supplier_commitments_group_idx    on public.supplier_commitments (departure_group_id, status);
create index if not exists supplier_commitments_linked_idx   on public.supplier_commitments (linked_entity_type, linked_entity_id)
  where linked_entity_id is not null;
create index if not exists supplier_commitments_due_idx      on public.supplier_commitments (payment_due_at)
  where status not in ('CANCELLED','COMPLETED');

drop trigger if exists supplier_commitments_set_updated_at on public.supplier_commitments;
create trigger supplier_commitments_set_updated_at
  before update on public.supplier_commitments
  for each row execute function public.set_updated_at();

alter table public.supplier_commitments enable row level security;

drop policy if exists supplier_commitments_select on public.supplier_commitments;
create policy supplier_commitments_select on public.supplier_commitments
  for select to authenticated using (true);

drop policy if exists supplier_commitments_write on public.supplier_commitments;
create policy supplier_commitments_write on public.supplier_commitments
  for all to authenticated using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- E. Payments against commitments — a ledger, not an accounting system. Kept
--    deliberately thin until a real Finance module exists to supersede it.
--    `amount_paid` on the commitment is maintained by the trigger below so the
--    two figures cannot disagree.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.supplier_payments (
  id                uuid primary key default gen_random_uuid(),
  commitment_id     uuid not null references public.supplier_commitments (id) on delete cascade,
  amount            numeric(14, 2) not null check (amount > 0),
  currency          text not null check (currency in ('SAR','LKR','USD','AED')),
  paid_at           date not null,
  method            text,
  reference         text,
  document_path     text,
  recorded_by       uuid references auth.users (id) on delete set null,
  recorded_by_name  text,
  created_at        timestamptz not null default now()
);

create index if not exists supplier_payments_commitment_idx on public.supplier_payments (commitment_id, paid_at desc);

alter table public.supplier_payments enable row level security;

drop policy if exists supplier_payments_select on public.supplier_payments;
create policy supplier_payments_select on public.supplier_payments
  for select to authenticated using (true);

drop policy if exists supplier_payments_write on public.supplier_payments;
create policy supplier_payments_write on public.supplier_payments
  for all to authenticated using (true) with check (true);

create or replace function public.sync_supplier_commitment_amount_paid()
returns trigger language plpgsql as $$
declare
  affected_commitment uuid := coalesce(new.commitment_id, old.commitment_id);
begin
  update public.supplier_commitments
    set amount_paid = coalesce((
      select sum(amount) from public.supplier_payments where commitment_id = affected_commitment
    ), 0)
    where id = affected_commitment;
  return null;
end;
$$;

drop trigger if exists supplier_payments_sync_amount_paid on public.supplier_payments;
create trigger supplier_payments_sync_amount_paid
  after insert or update or delete on public.supplier_payments
  for each row execute function public.sync_supplier_commitment_amount_paid();

-- ─────────────────────────────────────────────────────────────────────────────
-- F. Supplier timeline — append-only, mirrors visa_application_events.
--    Commitment confirmations write here AND to departure_group_activity_logs,
--    so the group's Activity tab keeps telling the whole story.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.supplier_activity_events (
  id              uuid primary key default gen_random_uuid(),
  supplier_id     uuid not null references public.suppliers (id) on delete cascade,
  commitment_id   uuid references public.supplier_commitments (id) on delete cascade,
  actor_id        uuid references auth.users (id) on delete set null,
  actor_name      text not null default 'System',
  actor_role      text,
  action          text not null
                    check (action in ('SUPPLIER_CREATED','SUPPLIER_UPDATED','RELIABILITY_CHANGED',
                                      'CONTACT_ADDED','CONTACT_UPDATED','COMMITMENT_CREATED',
                                      'COMMITMENT_REQUESTED','SUPPLIER_RESPONDED','COMMITMENT_CONFIRMED',
                                      'COMMITMENT_COMPLETED','COMMITMENT_CANCELLED','COMMITMENT_DISPUTED',
                                      'EVIDENCE_UPLOADED','PAYMENT_RECORDED','NOTE_ADDED')),
  from_value      text,
  to_value        text,
  note            text,
  is_high_impact  boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists supplier_events_supplier_idx   on public.supplier_activity_events (supplier_id, created_at desc);
create index if not exists supplier_events_commitment_idx on public.supplier_activity_events (commitment_id, created_at desc);

alter table public.supplier_activity_events enable row level security;

drop policy if exists supplier_activity_events_select on public.supplier_activity_events;
create policy supplier_activity_events_select on public.supplier_activity_events
  for select to authenticated using (true);

drop policy if exists supplier_activity_events_insert on public.supplier_activity_events;
create policy supplier_activity_events_insert on public.supplier_activity_events
  for insert to authenticated with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- G. Resolving the free-text supplier name. Additive and nullable —
--    `supplier_name` stays authoritative for display in V1; backfill is a
--    later, staff-reviewed migration, never an automatic fuzzy match.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.departure_group_accommodations
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null;
alter table public.departure_group_transports
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null;
alter table public.departure_group_flights
  add column if not exists supplier_id uuid references public.suppliers (id) on delete set null;

create index if not exists departure_group_accommodations_supplier_idx
  on public.departure_group_accommodations (supplier_id) where supplier_id is not null;
create index if not exists departure_group_transports_supplier_idx
  on public.departure_group_transports (supplier_id) where supplier_id is not null;
create index if not exists departure_group_flights_supplier_idx
  on public.departure_group_flights (supplier_id) where supplier_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- H. Directory read shape — the flattening view every list/KPI query reads
--    instead of aggregating supplier_commitments by hand.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.supplier_directory_rows as
select
  s.*,
  (select count(distinct c.departure_group_id) from public.supplier_commitments c
     where c.supplier_id = s.id and c.status in ('REQUESTED', 'SUPPLIER_RESPONDED', 'CONFIRMED'))  as active_group_count,
  (select count(*) from public.supplier_commitments c
     where c.supplier_id = s.id and c.status = 'CONFIRMED')                                        as confirmed_count,
  (select count(*) from public.supplier_commitments c
     where c.supplier_id = s.id and c.status in ('REQUESTED', 'SUPPLIER_RESPONDED'))               as pending_count,
  (select count(*) from public.supplier_commitments c
     where c.supplier_id = s.id and c.status = 'DISPUTED')                                         as issue_count,
  (select coalesce(sum(c.amount - c.amount_paid), 0) from public.supplier_commitments c
     where c.supplier_id = s.id and c.status not in ('CANCELLED') and c.amount is not null
       and c.currency = s.currency)                                                                as outstanding_amount,
  (select min(c.payment_due_at) from public.supplier_commitments c
     where c.supplier_id = s.id and c.amount_paid < coalesce(c.amount, 0)
       and c.status not in ('CANCELLED', 'COMPLETED'))                                             as next_payment_due_at,
  (select string_agg(distinct sv.category, ',') from public.supplier_services sv
     where sv.supplier_id = s.id)                                                                  as service_categories,
  (select con.name from public.supplier_contacts con
     where con.supplier_id = s.id and con.is_primary limit 1)                                      as primary_contact_name,
  (select con.whatsapp_number from public.supplier_contacts con
     where con.supplier_id = s.id and con.is_primary limit 1)                                      as primary_contact_whatsapp,
  (select con.phone_number from public.supplier_contacts con
     where con.supplier_id = s.id and con.is_primary limit 1)                                      as primary_contact_phone
from public.suppliers s;

comment on view public.supplier_directory_rows is
  'outstanding_amount only sums commitments in the supplier''s own default currency — mixed-currency totals are computed per-currency in the application layer (see suppliers-module-implementation-plan.md, decision D1).';

-- ─────────────────────────────────────────────────────────────────────────────
-- I. Private storage for supplier evidence (vouchers, confirmations, invoices).
--    Separate from pilgrim-documents — different sensitivity class, different
--    retention. Objects keyed <supplier_id>/<commitment_id>/<uuid>-<filename>.
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'supplier-evidence',
  'supplier-evidence',
  false,
  10 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
declare
  policy_name text;
  policy_names text[] := array[
    'staff read supplier evidence',
    'staff upload supplier evidence',
    'staff update supplier evidence',
    'staff delete supplier evidence'
  ];
begin
  foreach policy_name in array policy_names loop
    execute format('drop policy if exists %I on storage.objects', policy_name);
  end loop;

  execute $p$
    create policy "staff read supplier evidence" on storage.objects
      for select to authenticated using (bucket_id = 'supplier-evidence')
  $p$;
  execute $p$
    create policy "staff upload supplier evidence" on storage.objects
      for insert to authenticated with check (bucket_id = 'supplier-evidence')
  $p$;
  execute $p$
    create policy "staff update supplier evidence" on storage.objects
      for update to authenticated
      using (bucket_id = 'supplier-evidence')
      with check (bucket_id = 'supplier-evidence')
  $p$;
  execute $p$
    create policy "staff delete supplier evidence" on storage.objects
      for delete to authenticated using (bucket_id = 'supplier-evidence')
  $p$;
end;
$$;
