import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(__dirname, "../../../supabase/migrations/20261202093200_fix6_commercial_projection_freshness.sql"),
  "utf8",
);

describe("FIX6 commercial projection freshness", () => {
  it("recomputes only the affected agency projection and refreshes queues from its stage write", () => {
    expect(migration).toMatch(/create or replace function public\.recompute_conversation_commercial_projection/);
    expect(migration).toMatch(/where c\.id = p_conversation_id/);
    expect(migration).toMatch(/ci\.agency_id = v_agency_id/);
    expect(migration).toMatch(/after insert or update of intent_code, urgency, commercial_stage on public\.conversation_intelligence/);
  });

  it("covers quote, booking, lead and payment changes without opening its function to clients", () => {
    for (const trigger of ["leads_recompute_commercial_projection", "lead_quotes_recompute_commercial_projection", "bookings_recompute_commercial_projection", "payments_recompute_commercial_projection"]) {
      expect(migration).toMatch(new RegExp(`create trigger ${trigger}`));
    }
    expect(migration).toMatch(/revoke all on function public\.recompute_conversation_commercial_projection\(uuid\) from public, anon, authenticated/);
    expect(migration).toMatch(/grant execute on function public\.recompute_conversation_commercial_projection\(uuid\) to service_role/);
  });
});
