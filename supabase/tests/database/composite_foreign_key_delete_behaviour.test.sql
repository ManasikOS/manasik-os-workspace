begin;

-- TASK-032 S6: composite foreign keys must clear only their own column when the parent is deleted, and the key the Inbox names must exist.
-- One transaction, rolled back. Expect zero rows from finish(). Passes on a database built from the repository and on staging after
-- 20270107090000_composite_foreign_key_delete_behaviour.sql.

create extension if not exists pgtap with schema extensions;
select plan(4);

select is_empty(
  $$select c.conrelid::regclass::text || '.' || c.conname from pg_constraint c
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace and c.confdeltype = 'n' and array_length(c.conkey, 1) > 1 and c.confdelsetcols is null$$,
  'No composite foreign key clears every referencing column (agency_id included) when its parent is deleted');

select ok(exists (select 1 from pg_constraint where conrelid = 'public.conversations'::regclass and conname = 'conversations_lead_agency_fkey'),
  'conversations_lead_agency_fkey exists: the Inbox embeds the lead through it');

insert into public.agencies (id, name, slug, status) values ('10000000-0000-4000-8000-0000000000d1', 'FK Delete Agency', 'fk-delete-agency', 'ACTIVE');
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('11000000-0000-4000-8000-0000000000d1', 'authenticated', 'authenticated', 'owner@fkdelete.test', '', now(), '{}', '{}', now(), now());
insert into public.staff_profiles (id, agency_id, full_name, email, role, status)
  values ('11000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-0000000000d1', 'FK Owner', 'owner@fkdelete.test', 'ADMIN', 'ACTIVE');
insert into public.leads (id, agency_id, reference, full_name, mobile, assigned_to_id, assigned_to_name)
  values ('1e000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-0000000000d1', 'FKD-1', 'FK Lead', '+1', '11000000-0000-4000-8000-0000000000d1', 'FK Owner');
insert into public.conversations (id, agency_id, channel, external_conversation_id, contact_name, lead_id)
  values ('1c000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-0000000000d1', 'WHATSAPP', 'fk-delete-1', 'FK Contact', '1e000000-0000-4000-8000-0000000000d1');

select lives_ok($$delete from public.leads where id = '1e000000-0000-4000-8000-0000000000d1'$$, 'A lead that has a conversation can be deleted');
select results_eq(
  $$select lead_id is null, agency_id = '10000000-0000-4000-8000-0000000000d1'::uuid from public.conversations where id = '1c000000-0000-4000-8000-0000000000d1'$$,
  $$values (true, true)$$,
  'The conversation keeps its agency and only loses the link to the deleted lead');

select * from finish();
rollback;
