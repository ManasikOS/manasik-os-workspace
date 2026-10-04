import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDir = path.resolve(__dirname, "../../supabase/migrations");
const name = readdirSync(migrationsDir).find((file) => file.includes("onboarding_events"));
const sql = name ? readFileSync(path.join(migrationsDir, name), "utf8") : "";

describe("onboarding_events migration", () => {
  it("exists and is agency-scoped with a closed set of event names", () => {
    expect(name).toBeDefined();
    expect(sql).toMatch(/create table if not exists public\.onboarding_events/i);
    expect(sql).toMatch(/agency_id\s+uuid not null references public\.agencies\(id\) on delete cascade/i);
    for (const event of ["STEP_VIEWED", "STEP_COMPLETED", "STEP_SKIPPED", "CONNECTOR_STARTED", "CONNECTOR_SUCCEEDED", "CONNECTOR_FAILED"]) {
      expect(sql).toContain(event);
    }
  });

  it("enables RLS with no policy and no access for app roles: service role only", () => {
    expect(sql).toMatch(/alter table public\.onboarding_events enable row level security/i);
    expect(sql).toMatch(/revoke all on public\.onboarding_events from public, anon, authenticated/i);
    expect(sql).not.toMatch(/create policy/i);
  });

  it("stores no free text, so no personal data can land in it", () => {
    // Only closed-set text columns (each with a check constraint) and no JSON payload column.
    expect(sql).not.toMatch(/\b(message|detail|details|note|notes|reason|payload|metadata)\s+(text|jsonb?)\b/i);
    expect(sql).not.toMatch(/\bjsonb?\b/i);
  });

  it("indexes the two ways the operator console reads it", () => {
    expect(sql).toMatch(/\(agency_id, created_at/i);
    expect(sql).toMatch(/\(event, created_at/i);
  });
});
