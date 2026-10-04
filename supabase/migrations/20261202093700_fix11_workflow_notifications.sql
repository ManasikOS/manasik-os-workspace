-- FIX11: a completed Inbox conversion must be visible to its responsible staff.
alter table public.staff_notifications drop constraint if exists staff_notifications_kind_check;
alter table public.staff_notifications
  add constraint staff_notifications_kind_check
  check (kind in ('PROPOSAL_PENDING', 'HANDOFF_WAITING', 'HANDOFF_ESCALATED', 'WORKFLOW_CREATED'));
