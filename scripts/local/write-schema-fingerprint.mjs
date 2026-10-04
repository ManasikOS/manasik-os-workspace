import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Writes supabase/schema-fingerprint.json: the fingerprint of a database BUILT FROM THE REPOSITORY, which the go-live gate (G15) compares every
 * environment with. Reads the output of `select public.gate_schema_fingerprint()` on stdin. Run it through scripts/local/write-schema-fingerprint.sh,
 * which rebuilds nothing: point it at a local database that was just built from the migrations (scripts/local/rebuild-from-migrations.sh), never at
 * a shared environment, or the baseline would record that environment's drift instead of the repository's intent.
 *
 * One object per line so a change shows up in review as exactly the objects that changed.
 */
const stdin = readFileSync(0, "utf8").trim();
const fingerprint = JSON.parse(stdin);
if (!fingerprint.objects || Object.keys(fingerprint.objects).length === 0) throw new Error("The fingerprint is empty; was the function applied?");

const migrations = readdirSync(join(process.cwd(), "supabase", "migrations")).filter((file) => file.endsWith(".sql")).sort();
const lastMigration = migrations[migrations.length - 1].replace(/\.sql$/, "");

const keys = Object.keys(fingerprint.objects).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const lines = [
  "{",
  `  "description": "Fingerprint of the public schema of a database built from supabase/migrations (go-live gate G15). Regenerate with scripts/local/write-schema-fingerprint.sh after adding a migration.",`,
  `  "lastMigration": ${JSON.stringify(lastMigration)},`,
  `  "migrationCount": ${migrations.length},`,
  `  "objects": {`,
  ...keys.map((key, index) => `    ${JSON.stringify(key)}: ${JSON.stringify(fingerprint.objects[key])}${index < keys.length - 1 ? "," : ""}`),
  "  }",
  "}",
  "",
];
writeFileSync(join(process.cwd(), "supabase", "schema-fingerprint.json"), lines.join("\n"), "utf8");
console.error(`Wrote supabase/schema-fingerprint.json: ${keys.length} objects, last migration ${lastMigration}.`);
