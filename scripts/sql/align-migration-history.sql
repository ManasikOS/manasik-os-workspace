-- Aligns supabase_migrations.schema_migrations with the file names in supabase/migrations, so `supabase db push` /
-- `supabase migration list` see local and remote as the same and do not try to re-apply anything.
--
-- NOT a migration. A person runs it once, in the SQL editor, after reading it. It changes only the `version` column of 18 history rows;
-- no schema and no data is touched. Checked against Manasik OS on 2026-09-26.
--
-- Safety: each row is matched on BOTH its current version and its name, so a row that is not exactly what is expected is left alone.
-- The transaction then checks that all 18 were renamed and rolls back (raises) if not.
--
-- Group A: seven migrations applied earlier under their apply-time stamps, while the repo files were later renumbered.
-- Group B: the ten migrations applied on 2026-09-25 by the rollout (Q1 ... I4), stamped with the moment they were applied.
-- Group C: one migration applied afterwards (E1).

begin;

with map (old_version, name, new_version) as (
  values
    -- Group A
    ('20260925041420', 'sc1_atomic_inbound_persistence',            '20261202094000'),
    ('20260925041517', 'sc2_typed_inbox_realtime_events',          '20261202094100'),
    ('20260925041831', 'sc2_message_sequence_assignment',          '20261202094150'),
    ('20260925041841', 'sc3_conversation_version',                 '20261202094200'),
    ('20260925041944', 'sc5_scoped_inbox_broadcasts',              '20261202094300'),
    ('20260925041957', 'detach_source_messages_on_conversation_delete', '20261202094400'),
    ('20260925042011', 'inbox_saved_views',                        '20261203090000'),
    -- Group B
    ('20260925182319', 'q1_reply_queue',                           '20261204090000'),
    ('20260925182411', 'q2_queue_claim',                           '20261204090100'),
    ('20260925182450', 'q4_delivery_status_batching',              '20261204090200'),
    ('20260925182531', 'i1_inngest_outbox',                        '20261204090300'),
    ('20260925182604', 'i2_raw_event_reconcile',                   '20261204090400'),
    ('20260925182642', 'd1_retention_raw_events_and_jobs',         '20261204090500'),
    ('20260925182725', 'd2_trigram_search_indexes',                '20261204090600'),
    ('20260925182800', 'd3_single_queue_recompute',                '20261204090700'),
    ('20260925182848', 'f1_staff_media_message',                   '20261204090800'),
    ('20260925182931', 'i4_reply_window_reminder',                 '20261204090900'),
    -- Group C: applied on 2026-09-26 (E1: outbox purge and orphan-upload finder)
    ('20260926020350', 'e1_outbox_purge_and_orphan_uploads',       '20261204091000')
),
renamed as (
  update supabase_migrations.schema_migrations s
     set version = m.new_version
    from map m
   where s.version = m.old_version and s.name = m.name
     -- never collide with a row that already holds the target version
     and not exists (select 1 from supabase_migrations.schema_migrations t where t.version = m.new_version)
  returning 1
)
select count(*) as renamed from renamed;   -- expect 18

do $$
declare n int;
begin
  select count(*) into n from supabase_migrations.schema_migrations
   where version in ('20261202094000','20261202094100','20261202094150','20261202094200','20261202094300','20261202094400','20261203090000',
                     '20261204090000','20261204090100','20261204090200','20261204090300','20261204090400','20261204090500',
                     '20261204090600','20261204090700','20261204090800','20261204090900','20261204091000');
  if n <> 18 then raise exception 'expected 18 aligned history rows, found % - rolling back', n; end if;
end $$;

commit;

-- Afterwards, from the repo:  supabase migration list   (every local file should show a matching remote version)
--
-- To undo (only if needed), swap old_version and new_version in the map above and run it again.
