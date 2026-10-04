begin;

-- TASK-029 P2.4, finding F1: storage tenant isolation for the pilgrim-documents and whatsapp-media buckets.
-- Everything runs in one transaction and is rolled back. Expect zero rows from finish() when every assertion passes. Direct deletes on
-- storage tables are blocked by Supabase itself, so the delete rule is asserted from the policy definition.

create extension if not exists pgtap with schema extensions;
select plan(17);

insert into public.agencies (id, name, slug) values
  ('10000000-0000-4000-8000-0000000000a1', 'Storage Iso Agency A', 'storage-iso-agency-a'),
  ('20000000-0000-4000-8000-0000000000b2', 'Storage Iso Agency B', 'storage-iso-agency-b');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('11000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'ops-a@storageiso.test', '', now(), '{}', '{}', now(), now()),
  ('12000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'guide-a@storageiso.test', '', now(), '{}', '{}', now(), now()),
  ('21000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'ops-b@storageiso.test', '', now(), '{}', '{}', now(), now()),
  ('31000000-0000-4000-8000-0000000000c3', 'authenticated', 'authenticated', 'nobody@storageiso.test', '', now(), '{}', '{}', now(), now());

insert into public.staff_profiles (id, agency_id, full_name, email, role, status) values
  ('11000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'Operations A', 'ops-a@storageiso.test', 'OPERATIONS', 'ACTIVE'),
  ('12000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1', 'Guide A', 'guide-a@storageiso.test', 'GUIDE', 'ACTIVE'),
  ('21000000-0000-4000-8000-0000000000b2', '20000000-0000-4000-8000-0000000000b2', 'Operations B', 'ops-b@storageiso.test', 'OPERATIONS', 'ACTIVE');

insert into storage.objects (bucket_id, name) values
  ('pilgrim-documents', '10000000-0000-4000-8000-0000000000a1/passport-a.pdf'),
  ('pilgrim-documents', '20000000-0000-4000-8000-0000000000b2/passport-b.pdf'),
  ('whatsapp-media', '10000000-0000-4000-8000-0000000000a1/media-a.jpg'),
  ('whatsapp-media', '20000000-0000-4000-8000-0000000000b2/media-b.jpg');

-- Operations in agency A -------------------------------------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select results_eq($$select count(*) from storage.objects where bucket_id = 'pilgrim-documents'$$, array[1::bigint], 'Agency A operations sees only its own pilgrim documents');
select results_eq($$select count(*) from storage.objects where bucket_id = 'pilgrim-documents' and (storage.foldername(name))[1] = '20000000-0000-4000-8000-0000000000b2'$$, array[0::bigint], 'Agency A operations cannot see agency B pilgrim documents');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('pilgrim-documents', '10000000-0000-4000-8000-0000000000a1/new-a.pdf')$$, 'Agency A operations can upload into its own folder');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('pilgrim-documents', '20000000-0000-4000-8000-0000000000b2/planted.pdf')$$, '42501', null, 'Agency A operations cannot upload into agency B''s folder');
select results_eq($$with changed as (update storage.objects set metadata = '{"tampered":true}' where bucket_id = 'pilgrim-documents' and name like '20000000-%' returning 1) select count(*) from changed$$, array[0::bigint], 'Agency A operations cannot overwrite an agency B pilgrim document');
-- Supabase blocks direct SQL deletes on storage tables whatever the policy says (storage.protect_delete), so the delete rule is checked
-- by its definition rather than by trying a delete.
select ok(exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'staff delete pilgrim documents' and qual like '%current_agency_id%'), 'The pilgrim document delete policy is limited to the signed-in user''s own agency folder');
select results_eq($$select count(*) from storage.objects where bucket_id = 'whatsapp-media'$$, array[1::bigint], 'Agency A operations sees only its own WhatsApp media');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('whatsapp-media', '20000000-0000-4000-8000-0000000000b2/planted.jpg')$$, '42501', null, 'Agency A operations cannot upload WhatsApp media into agency B''s folder');

-- A guide in agency A (a role that may not read pilgrim documents) -------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"12000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select results_eq($$select count(*) from storage.objects where bucket_id = 'pilgrim-documents'$$, array[0::bigint], 'A guide in the right agency but the wrong role sees no pilgrim documents');

-- Operations in agency B -------------------------------------------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"21000000-0000-4000-8000-0000000000b2","role":"authenticated"}';
select results_eq($$select count(*) from storage.objects where bucket_id = 'pilgrim-documents'$$, array[1::bigint], 'Agency B operations sees only its own pilgrim documents');
select results_eq($$select count(*) from storage.objects where bucket_id = 'pilgrim-documents' and (storage.foldername(name))[1] = '10000000-0000-4000-8000-0000000000a1'$$, array[0::bigint], 'Agency B operations cannot see agency A pilgrim documents');
select results_eq($$select count(*) from storage.objects where bucket_id = 'whatsapp-media'$$, array[1::bigint], 'Agency B operations sees only its own WhatsApp media');

-- A signed-in user who belongs to no agency (a portal login or a new sign-up) ----------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"31000000-0000-4000-8000-0000000000c3","role":"authenticated"}';
select results_eq($$select count(*) from storage.objects where bucket_id = 'pilgrim-documents'$$, array[0::bigint], 'A signed-in user with no agency sees no pilgrim documents');
select results_eq($$select count(*) from storage.objects where bucket_id = 'whatsapp-media'$$, array[0::bigint], 'A signed-in user with no agency sees no WhatsApp media');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('pilgrim-documents', '10000000-0000-4000-8000-0000000000a1/planted-by-nobody.pdf')$$, '42501', null, 'A signed-in user with no agency cannot upload a pilgrim document');
select ok(exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'staff delete pilgrim documents' and qual like '%staff_role_in%'), 'The pilgrim document delete policy also requires a staff role, so a user with no agency cannot delete');

-- No policy on these two buckets lacks an agency check ---------------------------------------------------------------------------------
reset role;
select is_empty(
  $$select p.policyname from pg_policies p
     where p.schemaname = 'storage' and p.tablename = 'objects'
       and (coalesce(p.qual, '') || coalesce(p.with_check, '')) ~ 'bucket_id = ''(pilgrim-documents|whatsapp-media)'''
       and (coalesce(p.qual, '') || coalesce(p.with_check, '')) not like '%current_agency_id%'$$,
  'No storage policy on pilgrim-documents or whatsapp-media is missing the agency check');

select * from finish();
rollback;
