-- WhatsApp knowledge base — P0 foundations (docs/modules/whatsapp-knowledge-base-implementation-plan.md).
--
-- Lets the WhatsApp assistant answer policy questions from the agency's own written documents.
-- Documents and chunks are agency-private. The assistant reads them with the service-role client
-- (a webhook has no session), so retrieval goes through search_knowledge_chunks(), which only
-- service_role may execute — see §E.
--
-- Also captures public.knowledge_articles, which already exists in production but was never created
-- by any migration in this repo (schema drift), and closes its tenancy gap (§A).

-- ─────────────────────────────────────────────────────────────────────────────
-- A. knowledge_articles — capture the production definition, then close its gaps.
--
-- `create table if not exists` is a no-op on production and creates the same shape everywhere else.
-- The production table has agency_id nullable and with no foreign key, so a row could belong to no
-- agency. It is empty and unused, so tightening it is free: backfill any nulls to the first agency
-- (there is only ever one on a database this could hold rows in), then NOT NULL + FK.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.knowledge_articles (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid,
  title       text not null,
  body        text not null,
  category    text not null default 'FAQ',
  language    text not null default 'en',
  is_active   boolean not null default true,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  search      tsvector generated always as (
                to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(body, ''))
              ) stored
);

create index if not exists knowledge_articles_search_idx on public.knowledge_articles using gin (search);
create index if not exists knowledge_articles_active_idx on public.knowledge_articles (is_active, language);

drop trigger if exists knowledge_articles_set_updated_at on public.knowledge_articles;
create trigger knowledge_articles_set_updated_at
  before update on public.knowledge_articles
  for each row execute function public.set_updated_at();

do $$
declare
  v_agency_id uuid;
begin
  select id into v_agency_id from public.agencies order by created_at asc limit 1;
  if v_agency_id is not null then
    update public.knowledge_articles set agency_id = v_agency_id where agency_id is null;
  end if;

  if not exists (select 1 from public.knowledge_articles where agency_id is null) then
    alter table public.knowledge_articles alter column agency_id set not null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.knowledge_articles'::regclass and conname = 'knowledge_articles_agency_id_fkey'
  ) then
    alter table public.knowledge_articles
      add constraint knowledge_articles_agency_id_fkey
      foreign key (agency_id) references public.agencies(id);
  end if;
end $$;

create index if not exists knowledge_articles_agency_idx on public.knowledge_articles (agency_id);

alter table public.knowledge_articles enable row level security;

drop policy if exists "staff read knowledge_articles" on public.knowledge_articles;
create policy "staff read knowledge_articles" on public.knowledge_articles
  for select to authenticated
  using (
    public.staff_role_in('ADMIN', 'CEO', 'MARKETING', 'OPERATIONS', 'VISA', 'FINANCE')
    and agency_id = (select public.current_agency_id())
  );

drop policy if exists "admin write knowledge_articles" on public.knowledge_articles;
create policy "admin write knowledge_articles" on public.knowledge_articles
  for all to authenticated
  using (
    public.staff_role_in('ADMIN', 'MARKETING')
    and agency_id = (select public.current_agency_id())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- B. pgvector, in the `extensions` schema like pg_net (20260927090000_cron_jobs.sql).
-- ─────────────────────────────────────────────────────────────────────────────
create extension if not exists vector with schema extensions;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. knowledge_documents / knowledge_chunks
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.knowledge_documents (
  id                 uuid primary key default gen_random_uuid(),
  agency_id          uuid not null references public.agencies(id),
  title              text not null check (length(btrim(title)) between 1 and 200),
  source_kind        text not null check (source_kind in ('UPLOAD', 'ARTICLE')),
  article_id         uuid references public.knowledge_articles(id) on delete cascade,
  storage_path       text,
  mime_type          text,
  byte_size          integer check (byte_size is null or byte_size > 0),
  content_hash       text,
  document_kind      text not null default 'GENERAL'
                       check (document_kind in ('POLICY', 'FAQ', 'VISA_AND_HEALTH', 'GENERAL')),
  language           text not null default 'en' check (language in ('en', 'si', 'ta')),
  is_active          boolean not null default true,
  status             text not null default 'UPLOADED'
                       check (status in ('UPLOADED', 'EXTRACTING', 'CHUNKING', 'EMBEDDING', 'READY', 'FAILED')),
  status_detail      text,
  has_price_warning  boolean not null default false,
  chunk_count        integer not null default 0 check (chunk_count >= 0),
  embedding_model    text,
  uploaded_by        uuid references auth.users(id) on delete set null,
  uploaded_by_name   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- An upload must say where its file is and be de-duplicable; an article must point at its article.
  constraint knowledge_documents_source_shape check (
    (source_kind = 'UPLOAD' and storage_path is not null and mime_type is not null and content_hash is not null)
    or (source_kind = 'ARTICLE' and article_id is not null)
  ),
  constraint knowledge_documents_agency_hash_unique unique (agency_id, content_hash)
);

create index if not exists knowledge_documents_agency_status_idx on public.knowledge_documents (agency_id, status);
create index if not exists knowledge_documents_agency_active_idx on public.knowledge_documents (agency_id, is_active);

drop trigger if exists knowledge_documents_set_updated_at on public.knowledge_documents;
create trigger knowledge_documents_set_updated_at
  before update on public.knowledge_documents
  for each row execute function public.set_updated_at();

create table if not exists public.knowledge_chunks (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references public.agencies(id),
  document_id     uuid not null references public.knowledge_documents(id) on delete cascade,
  chunk_index     integer not null check (chunk_index >= 0),
  content         text not null check (length(content) > 0),
  token_estimate  integer not null default 0 check (token_estimate >= 0),
  -- English gets stemming and stop-word removal; Sinhala and Tamil have no built-in Postgres
  -- configuration, so they use 'simple' and rely on the vector path (plan D1, D7).
  fts_config      regconfig not null default 'simple'::regconfig,
  content_tsv     tsvector generated always as (to_tsvector(fts_config, content)) stored,
  -- Null until the vector phase embeds it, or when embedding failed; full-text still works.
  embedding       extensions.vector(1024),
  created_at      timestamptz not null default now(),
  constraint knowledge_chunks_document_index_unique unique (document_id, chunk_index)
);

create index if not exists knowledge_chunks_agency_document_idx on public.knowledge_chunks (agency_id, document_id);
create index if not exists knowledge_chunks_tsv_idx on public.knowledge_chunks using gin (content_tsv);
create index if not exists knowledge_chunks_embedding_idx
  on public.knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);

comment on table public.knowledge_documents is
  'Agency-written policy documents (uploads or articles) the WhatsApp assistant may quote. Never a source of prices, seats or dates — those come from the CRM tools only.';
comment on table public.knowledge_chunks is
  'Searchable pieces of knowledge_documents. Deliberately has NO client policies: only the service role reads or writes it, through search_knowledge_chunks().';

-- ─────────────────────────────────────────────────────────────────────────────
-- D. RLS. Documents: ADMIN/CEO/MARKETING read, ADMIN write. Chunks: no client access at all.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks enable row level security;

drop policy if exists "staff read knowledge_documents" on public.knowledge_documents;
create policy "staff read knowledge_documents" on public.knowledge_documents
  for select to authenticated
  using (
    public.staff_role_in('ADMIN', 'CEO', 'MARKETING')
    and agency_id = (select public.current_agency_id())
  );

drop policy if exists "admin write knowledge_documents" on public.knowledge_documents;
create policy "admin write knowledge_documents" on public.knowledge_documents
  for all to authenticated
  using (
    public.staff_role_in('ADMIN')
    and agency_id = (select public.current_agency_id())
  )
  with check (
    public.staff_role_in('ADMIN')
    and agency_id = (select public.current_agency_id())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- E. Capability flag + retrieval function.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.ai_settings
  add column if not exists knowledge_base_enabled boolean not null default false;

-- Returns candidate chunks with their raw signals; the caller (the agent tool) decides the relevance
-- floor, because the right cut-off has to be tuned on real documents.
--   fts_rank           ts_rank_cd of an OR-of-terms match (real, > 0 when any content word matched)
--   vector_similarity  1 - cosine distance, only when p_query_embedding is supplied
--   score              reciprocal-rank fusion of the two orderings, used only for sorting
--
-- OR rather than AND: a natural-language question contains words the document never uses, so an
-- all-words match returns nothing. English chunks are matched with the 'english' configuration
-- (stemming, stop words removed) and everything else with 'simple', mirroring how each chunk's
-- content_tsv was built.
--
-- SECURITY: p_agency_id is caller-supplied and this reads across agencies' rows, so it must never be
-- callable by a signed-in user — they could pass another agency's id. Execute is revoked from
-- everyone but service_role below; both tables are also filtered by the agency explicitly.
create or replace function public.search_knowledge_chunks(
  p_agency_id        uuid,
  p_query            text,
  p_query_embedding  extensions.vector(1024) default null,
  p_limit            integer default 8
)
returns table (
  chunk_id           uuid,
  document_id        uuid,
  document_title     text,
  document_kind      text,
  content            text,
  fts_rank           real,
  vector_similarity  real,
  score              real
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with
  q_english as (
    select nullif(replace(plainto_tsquery('english'::regconfig, p_query)::text, '&', '|'), '')::tsquery as q
  ),
  q_simple as (
    select nullif(replace(plainto_tsquery('simple'::regconfig, p_query)::text, '&', '|'), '')::tsquery as q
  ),
  base as (
    select c.id, c.document_id, c.content, c.content_tsv, c.embedding, c.fts_config,
           d.title as document_title, d.document_kind
    from public.knowledge_chunks c
    join public.knowledge_documents d on d.id = c.document_id
    where c.agency_id = p_agency_id
      and d.agency_id = p_agency_id
      and d.is_active
      and d.status = 'READY'
  ),
  fts as (
    select b.id, ts_rank_cd(b.content_tsv, x.q) as rank,
           row_number() over (order by ts_rank_cd(b.content_tsv, x.q) desc, b.id) as pos
    from base b
    cross join lateral (
      select case when b.fts_config = 'english'::regconfig
                  then (select q from q_english) else (select q from q_simple) end as q
    ) x
    where x.q is not null and b.content_tsv @@ x.q
    order by rank desc, b.id
    limit 20
  ),
  vec as (
    select b.id, 1 - (b.embedding <=> p_query_embedding) as sim,
           row_number() over (order by b.embedding <=> p_query_embedding, b.id) as pos
    from base b
    where p_query_embedding is not null and b.embedding is not null
    order by b.embedding <=> p_query_embedding, b.id
    limit 20
  ),
  fused as (
    select coalesce(f.id, v.id) as id,
           f.rank as fts_rank,
           v.sim as vector_similarity,
           coalesce(1.0 / (60 + f.pos), 0) + coalesce(1.0 / (60 + v.pos), 0) as score
    from fts f
    full outer join vec v on v.id = f.id
  )
  select b.id, b.document_id, b.document_title, b.document_kind, b.content,
         coalesce(fused.fts_rank, 0)::real,
         fused.vector_similarity::real,
         fused.score::real
  from fused
  join base b on b.id = fused.id
  order by fused.score desc, b.id
  limit greatest(1, least(coalesce(p_limit, 8), 20));
$$;

revoke all on function public.search_knowledge_chunks(uuid, text, extensions.vector, integer) from public;
revoke all on function public.search_knowledge_chunks(uuid, text, extensions.vector, integer) from anon, authenticated;
grant execute on function public.search_knowledge_chunks(uuid, text, extensions.vector, integer) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- F. Private storage bucket, tenant-prefixed like 20260827090000_tenant_storage_isolation.sql.
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('knowledge-base', 'knowledge-base', false, 10485760, array['application/pdf', 'text/plain', 'text/markdown'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "staff read knowledge base files" on storage.objects;
create policy "staff read knowledge base files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'knowledge-base'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN', 'CEO', 'MARKETING')
  );

drop policy if exists "admin upload knowledge base files" on storage.objects;
create policy "admin upload knowledge base files" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'knowledge-base'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN')
  );

drop policy if exists "admin update knowledge base files" on storage.objects;
create policy "admin update knowledge base files" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'knowledge-base'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN')
  )
  with check (
    bucket_id = 'knowledge-base'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN')
  );

drop policy if exists "admin delete knowledge base files" on storage.objects;
create policy "admin delete knowledge base files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'knowledge-base'
    and (storage.foldername(name))[1] = (select public.current_agency_id())::text
    and public.staff_role_in('ADMIN')
  );
