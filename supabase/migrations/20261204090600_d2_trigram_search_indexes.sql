-- D2 (docs/inbox/scale-inngest-implementation-plan.md, Phase D): make the Inbox search use an index.
--
-- The Inbox search (lib/data/inbox-repository.ts, searchInboxConversations) runs
--   leads:         reference ILIKE '%q%' OR full_name ILIKE '%q%' OR desired_package_name ILIKE '%q%'
--   conversations: contact_name ILIKE '%q%' OR contact_phone ILIKE '%q%'
-- A leading-wildcard ILIKE cannot use a btree, so every search read the agency's whole table. A trigram GIN index serves it. An OR is
-- only index-assisted when EVERY arm has an index, so `desired_package_name` (in the query, not in the plan's list) is indexed too.
--
-- 1. pg_trgm moves out of `public` into `extensions`, where Supabase keeps extensions (the database advisor flags it in `public`:
--    an extension's functions and operators in `public` are reachable by every role through the default search path). Nothing in the
--    repository calls a pg_trgm function or operator; the only users are the four existing trigram indexes on `packages` and
--    `package_content`, which reference the operator class by identity and keep working.
-- 2. Five GIN trigram indexes, built with the operator class schema-qualified so this migration does not depend on the search path.
--
-- These indexes are built inside the migration's transaction, which blocks writes to the table while it builds. That is instant at
-- today's size. On a table of millions of rows, create them by hand instead, one at a time and outside a transaction:
--   create index concurrently ... using gin (col extensions.gin_trgm_ops);
-- and skip this migration's `create index` lines (they use `if not exists`, so a later run is a no-op).
--
-- Cost: each index adds work to every insert and update of its column. These columns change rarely (a name, a phone, a reference).

create schema if not exists extensions;
alter extension pg_trgm set schema extensions;

create index if not exists conversations_contact_name_trgm_idx
  on public.conversations using gin (contact_name extensions.gin_trgm_ops);
create index if not exists conversations_contact_phone_trgm_idx
  on public.conversations using gin (contact_phone extensions.gin_trgm_ops);
create index if not exists leads_reference_trgm_idx
  on public.leads using gin (reference extensions.gin_trgm_ops);
create index if not exists leads_full_name_trgm_idx
  on public.leads using gin (full_name extensions.gin_trgm_ops);
create index if not exists leads_desired_package_name_trgm_idx
  on public.leads using gin (desired_package_name extensions.gin_trgm_ops);
