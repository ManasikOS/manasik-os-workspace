import { describe, expect, it } from "vitest";

import { replyOwnershipNoticeFor } from "./reply-ownership-notice";

const base = { assignedToId: "s1", assignedToName: "Nadeesha", currentStaffId: "s2" } as const;

describe("replyOwnershipNoticeFor", () => {
  it("says nothing when the person owns the chat or nobody does", () => {
    expect(replyOwnershipNoticeFor({ ...base, state: "HUMAN_ACTIVE", currentStaffId: "s1" })).toBeNull();
    expect(replyOwnershipNoticeFor({ ...base, state: "AI_ACTIVE", assignedToId: null, assignedToName: null })).toBeNull();
  });

  it("warns that sending takes ownership when the chat is not staff-handled yet", () => {
    for (const state of ["AI_ACTIVE", "AI_RESUMED", "HUMAN_REQUESTED"] as const) {
      expect(replyOwnershipNoticeFor({ ...base, state })).toMatchObject({ kind: "TAKES_OVER", message: expect.stringContaining("Nadeesha") });
    }
  });

  it("asks staff to coordinate when a colleague already owns a staff-handled chat", () => {
    expect(replyOwnershipNoticeFor({ ...base, state: "HUMAN_ACTIVE" })).toMatchObject({ kind: "COORDINATE" });
  });

  it("says nothing on a closed chat", () => {
    expect(replyOwnershipNoticeFor({ ...base, state: "CLOSED" })).toBeNull();
  });

  it("does not invent a name", () => {
    expect(replyOwnershipNoticeFor({ ...base, state: "HUMAN_ACTIVE", assignedToName: "  " })?.message).toContain("A colleague");
  });
});
