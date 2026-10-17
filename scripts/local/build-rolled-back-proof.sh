#!/usr/bin/env bash
# Builds ONE SQL script that applies a migration and runs its database test inside a single transaction that ends in ROLLBACK, so nothing is kept.
# It only prints SQL; it connects to nothing. Paste the output into the SQL editor, or pass it to the Supabase MCP `execute_sql`, for the environment
# you are about to change, and read the `ok` / `not ok` lines. Every migration should be proven this way before it is applied for real.
#
#   bash scripts/local/build-rolled-back-proof.sh supabase/migrations/<file>.sql supabase/tests/database/<test>.test.sql > proof.sql
#
# The test file's own `begin;` and final `rollback;` are removed (a transaction cannot nest); this script supplies both.
set -eu
migration="${1:?usage: build-rolled-back-proof.sh <migration.sql> <test.sql>}"
test_file="${2:?usage: build-rolled-back-proof.sh <migration.sql> <test.sql>}"
echo "begin;"
echo "-- ===== migration: $(basename "$migration") ====="
cat "$migration"
echo
echo "-- ===== test: $(basename "$test_file") (its begin/rollback removed) ====="
# Drop only the first line that is exactly "begin;" and the last line that is exactly "rollback;".
awk '
  { lines[NR] = $0 }
  END {
    first = 0; last = 0
    for (i = 1; i <= NR; i++) if (lines[i] ~ /^begin;[ \t\r]*$/ && !first) first = i
    for (i = NR; i >= 1; i--) if (lines[i] ~ /^rollback;[ \t\r]*$/ && !last) last = i
    for (i = 1; i <= NR; i++) if (i != first && i != last) print lines[i]
  }' "$test_file"
echo "-- Nothing above is kept:"
echo "rollback;"
