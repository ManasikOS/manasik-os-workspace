#!/usr/bin/env bash
# Clean-rebuild proof (TASK-032 S5): applies every migration in supabase/migrations, in filename order and each in its own transaction, to an
# EMPTY local Supabase database running in Docker, and records each in supabase_migrations.schema_migrations the way the Supabase CLI does.
# Stops at the first failure and says which migration it was. Run it against a local database only: it refuses a database that already has
# application tables, so it can never be pointed at staging or production by accident.
#
#   bash scripts/local/rebuild-from-migrations.sh                 # container "supabase-db" (the self-hosted default)
#   DB_CONTAINER=supabase_db_crm bash scripts/local/rebuild-from-migrations.sh   # the Supabase CLI's container name
#
# The database must already exist with the standard Supabase roles, schemas and extensions (a fresh `supabase start` or the self-hosted
# docker compose gives you that). Needs Docker and nothing else.
set -u
cd "$(dirname "$0")/../.." || exit 9

CONTAINER="${DB_CONTAINER:-supabase-db}"
PSQL=(docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

if ! docker exec "$CONTAINER" true >/dev/null 2>&1; then
  echo "Container '$CONTAINER' is not running. Start the local Supabase stack first (or set DB_CONTAINER)." >&2
  exit 2
fi

existing="$("${PSQL[@]}" -Atc "select count(*) from pg_tables where schemaname = 'public'")"
if [ "${existing:-0}" != "0" ]; then
  echo "Refusing to run: the database already has $existing table(s) in the public schema. This script builds an EMPTY database from nothing." >&2
  echo "Reset the local stack first (for the self-hosted stack: its reset.sh; for the CLI: supabase db reset)." >&2
  exit 3
fi

"${PSQL[@]}" -c "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);" || exit 8

applied=0
for file in $(ls supabase/migrations/*.sql | sort); do
  base="$(basename "$file" .sql)"
  version="${base%%_*}"
  name="${base#*_}"
  if output="$( (echo "begin;"; cat "$file"; echo; echo "commit;") | "${PSQL[@]}" 2>&1 )"; then
    "${PSQL[@]}" -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name') on conflict (version) do nothing;" >/dev/null 2>&1
    applied=$((applied + 1))
    echo "ok   $base"
  else
    echo "FAIL $base"
    echo "$output" | grep -E "ERROR|DETAIL|HINT|CONTEXT" | head -6
    echo "Applied before the failure: $applied"
    exit 1
  fi
done

echo "ALL APPLIED: $applied migrations built a database from nothing."
