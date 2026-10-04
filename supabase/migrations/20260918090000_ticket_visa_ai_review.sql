-- Per-pilgrim flight ticket upload, and AI-assisted review of both the
-- uploaded ticket and the already-issued visa.
--
-- Context: a departure group tracks per-pilgrim `flight_status` and
-- `visa_status`, but nothing lets staff attach the actual ticket file to a
-- pilgrim, and nothing checks an uploaded ticket or visa against the facts
-- already on file (the pilgrim's name/passport, the group's booked flight
-- legs, the return date) — a name typo or a wrong flight date on a ticket is
-- only ever caught by a human re-reading it. This adds the ticket file
-- columns (visa already has `visa_file_path` from an earlier migration, just
-- never wired to a real upload) and a small, symmetric set of AI-review
-- columns for both.
--
-- The AI review is assistive only, mirroring `document_ai_analyses`'
-- posture: it never changes `visa_status`, and only ever nudges
-- `flight_status` to the existing `NAME_MISMATCH` value it already had a slot
-- for — nothing here is a new source of truth a human doesn't confirm.

alter table public.departure_group_pilgrims
  add column if not exists ticket_file_path text,
  add column if not exists ticket_file_name text,
  add column if not exists ticket_uploaded_at timestamptz,
  add column if not exists ticket_uploaded_by uuid references auth.users (id) on delete set null,
  add column if not exists ticket_ai_status text
    check (ticket_ai_status is null or ticket_ai_status in ('PENDING', 'RUNNING', 'COMPLETE', 'FAILED')),
  add column if not exists ticket_ai_extracted jsonb,
  add column if not exists ticket_ai_issues jsonb,
  add column if not exists ticket_ai_analyzed_at timestamptz,
  add column if not exists ticket_ai_error text,
  add column if not exists visa_ai_status text
    check (visa_ai_status is null or visa_ai_status in ('PENDING', 'RUNNING', 'COMPLETE', 'FAILED')),
  add column if not exists visa_ai_extracted jsonb,
  add column if not exists visa_ai_issues jsonb,
  add column if not exists visa_ai_analyzed_at timestamptz,
  add column if not exists visa_ai_error text;

comment on column public.departure_group_pilgrims.ticket_file_path is
  'Object path in the private pilgrim-documents bucket. Never a public URL — exchanged for a signed URL on demand, same as visa_file_path.';
comment on column public.departure_group_pilgrims.ticket_ai_issues is
  'Array of {code, severity, message} findings from the AI ticket review — e.g. a passenger-name or flight-date mismatch against the group''s booked flight. Assistive only; a human still decides.';
comment on column public.departure_group_pilgrims.visa_ai_issues is
  'Array of {code, severity, message} findings from the AI visa review — e.g. a name/passport-number mismatch or an expiry inside the six-month window. Never changes visa_status itself.';

notify pgrst, 'reload schema';
