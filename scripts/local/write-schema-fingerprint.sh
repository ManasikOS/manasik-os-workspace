#!/usr/bin/env bash
# Regenerates supabase/schema-fingerprint.json from a LOCAL database that was just built from the migrations (see rebuild-from-migrations.sh).
# Talks only to a local Docker container; refuses a container whose database has no public tables (nothing to fingerprint) and never takes a
# connection string, so it cannot be pointed at staging or production.
#
#   bash scripts/local/write-schema-fingerprint.sh                 # container "supabase-db"
#   DB_CONTAINER=supabase_db_crm bash scripts/local/write-schema-fingerprint.sh
#
# Needs the function from 20270109090000_gate_schema_fingerprint.sql applied (the rebuild applies it) and Node.
set -eu
cd "$(dirname "$0")/../.."

CONTAINER="${DB_CONTAINER:-supabase-db}"
if ! docker exec "$CONTAINER" true >/dev/null 2>&1; then
  echo "Container '$CONTAINER' is not running. Start the local Supabase stack first (or set DB_CONTAINER)." >&2
  exit 2
fi

tables="$(docker exec -i "$CONTAINER" psql -U postgres -d postgres -Atc "select count(*) from pg_tables where schemaname = 'public'")"
if [ "${tables:-0}" = "0" ]; then
  echo "The database has no tables in the public schema: build it from the migrations first (scripts/local/rebuild-from-migrations.sh)." >&2
  exit 3
fi

docker exec -i "$CONTAINER" psql -U postgres -d postgres -Atc "select public.gate_schema_fingerprint()" | node scripts/local/write-schema-fingerprint.mjs
