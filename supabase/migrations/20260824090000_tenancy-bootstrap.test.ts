import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const tenancyMigration = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260824090000_tenancy.sql"),
  "utf8",
);
const departureOperationsMigration = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260919090000_departure_operations_agent.sql"),
  "utf8",
);

describe("20260824090000 tenancy bootstrap", () => {
  it("adds staff_profiles.agency_id before parsing current_agency_id", () => {
    expect(tenancyMigration.indexOf("alter table public.staff_profiles add column if not exists agency_id uuid;")).toBeGreaterThan(-1);
    expect(tenancyMigration.indexOf("alter table public.staff_profiles add column if not exists agency_id uuid;")).toBeLessThan(
      tenancyMigration.indexOf("create or replace function public.current_agency_id()"),
    );
  });

  it("upgrades pre-existing ai_settings before documenting departure operations columns", () => {
    expect(departureOperationsMigration.indexOf("alter table public.ai_settings add column if not exists departure_ops_mode")).toBeGreaterThan(-1);
    expect(departureOperationsMigration.indexOf("alter table public.ai_settings add column if not exists departure_ops_mode")).toBeLessThan(
      departureOperationsMigration.indexOf("comment on column public.ai_settings.departure_ops_mode"),
    );
  });
});
