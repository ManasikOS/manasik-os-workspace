import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/embeddings", () => ({ embedTexts: vi.fn(), toPgVector: vi.fn() }));

const { rejectApprovedInboxAnswer } = await import("./repository");

describe("approved answer review repository", () => {
  const rpc = vi.fn();
  beforeEach(() => rpc.mockReset().mockResolvedValue({ data: [{ rejection_count: 2, status: "RETIRED" }], error: null }));

  it("uses the atomic, tenant-scoped rejection RPC used for heavy edits", async () => {
    await rejectApprovedInboxAnswer({ rpc } as never, {
      agencyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      answerId: "11111111-1111-4111-8111-111111111111",
      reason: "Substantial staff correction",
    });
    expect(rpc).toHaveBeenCalledWith("reject_conversation_answer_cache_hit", {
      p_agency_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      p_id: "11111111-1111-4111-8111-111111111111",
      p_reason: "Substantial staff correction",
    });
  });

  it("does not hide a database refusal", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "agency mismatch" } });
    await expect(rejectApprovedInboxAnswer({ rpc } as never, {
      agencyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      answerId: "11111111-1111-4111-8111-111111111111",
      reason: "Correction",
    })).rejects.toThrow(/agency mismatch/);
  });
});
