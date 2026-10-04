-- Phase 1 (P1.4) — Quotes lifecycle, detail page, conversion. docs/manasik-
-- intelligence-build-roadmap.md §P1.4, plan §4.4.
--
-- Extends 20260812100000_create_leads.sql / 20260930090000_leads_sales_
-- intelligence.sql's `lead_quotes` rather than forking a new table — quotes
-- are still read/written through the same whole-store diff pattern as
-- every other `lead_*` table (`lib/data/leads-repository.ts`).

alter table public.lead_quotes drop constraint if exists lead_quotes_status_check;
alter table public.lead_quotes add constraint lead_quotes_status_check
  check (status in ('DRAFT', 'PENDING_APPROVAL', 'SENT', 'VIEWED', 'EXPIRED', 'ACCEPTED', 'DECLINED', 'SUPERSEDED', 'CANCELLED'));

alter table public.lead_quotes
  add column if not exists supersedes_quote_id  uuid references public.lead_quotes (id) on delete set null,
  add column if not exists viewed_at             timestamptz,
  add column if not exists cancelled_at           timestamptz,
  add column if not exists rejection_reason        text,
  add column if not exists owner_id               uuid,
  add column if not exists discount_approved_by    text,
  add column if not exists discount_approved_at    timestamptz,
  -- Nullable, set once by convertQuoteToBooking() — plan §4.4 gap 8. Not a
  -- new lookup path: bookings already link back via
  -- `departure_group_bookings.lead_id`; this is only for "has this quote
  -- already been converted" idempotency and a direct link from the quote.
  add column if not exists booking_id              uuid references public.departure_group_bookings (id) on delete set null,
  -- Portal token infra for gap 6's secure customer view — the column exists
  -- so a later slice can add the viewer route without another migration;
  -- nothing in this slice issues or checks a token.
  add column if not exists portal_token_hash       text;

create index if not exists lead_quotes_supersedes_idx on public.lead_quotes (supersedes_quote_id) where supersedes_quote_id is not null;
create index if not exists lead_quotes_booking_idx on public.lead_quotes (booking_id) where booking_id is not null;
create index if not exists lead_quotes_status_valid_until_idx on public.lead_quotes (status, valid_until);

-- ── quote_line_items ─────────────────────────────────────────────────────────
-- Plan §4.4 gap 3 (per-party vs per-pilgrim pricing). Schema-complete for a
-- future slice's line-item editor in the quote builder — this slice's
-- detail page still reads the existing `pricing_snapshot` +
-- `payment_milestones` columns, which already carry every figure the
-- Commercials/Payment Plan tabs show; documented as deferred rather than
-- silently unused.
create table if not exists public.quote_line_items (
  id         uuid primary key default gen_random_uuid(),
  quote_id   uuid not null references public.lead_quotes (id) on delete cascade,
  scope      text not null check (scope in ('PARTY', 'PILGRIM')),
  pilgrim_id uuid,
  label      text not null,
  qty        integer not null default 1 check (qty > 0),
  unit       text not null default 'PERSON',
  unit_price numeric(14, 2) not null default 0,
  total      numeric(14, 2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists quote_line_items_quote_idx on public.quote_line_items (quote_id);

alter table public.quote_line_items enable row level security;

drop policy if exists "staff read quote_line_items" on public.quote_line_items;
create policy "staff read quote_line_items" on public.quote_line_items
  for select to authenticated using (true);

drop policy if exists "staff write quote_line_items" on public.quote_line_items;
create policy "staff write quote_line_items" on public.quote_line_items
  for all to authenticated using (true) with check (true);
