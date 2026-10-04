# TASK-035 Align staging migration history

## What
A one-time SQL script, `scripts/sql/align-migration-history-2.sql`, that renames nine rows in the staging project's
`supabase_migrations.schema_migrations` so they carry the same versions as the files in `supabase/migrations`.

## Why
Staging recorded the 2-3 Oct migrations under the timestamp of the moment they were applied (`20261002140016` ... `20261003084726`).
The repo files for the same migrations were later renumbered to `20270102090000` ... `20270110090000`. Until the labels agree,
`supabase db push` against staging would treat those nine as unapplied and try to run them again. The first pass,
`scripts/sql/align-migration-history.sql`, fixed 18 earlier rows the same way. This is the release path's first step: local, then
staging, then production (see `docs/runbooks/production-gate.md`).

## Data model changes
None. Only the `version` column of nine history rows changes. No schema and no data is touched. The production project
(`bidmihfsljrurlnraqmf`) is empty and needs no alignment: a plain `db push` applies every file under its file version.

## Access control changes
None.

## UI surfaces
None.

## Test plan
No automated test: the script is run by a person, once, against one project.

Manual verification:
1. Run the preview `select` at the top of the script in the staging SQL editor. Expect exactly nine rows with the old versions.
2. Run the rename block. Expect `renamed = 9` and no error. The block rolls back on its own if the count is not nine.
3. From the repo, linked to staging, run `supabase migration list`. Every local file shows a matching remote version.
4. Run `supabase db push --dry-run`. Expect nothing to apply except migrations that are genuinely new.

## Status
Draft: the script is written and has not been run. Update to Done once step 3 above has been observed on staging.
