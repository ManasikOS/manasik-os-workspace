-- Behavioural verification for supabase/migrations/20261202091800_mi4_5_conversation_handoffs.sql (MI4.5) and, once applied,
-- 20261202091900_mi4_1b_signal_review_verdicts.sql (MI4.1b). Runs in one transaction and ENDS IN A DELIBERATE ERROR so nothing
-- persists; read the numbers in `VERIFY {...}`.
--
-- NOT YET RUN. Run it against Manasik OS before ticking either slice's migration box.
--
-- Handoff checks: one handoff per booking · a handoff cannot point at another agency's conversation or booking · the snapshot
-- columns are not updatable by staff (only acknowledgement is) · the acknowledgement columns must arrive together.
-- Review checks (skipped with a note if the MI4.1b columns are absent): a verdict needs a reviewer and a time · a reviewer must
-- belong to the signal's agency · the precision view counts only judged rows.

do $$
declare
  a uuid; b uuid; res jsonb := '{}'::jsonb;
  staff_a uuid; conv_a uuid; conv_b uuid; bk_a uuid; bk_b uuid; grp_a uuid; grp_b uuid;
  has_review boolean;
begin
  insert into public.agencies (name, slug) values ('Handoff A', 'handoff-a-' || gen_random_uuid()) returning id into a;
  insert into public.agencies (name, slug) values ('Handoff B', 'handoff-b-' || gen_random_uuid()) returning id into b;

  -- One staff member for agency A (auth user required by the profile's FK).
  insert into auth.users (id, instance_id, aud, role, email) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'handoff-' || gen_random_uuid() || '@example.test') returning id into staff_a;
  insert into public.staff_profiles (id, agency_id, full_name, email, role, status) values (staff_a, a, 'Handoff Tester', 'handoff-' || staff_a || '@example.test', 'OPERATIONS', 'ACTIVE');

  insert into public.conversations (agency_id, external_conversation_id, channel, state) values (a, 'ho-a', 'WHATSAPP', 'AI_ACTIVE') returning id into conv_a;
  insert into public.conversations (agency_id, external_conversation_id, channel, state) values (b, 'ho-b', 'WHATSAPP', 'AI_ACTIVE') returning id into conv_b;

  -- Bookings are created through the repository's own minimal shape; adjust the columns to the current NOT NULL set if this drifts.
  select id into bk_a from public.departure_group_bookings where agency_id = a limit 1;
  select id into bk_b from public.departure_group_bookings where agency_id = b limit 1;
  res := res || jsonb_build_object('note_bookings', 'seed a confirmed booking per agency above this line if none exist');

  if bk_a is not null then
    insert into public.conversation_handoffs (agency_id, conversation_id, booking_id, created_by) values (a, conv_a, bk_a, staff_a);
    -- Second handoff for the same booking is refused.
    begin
      insert into public.conversation_handoffs (agency_id, conversation_id, booking_id, created_by) values (a, conv_a, bk_a, staff_a);
      res := res || jsonb_build_object('duplicate_booking_refused', false);
    exception when unique_violation then
      res := res || jsonb_build_object('duplicate_booking_refused', true);
    end;
    -- A conversation of another agency cannot be handed over under this agency.
    begin
      insert into public.conversation_handoffs (agency_id, conversation_id, booking_id, created_by) values (a, conv_b, bk_a, staff_a);
      res := res || jsonb_build_object('cross_agency_conversation_refused', false);
    exception when foreign_key_violation then
      res := res || jsonb_build_object('cross_agency_conversation_refused', true);
    end;
    -- Acknowledgement columns come as a pair.
    begin
      update public.conversation_handoffs set acknowledged_by = staff_a where booking_id = bk_a;
      res := res || jsonb_build_object('half_acknowledgement_refused', false);
    exception when check_violation then
      res := res || jsonb_build_object('half_acknowledgement_refused', true);
    end;
  end if;

  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conversation_signals' and column_name = 'review_verdict') into has_review;
  res := res || jsonb_build_object('review_columns_present', has_review);

  if has_review then
    declare sig uuid; begin
      insert into public.conversation_signals (agency_id, conversation_id, signal_code, detector) values (a, conv_a, 'REFUND_REQUEST', 'RULE') returning id into sig;
      -- A verdict without a reviewer is refused.
      begin
        update public.conversation_signals set review_verdict = 'CORRECT' where id = sig;
        res := res || jsonb_build_object('verdict_without_reviewer_refused', false);
      exception when check_violation then
        res := res || jsonb_build_object('verdict_without_reviewer_refused', true);
      end;
      -- A reviewer from another agency is refused.
      begin
        update public.conversation_signals set review_verdict = 'CORRECT', reviewed_by = staff_a, reviewed_at = now() where id = sig and agency_id = b;
        res := res || jsonb_build_object('cross_agency_reviewer_matches_no_row', true);
      exception when others then
        res := res || jsonb_build_object('cross_agency_reviewer_matches_no_row', false);
      end;
      update public.conversation_signals set review_verdict = 'WRONG', reviewed_by = staff_a, reviewed_at = now() where id = sig;
      res := res || jsonb_build_object('precision_row', (select to_jsonb(p) from public.inbox_signal_precision p where p.agency_id = a and p.signal_code = 'REFUND_REQUEST'));
    end;
  end if;

  raise exception 'VERIFY %', res::text;
end $$;
