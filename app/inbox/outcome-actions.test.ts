import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * OUT-02: the outcome action takes the agency and role from the signed-in session only, refuses roles that cannot open the
 * Inbox, and never returns a card the role may not see.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));

const session = vi.hoisted(() => ({ role: "ADMIN" as string, agencyId: "agency-a" as string | null }));
const loader = vi.hoisted(() => vi.fn());

vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: "user-1" }) }));
vi.mock("@/lib/data/departure-groups", () => ({ getCurrentStaffRole: async () => ({ role: session.role, agencyId: session.agencyId }) }));
vi.mock("@/utils/supabase/admin", () => ({ createAdminClient: () => ({ marker: "admin-db" }) }));
vi.mock("@/lib/data/inbox-commercial-repository", () => ({ loadInboxOutcomeCardsForRole: loader }));

import { loadInboxOutcomeCardsAction } from "./outcome-actions";

describe("loadInboxOutcomeCardsAction", () => {
  beforeEach(() => {
    session.role = "ADMIN";
    session.agencyId = "agency-a";
    loader.mockReset();
    loader.mockResolvedValue({ cards: [{ key: "OVERDUE_CONVERSATIONS" }], failures: ["inbox_intelligence_kpis_daily"] });
  });

  it("loads the cards for the session's own agency and role, not anything the caller supplies", async () => {
    const result = await loadInboxOutcomeCardsAction();
    expect(loader).toHaveBeenCalledWith({ marker: "admin-db" }, "agency-a", "ADMIN", expect.objectContaining({ now: expect.any(Date) }));
    expect(result).toMatchObject({ ok: true, unreadableSources: 1, cards: [{ key: "OVERDUE_CONVERSATIONS" }] });
  });

  it("refuses an account that is not linked to an agency, before reading anything", async () => {
    session.agencyId = null;
    expect(await loadInboxOutcomeCardsAction()).toEqual({ ok: false, error: "Your account is not linked to an agency." });
    expect(loader).not.toHaveBeenCalled();
  });

  it("refuses a role that cannot open the Inbox, before reading anything", async () => {
    session.role = "GUIDE";
    expect(await loadInboxOutcomeCardsAction()).toEqual({ ok: false, error: "Not permitted." });
    expect(loader).not.toHaveBeenCalled();
  });

  it("returns a plain-language error when the read fails, without leaking the cause", async () => {
    loader.mockRejectedValue(new Error("relation secret_table does not exist"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await loadInboxOutcomeCardsAction();
    expect(result).toEqual({ ok: false, error: "The outcomes could not be loaded. Try again." });
  });
});
