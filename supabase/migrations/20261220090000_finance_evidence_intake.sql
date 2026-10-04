-- FIN-01: retain receipt evidence for Finance review without creating payment
-- truth. This migration is deliberately additive: it never inserts into or
-- updates the payments ledger.

-- Composite tenant keys let every foreign key prove that its referenced row
-- belongs to the evidence row's agency. The UUID primary keys already provide
-- uniqueness; these indexes expose that uniqueness to composite foreign keys.
create unique index if not exists conversations_id_agency_unique
  on public.conversations (id, agency_id);
create unique index if not exists conversation_messages_id_agency_unique
  on public.conversation_messages (id, agency_id);
create unique index if not exists message_attachments_id_agency_unique
  on public.message_attachments (id, agency_id);
create unique index if not exists message_media_analyses_id_agency_unique
  on public.message_media_analyses (id, agency_id);
create unique index if not exists leads_id_agency_unique
  on public.leads (id, agency_id);
create unique index if not exists departure_group_bookings_id_agency_unique
  on public.departure_group_bookings (id, agency_id);
create unique index if not exists departure_groups_id_agency_unique
  on public.departure_groups (id, agency_id);
create unique index if not exists pilgrims_id_agency_unique
  on public.pilgrims (id, agency_id);
create unique index if not exists payments_id_agency_unique
  on public.payments (id, agency_id);

create table public.finance_evidence_intake (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id()
    references public.agencies(id) on delete cascade,

  -- Source links are nullable only so Inbox retention may delete the original
  -- message graph after its configured window. FIN-02 creates each item with
  -- all four source identifiers present.
  source_conversation_id uuid,
  source_message_id uuid,
  source_attachment_id uuid,
  source_media_analysis_id uuid,

  lead_id uuid,
  booking_id uuid,
  departure_group_id uuid,
  customer_id uuid,

  storage_path text not null,
  original_checksum_sha256 text not null,
  original_mime_type text not null,

  candidate_amount numeric(14,2),
  candidate_reference text,
  candidate_date date,
  candidate_confidence numeric(3,2),
  candidate_attribution jsonb not null default '{}'::jsonb,

  status text not null default 'PENDING_REVIEW'
    check (status in ('PENDING_REVIEW','MATCHED_TO_PAYMENT','DISMISSED')),
  payment_id uuid,

  created_by uuid references auth.users(id) on delete set null,
  created_by_name text not null default 'System',
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_note text,
  updated_at timestamptz not null default now(),

  -- D2: unmatched evidence expires with the agency's Inbox policy. A later
  -- retention sweep must skip rows with legal_hold_at set.
  retention_expires_at timestamptz not null,
  legal_hold_at timestamptz,
  legal_hold_by uuid references auth.users(id) on delete set null,
  legal_hold_reason text,

  constraint finance_evidence_intake_conversation_agency_fk
    foreign key (source_conversation_id, agency_id)
    references public.conversations(id, agency_id)
    on delete set null (source_conversation_id),
  constraint finance_evidence_intake_message_agency_fk
    foreign key (source_message_id, agency_id)
    references public.conversation_messages(id, agency_id)
    on delete set null (source_message_id),
  constraint finance_evidence_intake_attachment_agency_fk
    foreign key (source_attachment_id, agency_id)
    references public.message_attachments(id, agency_id)
    on delete set null (source_attachment_id),
  constraint finance_evidence_intake_analysis_agency_fk
    foreign key (source_media_analysis_id, agency_id)
    references public.message_media_analyses(id, agency_id)
    on delete set null (source_media_analysis_id),
  constraint finance_evidence_intake_lead_agency_fk
    foreign key (lead_id, agency_id)
    references public.leads(id, agency_id)
    on delete set null (lead_id),
  constraint finance_evidence_intake_booking_agency_fk
    foreign key (booking_id, agency_id)
    references public.departure_group_bookings(id, agency_id)
    on delete set null (booking_id),
  constraint finance_evidence_intake_group_agency_fk
    foreign key (departure_group_id, agency_id)
    references public.departure_groups(id, agency_id)
    on delete set null (departure_group_id),
  constraint finance_evidence_intake_customer_agency_fk
    foreign key (customer_id, agency_id)
    references public.pilgrims(id, agency_id)
    on delete set null (customer_id),
  constraint finance_evidence_intake_payment_agency_fk
    foreign key (payment_id, agency_id)
    references public.payments(id, agency_id),

  constraint finance_evidence_intake_attachment_idempotency
    unique (agency_id, source_attachment_id),
  constraint finance_evidence_intake_storage_path_check
    check (storage_path ~ ('^' || agency_id::text || '/.+')),
  constraint finance_evidence_intake_checksum_check
    check (original_checksum_sha256 ~ '^[0-9A-Fa-f]{64}$'),
  constraint finance_evidence_intake_mime_check
    check (btrim(original_mime_type) <> ''),
  constraint finance_evidence_intake_candidate_amount_check
    check (candidate_amount is null or candidate_amount > 0),
  constraint finance_evidence_intake_candidate_confidence_check
    check (candidate_confidence is null or candidate_confidence between 0 and 1),
  constraint finance_evidence_intake_candidate_attribution_check
    check (jsonb_typeof(candidate_attribution) = 'object'),
  constraint finance_evidence_intake_review_state_check check (
    (status = 'PENDING_REVIEW' and payment_id is null and reviewed_at is null)
    or (status = 'MATCHED_TO_PAYMENT' and payment_id is not null and reviewed_at is not null)
    or (status = 'DISMISSED' and payment_id is null and reviewed_at is not null)
  ),
  constraint finance_evidence_intake_retention_check
    check (retention_expires_at > created_at),
  constraint finance_evidence_intake_legal_hold_check check (
    (legal_hold_at is null and legal_hold_by is null and legal_hold_reason is null)
    or (legal_hold_at is not null and nullif(btrim(legal_hold_reason), '') is not null)
  )
);

comment on table public.finance_evidence_intake is
  'Private receipt evidence awaiting Finance review. A row is not a payment and never records, verifies, allocates, or reconciles money.';
comment on column public.finance_evidence_intake.payment_id is
  'Optional link set only after the guarded Finance matching workflow; it does not change payment verification state.';
comment on column public.finance_evidence_intake.retention_expires_at is
  'For unmatched evidence, FIN-02 derives this from the agency Inbox attachment-retention policy. legal_hold_at overrides deletion.';

create unique index finance_evidence_intake_id_agency_unique
  on public.finance_evidence_intake (id, agency_id);
create index finance_evidence_intake_agency_status_created_idx
  on public.finance_evidence_intake (agency_id, status, created_at desc);
create index finance_evidence_intake_agency_conversation_idx
  on public.finance_evidence_intake (agency_id, source_conversation_id, created_at desc)
  where source_conversation_id is not null;
create index finance_evidence_intake_agency_payment_idx
  on public.finance_evidence_intake (agency_id, payment_id)
  where payment_id is not null;
create index finance_evidence_intake_agency_retention_idx
  on public.finance_evidence_intake (agency_id, retention_expires_at)
  where status = 'PENDING_REVIEW' and legal_hold_at is null;

create trigger finance_evidence_intake_set_updated_at
  before update on public.finance_evidence_intake
  for each row execute function public.set_updated_at();

alter table public.finance_evidence_intake enable row level security;
revoke all on table public.finance_evidence_intake from anon, authenticated;
grant select, insert, update on table public.finance_evidence_intake to authenticated;

create policy finance_evidence_intake_select
  on public.finance_evidence_intake for select to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and (select public.staff_role_in('ADMIN','CEO','FINANCE'))
  );

create policy finance_evidence_intake_insert
  on public.finance_evidence_intake for insert to authenticated
  with check (
    agency_id = (select public.current_agency_id())
    and (select public.staff_role_in('ADMIN','FINANCE'))
  );

create policy finance_evidence_intake_update
  on public.finance_evidence_intake for update to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and (select public.staff_role_in('ADMIN','FINANCE'))
  )
  with check (
    agency_id = (select public.current_agency_id())
    and (select public.staff_role_in('ADMIN','FINANCE'))
  );

-- Keep the shared Finance bucket private and replace its legacy permissive
-- policy names with explicit agency- and role-scoped policies. The effective
-- access remains compatible with the existing Finance proof uploader.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  10 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "staff read payment proofs" on storage.objects;
drop policy if exists "staff upload payment proofs" on storage.objects;
drop policy if exists "staff update payment proofs" on storage.objects;
drop policy if exists "staff delete payment proofs" on storage.objects;
drop policy if exists finance_evidence_payment_proofs_select on storage.objects;
drop policy if exists finance_evidence_payment_proofs_insert on storage.objects;
drop policy if exists finance_evidence_payment_proofs_update on storage.objects;
drop policy if exists finance_evidence_payment_proofs_delete on storage.objects;

create policy finance_evidence_payment_proofs_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and (select public.staff_role_in('ADMIN','CEO','FINANCE'))
  );

create policy finance_evidence_payment_proofs_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and (select public.staff_role_in('ADMIN','FINANCE'))
  );

create policy finance_evidence_payment_proofs_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and (select public.staff_role_in('ADMIN','FINANCE'))
  )
  with check (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and (select public.staff_role_in('ADMIN','FINANCE'))
  );

create policy finance_evidence_payment_proofs_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and (select public.staff_role_in('ADMIN','FINANCE'))
  );

notify pgrst, 'reload schema';
