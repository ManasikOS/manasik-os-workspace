-- ─────────────────────────────────────────────────────────────────────────────
-- Content & Templates (M6) — content_items / content_item_versions.
--
-- This is deliberately NOT another templating system: `message_templates`
-- (supabase/migrations covering settings) and `whatsapp_templates`
-- (20260925090000_whatsapp_connection_modes.sql, mirrored from Meta) already
-- own structured, channel-bound message templates with their own approval
-- workflows — WhatsApp template status in particular must stay wherever the
-- Meta sync writes it. `content_items` instead covers the marketing
-- collateral that doesn't fit that shape: offer copy, social captions,
-- brochure/asset links — freeform content that Campaigns/Announcements can
-- point at, versioned because marketing copy gets revised in place.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),

  title text not null,
  content_type text not null check (
    content_type in ('OFFER_COPY', 'SOCIAL_CAPTION', 'BROCHURE_LINK', 'IMAGE_LINK', 'LANDING_PAGE_COPY', 'OTHER')
  ),
  body text,
  external_url text,
  tags text[] not null default '{}',
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  current_version integer not null default 1,

  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.content_items is
  'Freeform marketing content (offer copy, captions, asset links) referenced by Campaigns/Announcements. Structured message templates stay in message_templates / whatsapp_templates.';

create index if not exists content_items_agency_idx on public.content_items (agency_id);

alter table public.content_items enable row level security;

drop policy if exists "staff read content_items" on public.content_items;
create policy "staff read content_items" on public.content_items
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write content_items" on public.content_items;
create policy "staff write content_items" on public.content_items
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'));

-- ─────────────────────────────────────────────────────────────────────────────
-- content_item_versions — append-only history. A new row is written every
-- time body/external_url changes; content_items.current_version always
-- points at the latest one, never edited in place.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.content_item_versions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies (id),
  content_item_id uuid not null references public.content_items (id) on delete cascade,

  version integer not null,
  body text,
  external_url text,

  changed_by_name text not null,
  created_at timestamptz not null default now(),

  unique (content_item_id, version)
);

comment on table public.content_item_versions is
  'Append-only revision history for one content_items row.';

create index if not exists content_item_versions_item_idx on public.content_item_versions (content_item_id, version desc);
create index if not exists content_item_versions_agency_idx on public.content_item_versions (agency_id);

alter table public.content_item_versions enable row level security;

drop policy if exists "staff read content_item_versions" on public.content_item_versions;
create policy "staff read content_item_versions" on public.content_item_versions
  for select to authenticated
  using (agency_id = public.current_agency_id());

drop policy if exists "staff write content_item_versions" on public.content_item_versions;
create policy "staff write content_item_versions" on public.content_item_versions
  for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'))
  with check (agency_id = public.current_agency_id() and public.staff_role_in('ADMIN', 'CEO', 'MARKETING'));

notify pgrst, 'reload schema';
