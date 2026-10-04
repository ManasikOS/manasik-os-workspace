-- Nusuk / regulatory identifiers on Departure Groups.
--
-- Context: docs/architecture/package-departure-architecture-master-plan.md, Phase 5 (F9).
--
-- Saudi's Masar Nusuk platform issues visas per GROUP, not per pilgrim: an
-- external agent adds pilgrims into a group, links the group to an Umrah
-- program with a contracted Saudi Umrah company, then submits that group for
-- visa issuance against an invoice. Every one of those identifiers — which
-- company, which program, which group/visa-batch reference, which invoice —
-- previously had nowhere to live in this schema; the Visa module tracked only
-- each pilgrim's own status, with no group-level record of the batch they
-- were actually submitted in.
--
-- `nusuk_status` is deliberately a coarse, group-level gate: it is not a
-- replacement for `departure_group_pilgrims.visa_status`, it is the batch
-- state those individual statuses roll up to, matching how the regulator
-- itself issues visas (per group, not per person).

alter table public.departure_groups
  add column if not exists umrah_company_name  text,
  add column if not exists nusuk_program_ref   text,
  add column if not exists nusuk_group_ref     text,
  add column if not exists visa_batch_ref      text,
  add column if not exists visa_invoice_ref    text,
  add column if not exists nusuk_status        text
    not null default 'NOT_LINKED'
    check (nusuk_status in (
      'NOT_LINKED', 'PROGRAM_LINKED', 'GROUP_SUBMITTED',
      'INVOICE_PENDING', 'INVOICE_PAID', 'VISAS_ISSUED', 'REJECTED'
    ));

comment on column public.departure_groups.umrah_company_name is
  'The Saudi Umrah company this departure is contracted through on Masar Nusuk.';
comment on column public.departure_groups.nusuk_program_ref is
  'The Nusuk program this group is linked to.';
comment on column public.departure_groups.nusuk_group_ref is
  'The group reference / batch id once submitted to Nusuk for visa issuance.';
comment on column public.departure_groups.visa_batch_ref is
  'Internal or ministry visa-batch reference for this group''s submission.';
comment on column public.departure_groups.visa_invoice_ref is
  'The Gulf International Bank invoice/reference paid to complete visa submission.';
comment on column public.departure_groups.nusuk_status is
  'Group-level Nusuk/visa-batch gate — the state individual pilgrim visa_status values roll up to. Never a substitute for departure_group_pilgrims.visa_status.';

create index if not exists departure_groups_nusuk_status_idx
  on public.departure_groups (nusuk_status);

notify pgrst, 'reload schema';
