import { beforeEach, describe, expect, it, vi } from "vitest";

const role = { value: "OPERATIONS", agencyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", staffId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" };
const recordSignalVerdict = vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined);

vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/dal", () => ({ requireUser: async () => ({ id: role.staffId }) }));
vi.mock("@/utils/supabase/server", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/data/departure-groups", () => ({ getCurrentStaffRole: async () => ({ role: role.value, agencyId: role.agencyId, staffId: role.staffId }) }));
vi.mock("@/lib/data/inbox-signal-review-repository", () => ({ recordSignalVerdict: (...args: unknown[]) => recordSignalVerdict(...args) }));

const { reviewInboxSignalAction } = await import("./signal-review-actions");
const SIGNAL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

beforeEach(() => {
  recordSignalVerdict.mockClear();
  role.value = "OPERATIONS";
});

describe("reviewInboxSignalAction", () => {
  it("records the verdict for the signed-in reviewer and agency, ignoring anything else in the request", async () => {
    await expect(reviewInboxSignalAction({ signalId: SIGNAL, verdict: "CORRECT", agencyId: "someone-else", reviewerId: "forged" })).resolves.toEqual({ ok: true });
    expect(recordSignalVerdict).toHaveBeenCalledWith(expect.anything(), { agencyId: role.agencyId, signalId: SIGNAL, verdict: "CORRECT", reviewerId: role.staffId });
  });

  it("refuses roles that cannot judge signals, before writing anything", async () => {
    for (const other of ["VISA", "GUIDE", "CEO"]) {
      role.value = other;
      await expect(reviewInboxSignalAction({ signalId: SIGNAL, verdict: "WRONG" })).resolves.toMatchObject({ ok: false });
    }
    expect(recordSignalVerdict).not.toHaveBeenCalled();
  });

  it("rejects malformed input", async () => {
    await expect(reviewInboxSignalAction({ signalId: "nope", verdict: "CORRECT" })).resolves.toMatchObject({ ok: false });
    await expect(reviewInboxSignalAction({ signalId: SIGNAL, verdict: "MAYBE" })).resolves.toMatchObject({ ok: false });
    expect(recordSignalVerdict).not.toHaveBeenCalled();
  });

  it("tells the reviewer when the signal was already judged", async () => {
    recordSignalVerdict.mockRejectedValueOnce(new Error("That signal was already judged, or no longer exists."));
    await expect(reviewInboxSignalAction({ signalId: SIGNAL, verdict: "CORRECT" })).resolves.toEqual({ ok: false, error: "That signal was already judged, or no longer exists." });
  });
});
