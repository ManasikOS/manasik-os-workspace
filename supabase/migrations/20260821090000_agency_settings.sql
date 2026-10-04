-- Agency Settings — the agency's low-frequency configuration area: identity,
-- branches, operational defaults, communication templates, finance defaults,
-- integrations, security policy and the unified audit log.
--
-- See docs/modules/settings-module-implementation-plan.md for the full plan. Every
-- table here answers "what is the reusable, agency-wide rule", never
-- "what is true about one lead, booking, pilgrim or group" — those stay on
-- their own entities.
--
-- Additive only. Safe on a database with 20260808…20260820 applied.

-- ─────────────────────────────────────────────────────────────────────────────
-- A. branches — the entity `staff_profiles.branch` / `departure_groups.branch`
--    / `packages.branch` have been faking with a CHECK constraint and free
--    text. "Add Branch" becomes a row insert, not a migration.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.branches (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  code              text not null,
  address           text,
  phone             text,
  email             text,
  manager_id        uuid references public.staff_profiles (id) on delete set null,
  manager_name      text,
  default_currency  text not null default 'LKR',
  status            text not null default 'ACTIVE'
                      check (status in ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  is_primary        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.branches is
  'Agency branch directory. Replaces the free-text/CHECK-constraint branch value carried on staff_profiles, departure_groups and packages — those keep a denormalised text snapshot, this is the source of truth.';

create unique index if not exists branches_code_unique on public.branches (upper(code));
create unique index if not exists branches_primary_unique on public.branches (is_primary) where is_primary;
create index if not exists branches_status_idx on public.branches (status);

drop trigger if exists branches_set_updated_at on public.branches;
create trigger branches_set_updated_at
  before update on public.branches
  for each row execute function public.set_updated_at();

-- Real FK, on the column `departure_groups` already reserved for it.
alter table public.departure_groups
  add column if not exists branch_id uuid references public.branches (id) on delete set null;
alter table public.staff_profiles
  add column if not exists branch_id uuid references public.branches (id) on delete set null;
alter table public.packages
  add column if not exists branch_id uuid references public.branches (id) on delete set null;

create index if not exists departure_groups_branch_id_idx on public.departure_groups (branch_id);
create index if not exists staff_profiles_branch_id_idx   on public.staff_profiles (branch_id);
create index if not exists packages_branch_id_idx         on public.packages (branch_id);

-- `staff_profiles.branch` was a hard CHECK ('COLOMBO','KANDY','ALL') — the
-- exact defect this table fixes. Drop the constraint; the column stays as a
-- denormalised display snapshot, same posture as `*_owner_name` next to
-- `*_owner_id` on departure_groups.
alter table public.staff_profiles drop constraint if exists staff_profiles_branch_check;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. agency_settings — the singleton. One row, everything else in this
--    migration is either a directory the singleton points at (branches,
--    templates, integrations) or a log of changes to it.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.agency_settings (
  id                     uuid primary key default gen_random_uuid(),
  singleton              boolean not null default true,

  -- Organisation
  agency_name               text not null default '',
  legal_name                text,
  registration_number       text,
  default_country            text not null default 'LK',
  default_currency          text not null default 'LKR',
  timezone                  text not null default 'Asia/Colombo',
  default_language          text not null default 'en',
  supported_languages       text[] not null default '{en,si,ta}',
  primary_email              text,
  primary_whatsapp           text,
  office_address             text,

  -- Branding & pilgrim portal
  logo_path                  text,
  portal_primary_colour      text not null default '#0EA5E9',
  portal_secondary_colour    text,
  portal_welcome_message     text,
  portal_support_whatsapp    text,
  portal_support_email       text,
  website_url                text,
  terms_url                  text,
  invoice_footer             text not null default 'Thank you for choosing us.',
  portal_flags               jsonb not null default '{
    "allowDocumentUploads": true,
    "allowViewPaymentSchedule": true,
    "allowUploadPaymentProof": true,
    "showItineraryAfterConfirmation": true,
    "showHotelDetailsAfterConfirmation": true,
    "showGuideContact7DaysBefore": true,
    "allowSupportRequests": true
  }'::jsonb,

  -- Operational defaults
  default_group_capacity        integer not null default 40 check (default_group_capacity > 0),
  minimum_group_size            integer not null default 15 check (minimum_group_size > 0),
  default_seat_hold_hours       integer not null default 24 check (default_seat_hold_hours > 0),
  default_guide_ratio           integer not null default 40 check (default_guide_ratio > 0),
  default_group_status          text not null default 'PLANNING',
  default_sales_status          text not null default 'SELLING',
  waitlists_enabled_by_default  boolean not null default true,
  readiness_ready_threshold     integer not null default 90
                                   check (readiness_ready_threshold between 0 and 100),
  readiness_at_risk_threshold   integer not null default 70
                                   check (readiness_at_risk_threshold between 0 and 100),
  critical_flags                jsonb not null default '{
    "missingFlightsIsCritical": true,
    "missingHotelConfirmationIsCritical": true,
    "pendingVisaWithin7DaysIsCritical": true,
    "overduePaymentsIsHighPriority": true
  }'::jsonb,
  passport_validity_months        integer not null default 6,
  passport_photo_requirement      text not null default 'WHITE_BACKGROUND',
  document_reminder_days          integer not null default 3,
  document_rework_deadline_hours  integer not null default 48,
  visa_escalation_days            integer not null default 7,
  require_document_verification   boolean not null default true,
  require_visa_verification       boolean not null default true,

  -- Branch rules
  branch_rules jsonb not null default '{
    "restrictStaffToAssignedBranch": true,
    "allowAdminViewAllBranches": true,
    "allowCeoViewAllBranches": true,
    "allowCrossBranchBookingManagement": false
  }'::jsonb,

  -- Finance defaults
  supported_currencies      text[] not null default '{LKR,SAR,USD}',
  invoice_prefix             text not null default 'INV',
  receipt_prefix              text not null default 'RCT',
  payment_prefix              text not null default 'PAY',
  supplier_bill_prefix         text not null default 'SUP',
  default_payment_terms      text not null default 'Deposit + final balance',
  enabled_payment_methods    text[] not null default '{CASH,BANK_TRANSFER,CARD,ONLINE,CHEQUE,OTHER}',
  tax_config                  jsonb,
  auto_generate_receipt      boolean not null default true,
  require_bank_proof         boolean not null default true,
  margin_visible_roles       text[] not null default '{ADMIN,CEO,FINANCE}',

  -- Security & access defaults
  default_staff_role             text not null default 'MARKETING',
  require_account_approval       boolean not null default true,
  seasonal_auto_expiry_enabled   boolean not null default true,
  seasonal_expiry_days           integer not null default 30,
  session_idle_timeout_minutes   integer not null default 60,
  access_restriction_flags       jsonb not null default '{
    "restrictGuidesToAssignedGroups": true,
    "restrictMarketingFromPassportVisaData": true,
    "restrictGuidesFromFinanceData": true,
    "restrictFinanceFromMedicalRecords": true
  }'::jsonb,

  -- Data retention
  document_retention_years          integer not null default 7,
  archived_group_retention_years    integer not null default 7,
  deactivated_user_retention_years  integer not null default 1,
  immutable_finance_history         boolean not null default true,
  keep_document_verification_history boolean not null default true,

  -- Danger zone state
  portal_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agency_settings_one_row unique (singleton),
  constraint agency_settings_singleton_true check (singleton is true),
  constraint agency_settings_readiness_order
    check (readiness_ready_threshold > readiness_at_risk_threshold)
);

comment on table public.agency_settings is
  'Singleton table (enforced by the unique+check on `singleton`) holding every agency-wide default the Settings module edits. Read on nearly every request once consumer wiring lands — cache with React.cache the same way getCurrentStaffRole() is cached.';

drop trigger if exists agency_settings_set_updated_at on public.agency_settings;
create trigger agency_settings_set_updated_at
  before update on public.agency_settings
  for each row execute function public.set_updated_at();

insert into public.agency_settings (singleton)
values (true)
on conflict (singleton) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. message_templates — reusable WhatsApp / Email / Portal / SMS copy.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.message_templates (
  id          uuid primary key default gen_random_uuid(),
  category    text not null check (category in (
                'LEAD_RECEIVED', 'FIRST_FOLLOW_UP', 'PACKAGE_QUOTATION',
                'BOOKING_CONFIRMATION', 'DEPOSIT_REMINDER', 'PAYMENT_DUE_REMINDER',
                'MISSING_DOCUMENT_REMINDER', 'DOCUMENT_REWORK_REQUEST',
                'VISA_STATUS_UPDATE', 'VISA_APPROVED', 'PRE_DEPARTURE_BRIEFING',
                'GUIDE_CONTACT_MESSAGE', 'DEPARTURE_REMINDER',
                'POST_TRIP_FEEDBACK_REQUEST', 'REFUND_UPDATE'
              )),
  name        text not null,
  channel     text not null check (channel in ('WHATSAPP', 'EMAIL', 'PORTAL', 'SMS')),
  audience    text not null check (audience in ('LEAD', 'BOOKING_CONTACT', 'PILGRIM', 'GROUP', 'STAFF')),
  subject     text,
  body        text not null default '',
  language    text not null default 'en',
  is_active   boolean not null default true,
  requires_approval boolean not null default true,
  assigned_roles     text[] not null default '{}',
  created_by         uuid references auth.users (id) on delete set null,
  created_by_name    text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (category, channel, language)
);

comment on table public.message_templates is
  'Reusable outbound copy, drafted and approved by staff. requires_approval defaults true and there is deliberately no scheduler or autonomous-send path in V1 — see the Settings plan D7.';

create index if not exists message_templates_category_idx on public.message_templates (category);

drop trigger if exists message_templates_set_updated_at on public.message_templates;
create trigger message_templates_set_updated_at
  before update on public.message_templates
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- D. integration_connections — honest status cards, never a live secret
--    store. credential_hint is a masked tail only ('…4f2a'); real credentials
--    live in environment variables, never in this table.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.integration_connections (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null unique check (provider in (
                       'WHATSAPP_BUSINESS', 'EMAIL', 'SMS', 'PAYMENT_GATEWAY',
                       'FILE_STORAGE', 'ACCOUNTING', 'NUSUK'
                     )),
  status             text not null default 'NOT_CONNECTED'
                       check (status in ('NOT_CONNECTED', 'CONNECTED', 'MANUAL_WORKFLOW', 'ERROR', 'DISCONNECTED')),
  connected_account  text,
  scopes             text[] not null default '{}',
  credential_hint    text,
  notes              text,
  last_sync_at       timestamptz,
  connected_at       timestamptz,
  connected_by       uuid references auth.users (id) on delete set null,
  connected_by_name  text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.integration_connections is
  'Status cards only. Never stores a usable secret — credential_hint is a masked tail, real credentials stay in environment variables. See the Settings plan D11.';

drop trigger if exists integration_connections_set_updated_at on public.integration_connections;
create trigger integration_connections_set_updated_at
  before update on public.integration_connections
  for each row execute function public.set_updated_at();

insert into public.integration_connections (provider, status, connected_account, notes) values
  ('WHATSAPP_BUSINESS', 'NOT_CONNECTED', null, null),
  ('EMAIL',             'NOT_CONNECTED', null, null),
  ('SMS',               'NOT_CONNECTED', null, null),
  ('PAYMENT_GATEWAY',   'NOT_CONNECTED', null, null),
  -- Backed by the `agency-assets` bucket created in section J below — the one
  -- integration with a working connector in V1. See the Settings plan D9.
  ('FILE_STORAGE',      'CONNECTED', 'agency-assets (Supabase Storage)', null),
  ('ACCOUNTING',        'NOT_CONNECTED', null, null),
  ('NUSUK',             'MANUAL_WORKFLOW', null, 'Visa submissions are handled manually through the official Nusuk portal today. No API integration exists.')
on conflict (provider) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- E. settings_activity_logs — append-only audit trail for every settings
--    mutation. Folded into the unified audit_log_rows view below.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.settings_activity_logs (
  id                    uuid primary key default gen_random_uuid(),
  actor_id              uuid references auth.users (id) on delete set null,
  actor_name_snapshot   text not null default 'Staff',
  section               text not null,
  event_type            text not null,
  entity_type           text not null default 'SETTINGS',
  entity_id             text,
  entity_label          text,
  before_value          jsonb,
  after_value           jsonb,
  message               text not null default '',
  created_at            timestamptz not null default now()
);

comment on table public.settings_activity_logs is
  'Append-only. Every mutator in lib/data/settings-repository.ts writes exactly one row here with before/after values — see the Settings plan D14.';

create index if not exists settings_activity_logs_created_idx on public.settings_activity_logs (created_at desc);
create index if not exists settings_activity_logs_section_idx on public.settings_activity_logs (section);

-- ─────────────────────────────────────────────────────────────────────────────
-- F. audit_log_rows — the unified, read-only view over every activity log in
--    the schema. One shape, one query, for the Data & Audit section.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.audit_log_rows as
  select
    'GROUP'::text            as source,
    l.actor_id,
    l.actor_name_snapshot,
    l.action_type            as action,
    l.entity_type,
    g.group_name              as entity_label,
    l.before_value,
    l.after_value,
    g.branch,
    l.created_at
  from public.departure_group_activity_logs l
  join public.departure_groups g on g.id = l.departure_group_id
  union all
  select
    'PILGRIM'::text,
    l.actor_id,
    l.actor_name_snapshot,
    l.action_type,
    l.entity_type,
    coalesce(p.full_name, 'Pilgrim'),
    l.before_value,
    l.after_value,
    null,
    l.created_at
  from public.pilgrim_activity_logs l
  left join public.pilgrims p on p.id = l.pilgrim_id
  union all
  select
    'STAFF'::text,
    l.actor_id,
    l.actor_name_snapshot,
    l.event_type,
    'STAFF',
    coalesce(sp.full_name, 'Staff member'),
    l.before_value,
    l.after_value,
    sp.branch,
    l.created_at
  from public.staff_activity_logs l
  left join public.staff_profiles sp on sp.id = l.staff_profile_id
  union all
  select
    'SETTINGS'::text,
    l.actor_id,
    l.actor_name_snapshot,
    l.event_type,
    l.entity_type,
    coalesce(l.entity_label, l.section),
    l.before_value,
    l.after_value,
    null,
    l.created_at
  from public.settings_activity_logs l;

comment on view public.audit_log_rows is
  'Read-only union of every append-only activity log in the schema, normalised to one column set for the Data & Audit section. No data is duplicated or migrated — this is a live view.';

-- ─────────────────────────────────────────────────────────────────────────────
-- G. branch_directory_rows — one row per branch with live staff / group
--    counts folded in, for the Branches section list.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.branch_directory_rows as
  select
    b.*,
    (select count(*) from public.staff_profiles sp
       where sp.branch_id = b.id and sp.status = 'ACTIVE') as staff_count,
    (select count(*) from public.departure_groups g
       where g.branch_id = b.id and g.group_status not in ('COMPLETED', 'CANCELLED')) as active_group_count
  from public.branches b;

comment on view public.branch_directory_rows is
  'Branches flattened with live staff/active-group counts, same shape convention as team_directory_rows / supplier_directory_rows.';

-- ─────────────────────────────────────────────────────────────────────────────
-- H. Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.branches enable row level security;
alter table public.agency_settings enable row level security;
alter table public.message_templates enable row level security;
alter table public.integration_connections enable row level security;
alter table public.settings_activity_logs enable row level security;

drop policy if exists branches_select on public.branches;
create policy branches_select on public.branches
  for select to authenticated using (true);

drop policy if exists branches_write on public.branches;
create policy branches_write on public.branches
  for all to authenticated
  using (public.current_staff_role() = 'ADMIN')
  with check (public.current_staff_role() = 'ADMIN');

-- Currency, timezone, logo and invoice footer are read on nearly every render
-- across every role — agency-wide read, Admin-only write.
drop policy if exists agency_settings_select on public.agency_settings;
create policy agency_settings_select on public.agency_settings
  for select to authenticated using (true);

drop policy if exists agency_settings_write on public.agency_settings;
create policy agency_settings_write on public.agency_settings
  for all to authenticated
  using (public.current_staff_role() = 'ADMIN')
  with check (public.current_staff_role() = 'ADMIN');

drop policy if exists message_templates_select on public.message_templates;
create policy message_templates_select on public.message_templates
  for select to authenticated using (true);

drop policy if exists message_templates_write on public.message_templates;
create policy message_templates_write on public.message_templates
  for all to authenticated
  using (public.current_staff_role() in ('ADMIN', 'MARKETING', 'VISA'))
  with check (public.current_staff_role() in ('ADMIN', 'MARKETING', 'VISA'));

drop policy if exists integration_connections_select on public.integration_connections;
create policy integration_connections_select on public.integration_connections
  for select to authenticated
  using (public.current_staff_role() in ('ADMIN', 'CEO'));

drop policy if exists integration_connections_write on public.integration_connections;
create policy integration_connections_write on public.integration_connections
  for all to authenticated
  using (public.current_staff_role() = 'ADMIN')
  with check (public.current_staff_role() = 'ADMIN');

drop policy if exists settings_activity_logs_select on public.settings_activity_logs;
create policy settings_activity_logs_select on public.settings_activity_logs
  for select to authenticated
  using (public.current_staff_role() in ('ADMIN', 'CEO'));

-- Append-only: any authenticated request may insert (server actions write on
-- the caller's behalf); there is deliberately no update or delete policy.
drop policy if exists settings_activity_logs_insert on public.settings_activity_logs;
create policy settings_activity_logs_insert on public.settings_activity_logs
  for insert to authenticated with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- I. Seed branches + backfill branch_id from the existing free-text values.
--
-- Deployment note: unmatched text values are left with a null branch_id
-- rather than guessed at — see the Settings plan §11 "Branch backfill".
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.branches (name, code, status, is_primary)
values
  ('Colombo Head Office', 'COL', 'ACTIVE', true),
  ('Kandy Branch',        'KDY', 'ACTIVE', false)
on conflict do nothing;

update public.staff_profiles sp
set branch_id = b.id
from public.branches b
where sp.branch_id is null
  and (
    (upper(sp.branch) = 'COLOMBO' and b.code = 'COL') or
    (upper(sp.branch) = 'KANDY'   and b.code = 'KDY') or
    (upper(sp.branch) = 'ALL'     and b.is_primary)
  );

update public.departure_groups g
set branch_id = b.id
from public.branches b
where g.branch_id is null
  and (
    (upper(g.branch) = 'COLOMBO' and b.code = 'COL') or
    (upper(g.branch) = 'KANDY'   and b.code = 'KDY')
  );

update public.packages p
set branch_id = b.id
from public.branches b
where p.branch_id is null
  and (
    (upper(p.branch) = 'COLOMBO' and b.code = 'COL') or
    (upper(p.branch) = 'KANDY'   and b.code = 'KDY')
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- J. agency-assets storage bucket — the agency logo (§5.3 / F8). Public read,
--    since the logo is rendered directly on invoices, receipts and the
--    pilgrim portal with no auth context — unlike `supplier-evidence`, which
--    is private. Admin-only write, same posture as every other Settings table.
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'agency-assets',
  'agency-assets',
  true,
  5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
declare
  policy_name text;
begin
  for policy_name in
    select polname from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname in (
        'public read agency assets',
        'admin upload agency assets',
        'admin update agency assets',
        'admin delete agency assets'
      )
  loop
    execute format('drop policy if exists %I on storage.objects', policy_name);
  end loop;

  execute $p$
    create policy "public read agency assets" on storage.objects
      for select to authenticated, anon using (bucket_id = 'agency-assets')
  $p$;
  execute $p$
    create policy "admin upload agency assets" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'agency-assets' and public.current_staff_role() = 'ADMIN')
  $p$;
  execute $p$
    create policy "admin update agency assets" on storage.objects
      for update to authenticated
      using (bucket_id = 'agency-assets' and public.current_staff_role() = 'ADMIN')
      with check (bucket_id = 'agency-assets' and public.current_staff_role() = 'ADMIN')
  $p$;
  execute $p$
    create policy "admin delete agency assets" on storage.objects
      for delete to authenticated using (bucket_id = 'agency-assets' and public.current_staff_role() = 'ADMIN')
  $p$;
end;
$$;
