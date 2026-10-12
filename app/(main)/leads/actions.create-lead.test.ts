import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TASK-045 slice 1: the server is the gate for duplicate leads. The Add Lead
 * form warns, but a direct call to the action must not be able to skip the
 * answer. These tests cover that gate and the narrow duplicate check; the
 * lead-building rules themselves are in `lib/data/leads`.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let role = "ADMIN";
vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: "user-1" }) }));
vi.mock("@/lib/data/departure-groups", () => ({
  getCurrentStaffRole: async () => ({ role, name: "Amina", staffId: "staff-1" }),
  createGroupBooking: vi.fn(),
}));
vi.mock("@/utils/supabase/server", () => ({ createClient: () => ({}) }));
// The reference comes from the database counter (`allocate_references`); there is no database here.
let nextReference = 1;
vi.mock("@/lib/data/lead-references", () => ({
  allocateReferences: async (_db: unknown, _kind: string, count: number) =>
    Array.from({ length: count }, () => `LD-2030-${String(nextReference++).padStart(4, "0")}`),
}));

const EXISTING = {
  id: "lead-existing",
  reference: "LD-2026-0001",
  name: "Fathima Rizwan",
  mobile: "771234567",
  email: null,
  stage: "CONTACTED",
  assignedToName: "Amina",
  interestedIn: "Umrah",
} as const;

let duplicate: { lead: typeof EXISTING; matchedOn: "mobile" | "email" } | null = null;
const duplicateLookups: Array<{ mobile: string; email: string }> = [];
const persisted: unknown[] = [];

vi.mock("@/lib/data/leads-repository", () => ({
  findDuplicateLeadSummary: async (_db: unknown, mobile: string, email: string) => {
    duplicateLookups.push({ mobile, email });
    return duplicate;
  },
  loadLeadStore: async () => ({
    leads: [],
    activity: [],
    notes: [],
    quotes: [],
    copilotContexts: [],
    copilotDismissals: [],
    communicationDrafts: [],
    packages: [],
    sources: [],
  }),
  loadAssignableStaff: async () => [{ id: "staff-1", name: "Amina", initials: "A" }],
  snapshotLeadStore: (store: unknown) => structuredClone(store),
  persistLeadStore: async (_db: unknown, _before: unknown, store: unknown) => {
    persisted.push(store);
  },
}));

import { checkLeadDuplicateAction, createLeadAction } from "./actions";

const validLead = {
  fullName: "Fathima Rizwan",
  mobile: "077 123 4567",
  email: "",
  city: "Colombo",
  preferredLanguage: "English",
  preferredChannel: "WHATSAPP",
  journeyType: "UMRAH",
  interestedIn: "Umrah",
  packageId: null,
  preferredPeriod: "Ramadan",
  adults: 2,
  children: 0,
  roomPreference: "UNDECIDED",
  departureCity: "Colombo",
  budgetRange: "Not discussed",
  quotaWaitlistInterest: false,
  source: "WHATSAPP",
  campaignReference: "",
  referralName: "",
  assignedToId: "staff-1",
  stage: "NEW_LEAD",
  temperature: "WARM",
  nextFollowUpAt: "2030-01-01T09:00:00.000Z",
  followUpType: "CALL",
  followUpOwnerId: "staff-1",
  notes: "",
  duplicateReason: "",
  createAnyway: false,
};

beforeEach(() => {
  role = "ADMIN";
  duplicate = null;
  duplicateLookups.length = 0;
  persisted.length = 0;
});

describe("createLeadAction duplicate gate", () => {
  it("creates a lead that matches nobody, and returns its id and reference", async () => {
    const result = await createLeadAction(validLead);
    expect(result).toMatchObject({ ok: true });
    expect(result.leadId).toBeTruthy();
    expect(result.reference).toBeTruthy();
    expect(persisted).toHaveLength(1);
  });

  it("looks the person up by the normalised nine-digit mobile", async () => {
    await createLeadAction(validLead);
    expect(duplicateLookups).toEqual([{ mobile: "771234567", email: "" }]);
  });

  it("refuses a match with no reason, and saves nothing", async () => {
    duplicate = { lead: EXISTING, matchedOn: "mobile" };
    const result = await createLeadAction(validLead);
    expect(result).toMatchObject({ ok: false, fieldErrors: { duplicateReason: expect.any(String) } });
    expect(persisted).toHaveLength(0);
  });

  it("refuses a reason that was never confirmed", async () => {
    duplicate = { lead: EXISTING, matchedOn: "mobile" };
    const result = await createLeadAction({ ...validLead, duplicateReason: "family-member", createAnyway: false });
    expect(result).toMatchObject({ ok: false });
    expect(persisted).toHaveLength(0);
  });

  it("creates the separate lead once a reason is given and confirmed", async () => {
    duplicate = { lead: EXISTING, matchedOn: "mobile" };
    const result = await createLeadAction({ ...validLead, duplicateReason: "family-member", createAnyway: true });
    expect(result).toMatchObject({ ok: true });
    expect(persisted).toHaveLength(1);
  });

  it("refuses a role that cannot create leads before looking anything up", async () => {
    role = "OPERATIONS";
    expect(await createLeadAction(validLead)).toEqual({ ok: false, error: "Your role cannot create leads." });
    expect(duplicateLookups).toHaveLength(0);
  });

  it("requires a next follow-up", async () => {
    const result = await createLeadAction({ ...validLead, nextFollowUpAt: null });
    expect(result).toMatchObject({ ok: false, fieldErrors: { nextFollowUpAt: expect.any(String) } });
  });
});

describe("checkLeadDuplicateAction", () => {
  it("returns the match for a role that can create leads", async () => {
    duplicate = { lead: EXISTING, matchedOn: "mobile" };
    expect(await checkLeadDuplicateAction({ mobile: "+94 77 123 4567", email: "" })).toEqual({
      ok: true,
      duplicate,
    });
    expect(duplicateLookups).toEqual([{ mobile: "771234567", email: "" }]);
  });

  it("returns no match when nobody uses the number", async () => {
    expect(await checkLeadDuplicateAction({ mobile: "0771234567", email: "" })).toEqual({
      ok: true,
      duplicate: null,
    });
  });

  it("does not reveal another lead's details to a role that cannot create leads", async () => {
    role = "OPERATIONS";
    duplicate = { lead: EXISTING, matchedOn: "mobile" };
    expect(await checkLeadDuplicateAction({ mobile: "0771234567", email: "" })).toEqual({
      ok: false,
      error: "Your role cannot create leads.",
    });
    expect(duplicateLookups).toHaveLength(0);
  });

  it("rejects malformed input without a lookup", async () => {
    expect(await checkLeadDuplicateAction({ mobile: 12345 })).toMatchObject({ ok: false });
    expect(duplicateLookups).toHaveLength(0);
  });
});
