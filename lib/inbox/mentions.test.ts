import { describe, expect, it, vi } from "vitest";

import { checkMentionedStaff, INBOX_VIEWER_ROLES, MENTION_NO_INBOX_MESSAGE, MENTION_UNAVAILABLE_MESSAGE, roleCanOpenInbox, type MentionCandidate } from "./mentions";

/** SEC-11 (docs/progress/2026-10-05-inbox-security-and-bug-audit.md): only colleagues who can open the Inbox may be mentioned in a note. */

const person = (id: string, role: string, extra: Partial<MentionCandidate> = {}): MentionCandidate => ({ id, role, status: "ACTIVE", role_id: null, ...extra });
const allowEveryone = async () => true;

describe("INBOX_VIEWER_ROLES", () => {
  it("is every role except the Guide, which has no Inbox access at all", () => {
    expect([...INBOX_VIEWER_ROLES].sort()).toEqual(["ADMIN", "CEO", "FINANCE", "MARKETING", "OPERATIONS", "VISA"]);
  });
});

describe("roleCanOpenInbox", () => {
  it("accepts the viewing roles in any letter case", () => {
    expect(roleCanOpenInbox("ADMIN")).toBe(true);
    expect(roleCanOpenInbox("visa")).toBe(true);
  });
  it("refuses a Guide, an unknown role and a missing one, rather than guessing", () => {
    expect(roleCanOpenInbox("GUIDE")).toBe(false);
    expect(roleCanOpenInbox("WIZARD")).toBe(false);
    expect(roleCanOpenInbox(null)).toBe(false);
    expect(roleCanOpenInbox(undefined)).toBe(false);
  });
});

describe("checkMentionedStaff", () => {
  it("allows active colleagues who can open the Inbox", async () => {
    const result = await checkMentionedStaff({ requestedIds: ["a", "b"], candidates: [person("a", "ADMIN"), person("b", "FINANCE")], canOpenInbox: allowEveryone });
    expect(result).toEqual({ ok: true });
  });

  it("allows a note that mentions nobody", async () => {
    expect(await checkMentionedStaff({ requestedIds: [], candidates: [], canOpenInbox: allowEveryone })).toEqual({ ok: true });
  });

  it("refuses a Guide", async () => {
    expect(await checkMentionedStaff({ requestedIds: ["g"], candidates: [person("g", "GUIDE")], canOpenInbox: allowEveryone })).toEqual({ ok: false, error: MENTION_NO_INBOX_MESSAGE });
  });

  it("refuses the whole list when one person cannot open the Inbox", async () => {
    const result = await checkMentionedStaff({ requestedIds: ["a", "g"], candidates: [person("a", "ADMIN"), person("g", "GUIDE")], canOpenInbox: allowEveryone });
    expect(result).toEqual({ ok: false, error: MENTION_NO_INBOX_MESSAGE });
  });

  it("refuses someone who was asked for but is not among the candidates (not in this agency, or not a real id)", async () => {
    expect(await checkMentionedStaff({ requestedIds: ["a", "ghost"], candidates: [person("a", "ADMIN")], canOpenInbox: allowEveryone })).toEqual({ ok: false, error: MENTION_UNAVAILABLE_MESSAGE });
  });

  it("refuses someone who is not active", async () => {
    expect(await checkMentionedStaff({ requestedIds: ["a"], candidates: [person("a", "ADMIN", { status: "SUSPENDED" })], canOpenInbox: allowEveryone })).toEqual({ ok: false, error: MENTION_UNAVAILABLE_MESSAGE });
    expect(await checkMentionedStaff({ requestedIds: ["a"], candidates: [person("a", "ADMIN", { status: null })], canOpenInbox: allowEveryone })).toMatchObject({ ok: false });
  });

  it("refuses someone whose custom role took Inbox access away, even though their role tier allows it", async () => {
    const canOpenInbox = vi.fn(async (candidate: MentionCandidate) => candidate.role_id !== "narrowed-role");
    const result = await checkMentionedStaff({ requestedIds: ["a", "b"], candidates: [person("a", "OPERATIONS"), person("b", "OPERATIONS", { role_id: "narrowed-role" })], canOpenInbox });
    expect(result).toEqual({ ok: false, error: MENTION_NO_INBOX_MESSAGE });
  });

  it("does not look up custom roles for someone already refused by their role tier", async () => {
    const canOpenInbox = vi.fn(async () => true);
    await checkMentionedStaff({ requestedIds: ["g"], candidates: [person("g", "GUIDE")], canOpenInbox });
    expect(canOpenInbox).not.toHaveBeenCalled();
  });
});
