-- Second alignment of supabase_migrations.schema_migrations with the file names in supabase/migrations, so
-- `supabase db push` / `supabase migration list` see staging and the repo as the same and do not try to re-apply anything.
-- The first pass (scripts/sql/align-migration-history.sql) handled 18 rows from the 25-26 Sep rollout; this one handles the
-- nine migrations applied on 2-3 Oct under their apply-time stamps, whose repo files were later renumbered to 20270102...20270110.
--
-- NOT a migration. A person runs it once, in the SQL editor of the STAGING project, after reading it. It changes only the `version`
-- column of 9 history rows; no schema and no data is touched. Checked read-only against the Manasik OS staging project
-- (klognjpwmqwlgeibvanf) on 2026-10-04: exactly these nine rows exist, under exactly these versions and names.
--
-- Do NOT run it against a project that was built by `supabase db push` / `db reset` from these files: there the rows already carry the
-- file versions, nothing matches, and the check at the end aborts the transaction (harmless, but pointless).
--
-- Safety: each row is matched on BOTH its current version and its name, so a row that is not exactly what is expected is left alone.
-- The transaction then checks that all nine were renamed and rolls back (raises) if not.

-- 1. Read-only preview: run this first. Expect nine rows, each with the old version shown below.
select version, name
  from supabase_migrations.schema_migrations
 where name in ('agencies_is_test', 'revoke_server_only_table_privileges', 'harden_package_wrapper_guards', 'gate_snapshot',
                'clean_rebuild_alignment', 'composite_foreign_key_delete_behaviour', 'queue_counts_follow_deletes',
                'gate_schema_fingerprint', 'gate_schema_fingerprint_ignore_comments')
 order by version;

-- 2. The rename. Run from `begin;` to `commit;` in one go.
begin;

with map (old_version, name, new_version) as (
  values
    ('20261002140016', 'agencies_is_test',                          '20270102090000'),
    ('20261002152143', 'revoke_server_only_table_privileges',       '20270103090000'),
    ('20261002152148', 'harden_package_wrapper_guards',             '20270104090000'),
    ('20261002154859', 'gate_snapshot',                             '20270105090000'),
    ('20261003041901', 'clean_rebuild_alignment',                   '20270106090000'),
    ('20261003055053', 'composite_foreign_key_delete_behaviour',    '20270107090000'),
    ('20261003082500', 'queue_counts_follow_deletes',               '20270108090000'),
    ('20261003084329', 'gate_schema_fingerprint',                   '20270109090000'),
    ('20261003084726', 'gate_schema_fingerprint_ignore_comments',   '20270110090000')
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
select count(*) as renamed from renamed;   -- expect 9

do $$
declare n int;
begin
  select count(*) into n from supabase_migrations.schema_migrations
   where version in ('20270102090000','20270103090000','20270104090000','20270105090000','20270106090000',
                     '20270107090000','20270108090000','20270109090000','20270110090000');
  if n <> 9 then raise exception 'expected 9 aligned history rows, found % - rolling back', n; end if;
end $$;

commit;

-- Afterwards, from the repo, linked to staging:  supabase migration list
-- Every local file should show a matching remote version, with nothing left pending.
--
-- To undo (only if needed), swap old_version and new_version in the map above and run it again.
