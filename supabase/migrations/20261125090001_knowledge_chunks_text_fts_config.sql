-- Follow-up to 20261125090000_knowledge_base_foundations.sql.
--
-- Supabase's security advisor flags `knowledge_chunks.fts_config` (type regconfig): a reg* column
-- outside pg_catalog blocks `pg_upgrade`, i.e. major-version database upgrades. Store the choice as
-- plain text instead and let the generated tsvector pick the configuration with a CASE over
-- constant regconfig literals, which is still an immutable expression.
--
-- Written as a rebuild that preserves any existing values (the table was empty when this was
-- applied, but a rebuild that loses data is a bad habit): copy into a new text column, drop the old
-- column and the tsvector that depends on it, rename, recreate.

alter table public.knowledge_chunks
  add column if not exists fts_config_text text not null default 'simple'
  check (fts_config_text in ('english', 'simple'));

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'knowledge_chunks'
      and column_name = 'fts_config' and udt_name = 'regconfig'
  ) then
    update public.knowledge_chunks
      set fts_config_text = case when fts_config = 'english'::regconfig then 'english' else 'simple' end;

    drop index if exists public.knowledge_chunks_tsv_idx;
    alter table public.knowledge_chunks drop column content_tsv;
    alter table public.knowledge_chunks drop column fts_config;
    alter table public.knowledge_chunks rename column fts_config_text to fts_config;

    alter table public.knowledge_chunks
      add column content_tsv tsvector generated always as (
        case when fts_config = 'english'
             then to_tsvector('english'::regconfig, content)
             else to_tsvector('simple'::regconfig, content)
        end
      ) stored;

    create index knowledge_chunks_tsv_idx on public.knowledge_chunks using gin (content_tsv);
  end if;
end $$;

-- Same function, comparing the text column instead of a regconfig.
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
      select case when b.fts_config = 'english'
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
