import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The committed schema baseline (supabase/schema-fingerprint.json) is what the go-live gate's G15 judges every environment against. It must describe the
 * migrations that are in the repository: a migration added without regenerating it fails here, so the gate can never be judging against a stale picture.
 * Regenerate with `bash scripts/local/write-schema-fingerprint.sh` against a local database built from the migrations.
 */
const root = process.cwd();
const migrations = readdirSync(join(root, "supabase", "migrations")).filter((file) => file.endsWith(".sql")).sort();
const baseline = JSON.parse(readFileSync(join(root, "supabase", "schema-fingerprint.json"), "utf8")) as { lastMigration: string; migrationCount: number; objects: Record<string, string> };

describe("supabase/schema-fingerprint.json", () => {
  it("describes the current migrations: same count, same last one", () => {
    expect(baseline.migrationCount).toBe(migrations.length);
    expect(baseline.lastMigration).toBe(migrations[migrations.length - 1].replace(/\.sql$/, ""));
  });

  it("carries a short hash for each object and nothing else (no definition, no value)", () => {
    for (const [key, hash] of Object.entries(baseline.objects)) {
      expect(key).toMatch(/^(table|constraint|index|trigger|policy|grant|function|view):/);
      expect(hash).toMatch(/^[0-9a-f]{10}$/);
    }
  });

  it("includes the objects the isolation and security work depends on", () => {
    for (const key of ["table:conversations", "policy:conversations", "constraint:conversations", "trigger:packages", "function:packages_enforce_marketing_column_scope()", "function:gate_schema_fingerprint()", "grant:conversations"]) {
      expect(baseline.objects, key).toHaveProperty([key]);
    }
  });
});
