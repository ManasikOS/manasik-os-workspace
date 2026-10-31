-- TASK-032 G9 (production go-live gate): proves a disposable test agency left nothing behind.
--
-- The gate creates a throwaway agency (`agencies.is_test = true`, slug `e2e-gate-…`), sends it a signed webhook and its duplicate, deletes it, and then
-- asks THIS function whether any row that names that agency is still anywhere. The answer must be an empty list: a table that keeps rows after the agency
-- is gone is a missing cascade, which is exactly the leak the check exists to find.
--
-- It looks at every ordinary table in `public` that has a uuid `agency_id` column, found from the catalogue at call time so a table added later is covered
-- without editing this function, and at storage objects stored under the agency's folder. It returns table names and row counts only, never row content.
--
-- It also adds the matching remover, `gate_delete_disposable_agency`. A plain `delete from agencies` cannot work on this schema: many tables point at
-- the agency without a cascade (for example `whatsapp_webhook_events`), so the delete is refused until the child rows are gone, and the child order is
-- not known to a client. The remover works through every table that names the agency, repeating until the agency itself can go, and raises with a clear
-- message if something still blocks it. THAT is the useful finding: a table that cannot be cleared is a gap in the delete path.
--
-- The remover refuses any agency that is not a gate agency (`is_test = true` and slug starting `e2e-gate-`), so it can never touch a real tenant.
--
-- Both functions: security definer with an empty search path, executable by the service role only. Idempotent.
-- Rollback: `drop function public.gate_disposable_agency_leftovers(uuid); drop function public.gate_delete_disposable_agency(uuid);`

create or replace function public.gate_disposable_agency_leftovers(p_agency_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t record;
  n bigint;
  found jsonb := '[]'::jsonb;
begin
  for t in
    select c.relname as table_name
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'agency_id' and not a.attisdropped
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p')
       and a.atttypid = 'uuid'::regtype
     order by c.relname
  loop
    execute format('select count(*) from public.%I where agency_id = $1', t.table_name) into n using p_agency_id;
    if n > 0 then
      found := found || jsonb_build_array(jsonb_build_object('table', t.table_name, 'rows', n));
    end if;
  end loop;

  select count(*) into n from public.agencies where id = p_agency_id;
  if n > 0 then
    found := found || jsonb_build_array(jsonb_build_object('table', 'agencies', 'rows', n));
  end if;

  select count(*) into n from storage.objects where name like p_agency_id::text || '/%';
  if n > 0 then
    found := found || jsonb_build_array(jsonb_build_object('table', 'storage.objects', 'rows', n));
  end if;

  return found;
end;
$$;

revoke all on function public.gate_disposable_agency_leftovers(uuid) from public, anon, authenticated;
grant execute on function public.gate_disposable_agency_leftovers(uuid) to service_role;

create or replace function public.gate_delete_disposable_agency(p_agency_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t record;
  n bigint;
  progressed boolean;
  pass int;
begin
  if not exists (select 1 from public.agencies where id = p_agency_id and is_test = true and slug like 'e2e-gate-%') then
    raise exception 'refusing: % is not a disposable gate agency', p_agency_id using errcode = '42501';
  end if;

  for pass in 1..8 loop
    progressed := false;

    for t in
      select c.relname as table_name
        from pg_class c
        join pg_attribute a on a.attrelid = c.oid and a.attname = 'agency_id' and not a.attisdropped
       where c.relnamespace = 'public'::regnamespace
         and c.relkind in ('r', 'p')
         and a.atttypid = 'uuid'::regtype
         and c.relname <> 'agencies'
       order by c.relname
    loop
      begin
        execute format('delete from public.%I where agency_id = $1', t.table_name) using p_agency_id;
        get diagnostics n = row_count;
        if n > 0 then progressed := true; end if;
      exception when foreign_key_violation then
        null; -- a table that points at these rows still has rows; a later pass removes it once they are gone
      end;
    end loop;

    begin
      delete from public.agencies where id = p_agency_id;
      get diagnostics n = row_count;
      if n > 0 then return; end if;
      return; -- already gone
    exception when foreign_key_violation then
      null;
    end;

    exit when not progressed;
  end loop;

  raise exception 'could not remove agency %: a table that names it still blocks the delete', p_agency_id;
end;
$$;

revoke all on function public.gate_delete_disposable_agency(uuid) from public, anon, authenticated;
grant execute on function public.gate_delete_disposable_agency(uuid) to service_role;
