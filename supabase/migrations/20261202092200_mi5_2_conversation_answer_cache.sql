alter table public.agency_settings
  add column if not exists knowledge_version bigint not null default 1 check (knowledge_version > 0);

create table public.conversation_answer_cache (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies(id) on delete cascade,
  question_fingerprint text not null,
  normalized_question text not null,
  question_embedding extensions.vector(1024),
  answer_text text not null,
  intent_code text not null,
  knowledge_version bigint not null,
  source_chunk_ids uuid[] not null default '{}',
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  hit_count integer not null default 0 check (hit_count >= 0),
  rejection_count integer not null default 0 check (rejection_count >= 0),
  status text not null default 'CANDIDATE' check (status in ('CANDIDATE','APPROVED','RETIRED')),
  approved_by uuid references auth.users(id) on delete set null,
  retired_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz not null default (now() + interval '90 days'),
  unique (agency_id, question_fingerprint, knowledge_version)
);

create index conversation_answer_cache_embedding_idx
  on public.conversation_answer_cache using hnsw (question_embedding extensions.vector_cosine_ops);
create index conversation_answer_cache_lookup_idx
  on public.conversation_answer_cache (agency_id, knowledge_version, status, expires_at);
create unique index conversation_answer_cache_id_agency_unique
  on public.conversation_answer_cache (id, agency_id);

alter table public.conversation_answer_cache enable row level security;
revoke all on public.conversation_answer_cache from anon, authenticated;
grant select, insert, update on public.conversation_answer_cache to authenticated;

create policy conversation_answer_cache_select on public.conversation_answer_cache
  for select to authenticated
  using (agency_id = (select public.current_agency_id()));
create policy conversation_answer_cache_manage on public.conversation_answer_cache
  for all to authenticated
  using (
    agency_id = (select public.current_agency_id())
    and exists (
      select 1 from public.staff_profiles sp
      left join public.role_permissions rp on rp.role_id = sp.role_id and rp.module = 'insights'
      where sp.id = (select auth.uid())
        and coalesce((rp.capabilities ->> 'approveInboxAnswer')::boolean, public.staff_role_in('ADMIN','CEO'))
    )
  )
  with check (
    agency_id = (select public.current_agency_id())
    and exists (
      select 1 from public.staff_profiles sp
      left join public.role_permissions rp on rp.role_id = sp.role_id and rp.module = 'insights'
      where sp.id = (select auth.uid())
        and coalesce((rp.capabilities ->> 'approveInboxAnswer')::boolean, public.staff_role_in('ADMIN','CEO'))
    )
  );

create trigger conversation_answer_cache_set_updated_at before update on public.conversation_answer_cache
  for each row execute function public.set_updated_at();

create or replace function public.bump_inbox_knowledge_version()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare target_agency uuid;
begin
  target_agency := coalesce(new.agency_id, old.agency_id);
  update public.agency_settings
     set knowledge_version = knowledge_version + 1
   where agency_id = target_agency;
  return coalesce(new, old);
end;
$$;

create trigger knowledge_documents_bump_inbox_version after insert or update or delete on public.knowledge_documents
  for each row execute function public.bump_inbox_knowledge_version();
create trigger packages_bump_inbox_version after insert or update or delete on public.packages
  for each row execute function public.bump_inbox_knowledge_version();
create trigger departure_pricing_bump_inbox_version after insert or update or delete on public.departure_group_pricing
  for each row execute function public.bump_inbox_knowledge_version();

create or replace function public.match_conversation_answer_cache(
  p_agency_id uuid, p_embedding extensions.vector(1024), p_knowledge_version bigint, p_threshold numeric default 0.88
) returns table(id uuid, answer_text text, source_chunk_ids uuid[], similarity double precision)
language sql stable security invoker set search_path = '' as $$
  select c.id,c.answer_text,c.source_chunk_ids,1-(c.question_embedding operator(extensions.<=>) p_embedding) as similarity
  from public.conversation_answer_cache c
  where c.agency_id=p_agency_id
    and p_agency_id=public.current_agency_id()
    and c.status='APPROVED' and c.knowledge_version=p_knowledge_version
    and c.expires_at>now() and c.question_embedding is not null
    and 1-(c.question_embedding operator(extensions.<=>) p_embedding)>=p_threshold
  order by c.question_embedding operator(extensions.<=>) p_embedding limit 1;
$$;
revoke execute on function public.match_conversation_answer_cache(uuid,extensions.vector,bigint,numeric) from public, anon;
grant execute on function public.match_conversation_answer_cache(uuid,extensions.vector,bigint,numeric) to authenticated, service_role;

create or replace function public.record_conversation_answer_candidate(
  p_agency_id uuid,
  p_question_fingerprint text,
  p_normalized_question text,
  p_question_embedding extensions.vector(1024),
  p_answer_text text,
  p_intent_code text,
  p_knowledge_version bigint,
  p_source_chunk_ids uuid[] default '{}'
) returns table(id uuid, occurrence_count integer, status text)
language plpgsql security definer set search_path = '' as $$
begin
  if p_agency_id <> public.current_agency_id()
     and coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'agency mismatch';
  end if;
  return query
  insert into public.conversation_answer_cache (
    agency_id, question_fingerprint, normalized_question, question_embedding,
    answer_text, intent_code, knowledge_version, source_chunk_ids
  ) values (
    p_agency_id, p_question_fingerprint, p_normalized_question, p_question_embedding,
    p_answer_text, p_intent_code, p_knowledge_version, p_source_chunk_ids
  )
  on conflict (agency_id, question_fingerprint, knowledge_version) do update set
    occurrence_count = case
      when public.conversation_answer_cache.answer_text = excluded.answer_text
        then public.conversation_answer_cache.occurrence_count + 1
      else 1
    end,
    answer_text = excluded.answer_text,
    question_embedding = excluded.question_embedding,
    source_chunk_ids = excluded.source_chunk_ids,
    status = case
      when public.conversation_answer_cache.answer_text = excluded.answer_text
        and public.conversation_answer_cache.status = 'APPROVED' then 'APPROVED'
      else 'CANDIDATE'
    end,
    rejection_count = case
      when public.conversation_answer_cache.answer_text = excluded.answer_text
        then public.conversation_answer_cache.rejection_count
      else 0
    end,
    retired_reason = null,
    expires_at = now() + interval '90 days',
    updated_at = now()
  returning conversation_answer_cache.id, conversation_answer_cache.occurrence_count, conversation_answer_cache.status;
end;
$$;
revoke execute on function public.record_conversation_answer_candidate(uuid,text,text,extensions.vector,text,text,bigint,uuid[]) from public, anon;
grant execute on function public.record_conversation_answer_candidate(uuid,text,text,extensions.vector,text,text,bigint,uuid[]) to authenticated, service_role;

create or replace function public.record_conversation_answer_cache_hit(p_agency_id uuid, p_id uuid)
returns void language sql volatile security definer set search_path = '' as $$
  update public.conversation_answer_cache
     set hit_count = hit_count + 1, last_used_at = now(), expires_at = now() + interval '90 days'
   where id = p_id and agency_id = p_agency_id
     and (
       p_agency_id = public.current_agency_id()
       or coalesce((select auth.jwt() ->> 'role'), '') = 'service_role'
     );
$$;
revoke execute on function public.record_conversation_answer_cache_hit(uuid,uuid) from public, anon;
grant execute on function public.record_conversation_answer_cache_hit(uuid,uuid) to authenticated, service_role;

create or replace function public.reject_conversation_answer_cache_hit(
  p_agency_id uuid, p_id uuid, p_reason text
) returns table(rejection_count integer, status text)
language plpgsql security definer set search_path = '' as $$
begin
  if p_agency_id <> public.current_agency_id()
     and coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'agency mismatch';
  end if;
  return query
  update public.conversation_answer_cache c
     set rejection_count = c.rejection_count + 1,
         status = case when c.rejection_count + 1 >= 2 then 'RETIRED' else c.status end,
         retired_reason = case when c.rejection_count + 1 >= 2 then nullif(trim(p_reason), '') else c.retired_reason end,
         updated_at = now()
   where c.id = p_id and c.agency_id = p_agency_id and c.status = 'APPROVED'
  returning c.rejection_count, c.status;
end;
$$;
revoke execute on function public.reject_conversation_answer_cache_hit(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.reject_conversation_answer_cache_hit(uuid,uuid,text) to service_role;

create or replace view public.inbox_answer_cache_kpis
with (security_invoker = true) as
select agency_id,
       count(*) filter (where status = 'APPROVED')::bigint as approved_answers,
       coalesce(sum(hit_count), 0)::bigint as cache_hits,
       case when coalesce(sum(hit_count), 0) + count(*) filter (where occurrence_count > 0) = 0 then 0
            else round(coalesce(sum(hit_count), 0)::numeric /
                 (coalesce(sum(hit_count), 0) + count(*) filter (where occurrence_count > 0))::numeric, 4)
       end as estimated_hit_rate
from public.conversation_answer_cache
group by agency_id;
grant select on public.inbox_answer_cache_kpis to authenticated;

notify pgrst, 'reload schema';
