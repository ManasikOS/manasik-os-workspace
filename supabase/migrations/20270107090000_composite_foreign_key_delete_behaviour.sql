-- TASK-032 S6: the browser run against a database built from nothing found two defects that staging hides.
--
-- 1. Six composite foreign keys (child_id, agency_id) -> parent(id, agency_id) were created with a bare `ON DELETE SET NULL`. For a composite key that
--    nulls EVERY referencing column, agency_id included, and agency_id is NOT NULL, so deleting the parent fails with
--    `null value in column "agency_id" ... violates not-null constraint`. Verified on a fresh build: deleting a lead that has a conversation is refused.
--    Postgres 15+ lets the action name the column: `ON DELETE SET NULL (lead_id)` clears only the link and keeps the row's agency.
--    Each of the six is re-created with the child column only. Affected: booking_sessions (booking, group, lead), conversations (lead),
--    inbox_autonomy_decisions (message), message_media_analyses (intervention). Idempotent: a key that already names its column is left alone.
--
-- 2. The Inbox loads each conversation with its lead through a named foreign key. On staging that key is the old single-column
--    `conversations_lead_id_fkey`; on a fresh build, 20260828090000 replaces it with the agency-scoped `conversations_lead_agency_fkey`, which the
--    application did not know, so the whole Inbox list failed ("Could not find a relationship between 'conversations' and 'leads'"). The application now
--    names `conversations_lead_agency_fkey`. This migration adds that key on a database that lacks it (staging) and leaves the old key in place, so the
--    build already deployed keeps working until the new one is live. The agency-scoped key is the safer one: a conversation can only point at a lead of
--    its own agency. A later cleanup can drop `conversations_lead_id_fkey` once the new build is deployed.
--
-- No data is changed. Rollback: re-create the keys without the column list (do not, it brings the delete failure back).

do $$
declare
  fk record;
  child_column text;
  definition text;
begin
  for fk in
    select c.oid, c.conrelid::regclass as child_table, c.conname, c.conkey
    from pg_constraint c
    where c.contype = 'f'
      and c.connamespace = 'public'::regnamespace
      and c.confdeltype = 'n'
      and array_length(c.conkey, 1) > 1
      and c.confdelsetcols is null
  loop
    select a.attname into child_column
    from pg_attribute a
    where a.attrelid = fk.child_table and a.attnum = fk.conkey[1];

    definition := pg_get_constraintdef(fk.oid);
    if definition !~ ' ON DELETE SET NULL$' then
      raise exception 'Unexpected definition for %.%: %', fk.child_table, fk.conname, definition;
    end if;

    execute format('alter table %s drop constraint %I', fk.child_table, fk.conname);
    execute format('alter table %s add constraint %I %s (%I)', fk.child_table, fk.conname, definition, child_column);
  end loop;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.conversations'::regclass and conname = 'conversations_lead_agency_fkey') then
    if exists (select 1 from public.conversations c join public.leads l on l.id = c.lead_id where l.agency_id is distinct from c.agency_id) then
      raise exception 'Cannot add conversations_lead_agency_fkey: a conversation points at a lead of another agency.';
    end if;
    alter table public.conversations
      add constraint conversations_lead_agency_fkey
        foreign key (lead_id, agency_id) references public.leads (id, agency_id) on delete set null (lead_id);
  end if;
end;
$$;

-- Guard: no composite key still nulls its agency column, and the key the application names exists.
do $$
declare
  v_problem text;
begin
  select string_agg(problem, '; ') into v_problem from (
    select 'a composite foreign key still clears every column on delete: ' || c.conrelid::regclass || '.' || c.conname as problem
      from pg_constraint c
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace and c.confdeltype = 'n' and array_length(c.conkey, 1) > 1 and c.confdelsetcols is null
    union all
    select 'conversations_lead_agency_fkey is missing'
     where not exists (select 1 from pg_constraint where conrelid = 'public.conversations'::regclass and conname = 'conversations_lead_agency_fkey')
  ) found;

  if v_problem is not null then
    raise exception 'Composite foreign key alignment: %', v_problem;
  end if;
end;
$$;
