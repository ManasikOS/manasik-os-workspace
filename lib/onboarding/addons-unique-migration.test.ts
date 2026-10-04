import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDir = path.resolve(__dirname, "../../supabase/migrations");
const name = readdirSync(migrationsDir).find((file) => file.includes("agency_service_addons_per_agency_unique"));
const sql = name ? readFileSync(path.join(migrationsDir, name), "utf8") : "";

describe("agency_service_addons per-agency uniqueness repair", () => {
  it("exists and sorts after the provisioning migrations it unblocks", () => {
    expect(name).toBeDefined();
    expect(name! > "20261208090000").toBe(true);
  });

  it("drops the global rule and adds the per-agency constraint provision_agency names", () => {
    expect(sql).toMatch(/drop constraint if exists agency_service_addons_code_unique/i);
    expect(sql).toMatch(/add constraint agency_service_addons_code_agency_unique unique \(agency_id, code\)/i);
  });

  it("is idempotent", () => {
    expect(sql).toMatch(/if not exists \(\s*select 1 from pg_constraint/i);
  });
});
