import { readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase/migrations");
const sqlMigrations = readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql"));

describe("supabase/migrations", () => {
  it("gives every SQL migration its own version, because the CLI and schema_migrations key on the version alone", () => {
    const byVersion = new Map<string, string[]>();
    for (const name of sqlMigrations) {
      const version = name.split("_")[0];
      byVersion.set(version, [...(byVersion.get(version) ?? []), name]);
    }
    const duplicates = [...byVersion.entries()].filter(([, names]) => names.length > 1);
    expect(duplicates, "two migrations share a version; rename the one that is not yet applied to a later, unused version").toEqual([]);
  });

  it("names every file with a 14-digit version, an underscore and a description", () => {
    const malformed = sqlMigrations.filter((name) => !/^\d{14}_[a-z0-9_]+\.sql$/i.test(name) && !/^\d{14}_[a-z0-9_-]+\.sql$/i.test(name));
    expect(malformed).toEqual([]);
  });
});
