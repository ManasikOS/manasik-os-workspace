-- Agency self-onboarding, Slice 6 (docs/onboarding/plan.md §12 Slice 6): funnel events.
--
-- One row per thing that happened in the guided setup, so the platform operator
-- can see where new agencies stall. The columns are closed sets (a step id, a
-- connector id, an event name) and there is deliberately no free-text column:
-- nothing a person typed, and no provider response, is ever stored here.
--
-- Service-role only. Setup code writes it with the service-role client, always
-- with an explicit agency_id; the operator console reads it the same way.

create table if not exists public.onboarding_events (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  event       text not null check (event in (
                'STEP_VIEWED', 'STEP_COMPLETED', 'STEP_SKIPPED',
                'CONNECTOR_STARTED', 'CONNECTOR_SUCCEEDED', 'CONNECTOR_FAILED'
              )),
  step        text check (step is null or step in ('account', 'agency', 'team', 'channels', 'payments', 'package')),
  connector   text check (connector is null or connector in ('whatsapp', 'messenger', 'instagram', 'email', 'meta_ads', 'google_ads')),
  created_at  timestamptz not null default now(),
  -- A step event names its step; a connector event names its connector.
  check (
    (event like 'STEP_%' and step is not null and connector is null)
    or (event like 'CONNECTOR_%' and connector is not null and step is null)
  )
);

comment on table public.onboarding_events is
  'Setup-guide funnel events (docs/onboarding/plan.md Slice 6). Closed vocabularies only; no free text. Service-role only.';

create index if not exists onboarding_events_agency_recent
  on public.onboarding_events (agency_id, created_at desc);
create index if not exists onboarding_events_event_recent
  on public.onboarding_events (event, created_at desc);

alter table public.onboarding_events enable row level security;
-- No policies on purpose: nothing but the service role may read or write it.
revoke all on public.onboarding_events from public, anon, authenticated;
