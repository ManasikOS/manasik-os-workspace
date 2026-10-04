import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { loadSlaSettings, saveSlaPolicy } = await import("./inbox-sla-repository");
const { DEFAULT_SLA_POLICIES } = await import("@/lib/inbox/sla/policies");

const AGENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STAFF = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type Result = { data: unknown; error: { message: string } | null };

function fakeDb(tables: Record<string, Result>, upserts: unknown[] = []) {
  return {
    from: (table: string) => {
      const result = tables[table] ?? { data: null, error: null };
      const api: Record<string, unknown> = {
        select: () => api,
        eq: () => api,
        maybeSingle: async () => ({ data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error }),
        upsert: async (row: unknown, options: unknown) => {
          upserts.push({ row, options });
          return { error: result.error };
        },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      return api;
    },
  } as never;
}

describe("loadSlaSettings", () => {
  it("falls back to the code defaults, the default timezone and no calendar for an agency with nothing saved", async () => {
    const settings = await loadSlaSettings(fakeDb({ inbox_sla_policies: { data: [], error: null }, agency_settings: { data: null, error: null }, ai_settings: { data: { working_hours: {} }, error: null } }), AGENCY);
    expect(settings.policies.size).toBe(DEFAULT_SLA_POLICIES.length);
    expect(settings).toMatchObject({ calendar: null, hasCalendar: false, timezone: "Asia/Colombo" });
  });

  it("overlays a stored policy, reads the saved calendar and timezone", async () => {
    const settings = await loadSlaSettings(
      fakeDb({
        inbox_sla_policies: { data: [{ queue_code: "COMPLAINTS", first_reply_minutes: 5, resolution_minutes: 600, clock: "ALWAYS", opens_intervention_on_breach: true }], error: null },
        agency_settings: { data: { timezone: "Asia/Dubai" }, error: null },
        ai_settings: { data: { working_hours: { weekly: { mon: ["09:00-17:00"] } } }, error: null },
      }),
      AGENCY,
    );
    expect(settings.policies.get("COMPLAINTS")).toMatchObject({ firstReplyMinutes: 5, resolutionMinutes: 600 });
    expect(settings).toMatchObject({ hasCalendar: true, timezone: "Asia/Dubai" });
  });

  it("does not trust a timezone that is not a real one", async () => {
    const settings = await loadSlaSettings(fakeDb({ inbox_sla_policies: { data: [], error: null }, agency_settings: { data: { timezone: "Mars/Olympus" }, error: null }, ai_settings: { data: null, error: null } }), AGENCY);
    expect(settings.timezone).toBe("Asia/Colombo");
  });

  it("fails loudly when a read fails, instead of sweeping with guessed targets", async () => {
    for (const failing of ["inbox_sla_policies", "agency_settings", "ai_settings"]) {
      const tables: Record<string, Result> = { inbox_sla_policies: { data: [], error: null }, agency_settings: { data: null, error: null }, ai_settings: { data: null, error: null } };
      tables[failing] = { data: null, error: { message: `${failing} down` } };
      await expect(loadSlaSettings(fakeDb(tables), AGENCY), failing).rejects.toThrow("down");
    }
  });
});

describe("saveSlaPolicy", () => {
  const good = { queueCode: "COMPLAINTS" as const, firstReplyMinutes: 10, resolutionMinutes: 720, clock: "ALWAYS" as const, opensInterventionOnBreach: true };

  it("upserts one row for the agency, stamped with who changed it", async () => {
    const upserts: unknown[] = [];
    await saveSlaPolicy(fakeDb({ inbox_sla_policies: { data: null, error: null } }, upserts), AGENCY, STAFF, good);
    expect(upserts).toEqual([
      {
        row: { agency_id: AGENCY, queue_code: "COMPLAINTS", first_reply_minutes: 10, resolution_minutes: 720, clock: "ALWAYS", opens_intervention_on_breach: true, updated_by: STAFF },
        options: { onConflict: "agency_id,queue_code" },
      },
    ]);
  });

  it("refuses an invalid policy before touching the database", async () => {
    const upserts: unknown[] = [];
    const db = fakeDb({ inbox_sla_policies: { data: null, error: null } }, upserts);
    await expect(saveSlaPolicy(db, AGENCY, STAFF, { ...good, firstReplyMinutes: 0 })).rejects.toThrow();
    await expect(saveSlaPolicy(db, AGENCY, STAFF, { ...good, queueCode: "WAITING_CUSTOMER" as never })).rejects.toThrow();
    expect(upserts).toEqual([]);
  });

  it("surfaces a database refusal (for example, a person without permission)", async () => {
    await expect(saveSlaPolicy(fakeDb({ inbox_sla_policies: { data: null, error: { message: "row-level security" } } }), AGENCY, STAFF, good)).rejects.toThrow("row-level security");
  });
});
