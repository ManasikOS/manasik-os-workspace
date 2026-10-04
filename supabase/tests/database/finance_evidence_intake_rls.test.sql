begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

insert into public.agencies (id, name, slug)
values
  ('10000000-0000-4000-8000-000000000001', 'FIN-01 Agency A', 'fin-01-agency-a'),
  ('20000000-0000-4000-8000-000000000002', 'FIN-01 Agency B', 'fin-01-agency-b');

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('11000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'finance-a@fin01.test', '', now(), '{}', '{}', now(), now()),
  ('12000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'marketing-a@fin01.test', '', now(), '{}', '{}', now(), now()),
  ('13000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ceo-a@fin01.test', '', now(), '{}', '{}', now(), now()),
  ('21000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'finance-b@fin01.test', '', now(), '{}', '{}', now(), now());

insert into public.staff_profiles (id, agency_id, full_name, email, role, status)
values
  ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Finance A', 'finance-a@fin01.test', 'FINANCE', 'ACTIVE'),
  ('12000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Marketing A', 'marketing-a@fin01.test', 'MARKETING', 'ACTIVE'),
  ('13000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'CEO A', 'ceo-a@fin01.test', 'CEO', 'ACTIVE'),
  ('21000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Finance B', 'finance-b@fin01.test', 'FINANCE', 'ACTIVE');

insert into public.finance_evidence_intake (
  id, agency_id, storage_path, original_checksum_sha256,
  original_mime_type, retention_expires_at
)
values
  (
    '10000000-1000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001/receipt-a.jpg',
    repeat('a', 64), 'image/jpeg', now() + interval '90 days'
  ),
  (
    '20000000-2000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002/receipt-b.jpg',
    repeat('b', 64), 'image/jpeg', now() + interval '90 days'
  );

select ok(
  (select relrowsecurity from pg_class where oid = 'public.finance_evidence_intake'::regclass),
  'Finance evidence intake has RLS enabled'
);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}';

select results_eq(
  $$select count(*) from public.finance_evidence_intake$$,
  array[1::bigint],
  'Finance sees evidence from its own agency only'
);
select results_eq(
  $$select count(*) from public.finance_evidence_intake where agency_id = '20000000-0000-4000-8000-000000000002'$$,
  array[0::bigint],
  'Finance cannot select cross-agency evidence'
);
select lives_ok(
  $$insert into public.finance_evidence_intake (agency_id, storage_path, original_checksum_sha256, original_mime_type, retention_expires_at) values ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001/own-insert.jpg', repeat('c', 64), 'image/jpeg', now() + interval '90 days')$$,
  'Finance can insert evidence for its own agency'
);
select throws_ok(
  $$insert into public.finance_evidence_intake (agency_id, storage_path, original_checksum_sha256, original_mime_type, retention_expires_at) values ('20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002/cross-insert.jpg', repeat('d', 64), 'image/jpeg', now() + interval '90 days')$$,
  '42501',
  null,
  'Finance cannot insert cross-agency evidence'
);
select lives_ok(
  $$update public.finance_evidence_intake set review_note = 'own agency review' where id = '10000000-1000-4000-8000-000000000001'$$,
  'Finance can update evidence for its own agency'
);
select results_eq(
  $$update public.finance_evidence_intake set review_note = 'cross agency review' where id = '20000000-2000-4000-8000-000000000002' returning id$$,
  $$select null::uuid where false$$,
  'Finance cannot update cross-agency evidence'
);

set local "request.jwt.claims" = '{"sub":"12000000-0000-4000-8000-000000000001","role":"authenticated"}';

select results_eq(
  $$select count(*) from public.finance_evidence_intake$$,
  array[0::bigint],
  'Marketing cannot select Finance evidence'
);
select throws_ok(
  $$insert into public.finance_evidence_intake (agency_id, storage_path, original_checksum_sha256, original_mime_type, retention_expires_at) values ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001/marketing-insert.jpg', repeat('e', 64), 'image/jpeg', now() + interval '90 days')$$,
  '42501',
  null,
  'Marketing cannot insert Finance evidence'
);
select results_eq(
  $$update public.finance_evidence_intake set review_note = 'marketing review' returning id$$,
  $$select null::uuid where false$$,
  'Marketing cannot update Finance evidence'
);

set local "request.jwt.claims" = '{"sub":"13000000-0000-4000-8000-000000000001","role":"authenticated"}';

select results_eq(
  $$select count(*) from public.finance_evidence_intake$$,
  array[2::bigint],
  'CEO can read evidence from its own agency'
);
select results_eq(
  $$update public.finance_evidence_intake set review_note = 'ceo review' returning id$$,
  $$select null::uuid where false$$,
  'CEO remains read-only'
);

select * from finish();
rollback;
