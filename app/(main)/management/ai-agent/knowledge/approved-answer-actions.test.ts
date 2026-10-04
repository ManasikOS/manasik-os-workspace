import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const requireUser = vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111" }));
vi.mock("@/lib/dal", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/data/departure-groups", () => ({ getCurrentStaffRole: async () => ({ role: "MARKETING", roleId: "role-1", agencyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) }));
const loadDynamicCapabilities = vi.fn(async () => ({ approveInboxAnswer: false }));
vi.mock("@/lib/access/dynamic-capabilities", () => ({ loadDynamicCapabilities: () => loadDynamicCapabilities() }));
vi.mock("@/utils/supabase/server", () => ({ createClient: () => ({ from: vi.fn() }) }));

const { reviewInboxApprovedAnswerAction } = await import("./approved-answer-actions");

describe("approved answer review action", () => {
  it("requires the dynamic approval capability before reading or changing a candidate", async () => {
    const result = await reviewInboxApprovedAnswerAction({
      answerId: "22222222-2222-4222-8222-222222222222",
      decision: "APPROVE",
      reason: "",
    });
    expect(requireUser).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: false, error: "Your role cannot approve repeated Inbox answers." });
  });
});
