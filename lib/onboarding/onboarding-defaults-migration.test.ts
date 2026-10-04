import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationsDir = path.resolve(__dirname, "../../supabase/migrations");
const name = readdirSync(migrationsDir).find((file) => file.includes("onboarding_defaults"));
const sql = name ? readFileSync(path.join(migrationsDir, name), "utf8") : "";

describe("onboarding M4 — locale-aware seeding and trial subscription", () => {
  it("exists", () => {
    expect(name).toBeDefined();
  });

  it("adds a country lookup with RLS in the same migration, seeded for the UK", () => {
    expect(sql).toMatch(/create table if not exists public\.country_locale_defaults/i);
    expect(sql).toMatch(/alter table public\.country_locale_defaults enable row level security/i);
    expect(sql).toMatch(/\('GB',\s*'GBP',\s*'Europe\/London'/);
  });

  it("gives provision_agency optional country, currency and timezone without ambiguous overloads", () => {
    expect(sql).toMatch(/drop function if exists public\.provision_agency\(text, text, uuid, text, text\)/i);
    expect(sql).toMatch(/p_country text default null/i);
    expect(sql).toMatch(/p_currency text default null/i);
    expect(sql).toMatch(/p_timezone text default null/i);
  });

  it("writes locale to agency_settings and stamps add-ons with the agency currency", () => {
    expect(sql).toMatch(/insert into public\.agency_settings[\s\S]*default_currency[\s\S]*timezone/i);
    expect(sql).toMatch(/insert into public\.agency_service_addons[\s\S]*currency/i);
  });

  it("only seeds the legacy LKR prices for LKR agencies; everyone else starts unpriced", () => {
    expect(sql).toMatch(/v_currency = 'LKR'/);
    expect(sql).toMatch(/null::numeric/i);
  });

  it("keeps provision_agency service-role only", () => {
    expect(sql).toMatch(/revoke all on function public\.provision_agency\(text, text, uuid, text, text, text, text, text\) from public, anon, authenticated/i);
  });

  it("creates a 14-day STARTER trial subscription inside provision_agency_from_signup", () => {
    expect(sql).toMatch(/create or replace function public\.provision_agency_from_signup/i);
    expect(sql).toMatch(/insert into public\.agency_subscriptions[\s\S]*'STARTER'[\s\S]*'TRIAL'/i);
    expect(sql).toMatch(/interval '14 days'/i);
    expect(sql).toMatch(/on conflict \(agency_id\) do nothing/i);
  });

  it("still guards the signup RPC to the service role and keeps its idempotency codes", () => {
    expect(sql).toMatch(/grant execute on function public\.provision_agency_from_signup\(uuid, uuid, text\) to service_role/i);
    expect(sql).toMatch(/pending_signup_expired/);
    expect(sql).toMatch(/for update/i);
  });
});
