begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

insert into public.agencies (id, name, slug) values ('10000000-0000-4000-8000-000000000001', 'MED-01 Agency A', 'med-01-agency-a'), ('20000000-0000-4000-8000-000000000002', 'MED-01 Agency B', 'med-01-agency-b');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('11000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ops-a@med01.test', '', now(), '{}', '{}', now(), now()),
  ('12000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'guide-a@med01.test', '', now(), '{}', '{}', now(), now()),
  ('21000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'ops-b@med01.test', '', now(), '{}', '{}', now(), now());

insert into public.staff_profiles (id, agency_id, full_name, email, role, status) values
  ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Operations A', 'ops-a@med01.test', 'OPERATIONS', 'ACTIVE'),
  ('12000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Guide A', 'guide-a@med01.test', 'GUIDE', 'ACTIVE'),
  ('21000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Operations B', 'ops-b@med01.test', 'OPERATIONS', 'ACTIVE');

insert into public.conversations (id, agency_id, external_conversation_id) values ('10000000-c000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'med01-a'), ('20000000-c000-4000-8000-00000000000b', '20000000-0000-4000-8000-000000000002', 'med01-b');

insert into public.conversation_messages (id, agency_id, conversation_id, role, actor_kind) values ('10000000-d000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', '10000000-c000-4000-8000-00000000000a', 'user', 'CUSTOMER'), ('20000000-d000-4000-8000-00000000000b', '20000000-0000-4000-8000-000000000002', '20000000-c000-4000-8000-00000000000b', 'user', 'CUSTOMER');

insert into public.message_attachments (id, agency_id, message_id) values ('10000000-e000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', '10000000-d000-4000-8000-00000000000a'), ('20000000-e000-4000-8000-00000000000b', '20000000-0000-4000-8000-000000000002', '20000000-d000-4000-8000-00000000000b'), ('10000000-e000-4000-8000-0000000000a2', '10000000-0000-4000-8000-000000000001', '10000000-d000-4000-8000-00000000000a'), ('10000000-e000-4000-8000-0000000000a3', '10000000-0000-4000-8000-000000000001', '10000000-d000-4000-8000-00000000000a'), ('10000000-e000-4000-8000-0000000000a4', '10000000-0000-4000-8000-000000000001', '10000000-d000-4000-8000-00000000000a');

insert into public.inbox_voice_transcripts (id, agency_id, attachment_id, message_id, status, transcript_text, language, confidence, completed_at) values
  ('10000000-f000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', '10000000-e000-4000-8000-00000000000a', '10000000-d000-4000-8000-00000000000a', 'COMPLETE', 'Salaam, I would like two seats.', 'en', 0.91, now()),
  ('20000000-f000-4000-8000-00000000000b', '20000000-0000-4000-8000-000000000002', '20000000-e000-4000-8000-00000000000b', '20000000-d000-4000-8000-00000000000b', 'COMPLETE', 'Agency B private note.', 'en', 0.88, now());

select ok((select relrowsecurity from pg_class where oid = 'public.inbox_voice_transcripts'::regclass), 'Voice transcripts have RLS enabled');
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}';
select results_eq($$select count(*) from public.inbox_voice_transcripts$$, array[1::bigint], 'Operations sees transcripts from its own agency only');
select results_eq($$select count(*) from public.inbox_voice_transcripts where agency_id = '20000000-0000-4000-8000-000000000002'$$, array[0::bigint], 'Operations cannot select cross-agency transcripts');
select throws_ok($$insert into public.inbox_voice_transcripts (agency_id, attachment_id, message_id) values ('10000000-0000-4000-8000-000000000001', '10000000-e000-4000-8000-0000000000a2', '10000000-d000-4000-8000-00000000000a')$$, '42501', null, 'Staff cannot insert transcripts directly');
select throws_ok($$update public.inbox_voice_transcripts set language = 'ar'$$, '42501', null, 'Staff cannot update transcripts directly');
select throws_ok($$delete from public.inbox_voice_transcripts$$, '42501', null, 'Staff cannot delete transcripts directly');
set local "request.jwt.claims" = '{"sub":"12000000-0000-4000-8000-000000000001","role":"authenticated"}';
select results_eq($$select count(*) from public.inbox_voice_transcripts$$, array[0::bigint], 'Guide cannot read voice transcripts');
set local "request.jwt.claims" = '{"sub":"21000000-0000-4000-8000-000000000002","role":"authenticated"}';
select results_eq($$select count(*) from public.inbox_voice_transcripts where agency_id = '10000000-0000-4000-8000-000000000001'$$, array[0::bigint], 'Agency B cannot read Agency A transcripts');
reset role;
select throws_ok($$insert into public.inbox_voice_transcripts (agency_id, attachment_id, message_id, non_authoritative) values ('10000000-0000-4000-8000-000000000001', '10000000-e000-4000-8000-0000000000a2', '10000000-d000-4000-8000-00000000000a', false)$$, '23514', null, 'A transcript cannot be marked authoritative');
select throws_ok($$insert into public.inbox_voice_transcripts (agency_id, attachment_id, message_id) values ('10000000-0000-4000-8000-000000000001', '10000000-e000-4000-8000-00000000000a', '10000000-d000-4000-8000-00000000000a')$$, '23505', null, 'A second transcript for the same attachment is refused');
select throws_ok($$insert into public.inbox_voice_transcripts (agency_id, attachment_id, message_id, status) values ('10000000-0000-4000-8000-000000000001', '10000000-e000-4000-8000-0000000000a2', '10000000-d000-4000-8000-00000000000a', 'COMPLETE')$$, '23514', null, 'A completed transcript must have text and confidence');
select throws_ok($$insert into public.inbox_voice_transcripts (agency_id, attachment_id, message_id, transcript_text) values ('10000000-0000-4000-8000-000000000001', '10000000-e000-4000-8000-0000000000a2', '10000000-d000-4000-8000-00000000000a', 'early text')$$, '23514', null, 'A pending transcript cannot carry text');
select throws_ok($$insert into public.inbox_voice_transcripts (agency_id, attachment_id, message_id, status, failure_reason, completed_at) values ('10000000-0000-4000-8000-000000000001', '10000000-e000-4000-8000-0000000000a2', '10000000-d000-4000-8000-00000000000a', 'FAILED', 'free text with customer words', now())$$, '23514', null, 'A failure reason must be a machine code');
select throws_ok($$insert into public.inbox_voice_transcripts (agency_id, attachment_id, message_id) values ('20000000-0000-4000-8000-000000000002', '10000000-e000-4000-8000-0000000000a2', '10000000-d000-4000-8000-00000000000a')$$, '23503', null, 'A transcript cannot reference another agency source');
select lives_ok($$insert into public.inbox_voice_transcripts (agency_id, attachment_id, message_id) values ('10000000-0000-4000-8000-000000000001', '10000000-e000-4000-8000-0000000000a2', '10000000-d000-4000-8000-00000000000a')$$, 'A pending transcript can be created for a valid source');
select lives_ok($$delete from public.message_attachments where id = '10000000-e000-4000-8000-0000000000a2'$$, 'Deleting the source attachment succeeds when no hold applies');
select results_eq($$select count(*) from public.inbox_voice_transcripts where attachment_id = '10000000-e000-4000-8000-0000000000a2'$$, array[0::bigint], 'Retention follows the source: the transcript was deleted with it');
insert into public.inbox_voice_transcripts (agency_id, attachment_id, message_id) values ('10000000-0000-4000-8000-000000000001', '10000000-e000-4000-8000-0000000000a3', '10000000-d000-4000-8000-00000000000a');
select throws_ok($$update public.inbox_voice_transcripts set legal_hold_at = now() where attachment_id = '10000000-e000-4000-8000-0000000000a3'$$, '23514', null, 'A legal hold requires a reason');
update public.inbox_voice_transcripts set legal_hold_at = now(), legal_hold_reason = 'Dispute 42' where attachment_id = '10000000-e000-4000-8000-0000000000a3';
select throws_ok($$delete from public.inbox_voice_transcripts where attachment_id = '10000000-e000-4000-8000-0000000000a3'$$, '23001', null, 'A held transcript cannot be deleted');
select throws_ok($$delete from public.message_attachments where id = '10000000-e000-4000-8000-0000000000a3'$$, '23001', null, 'A held transcript blocks deletion of its source');

select * from finish();
rollback;
