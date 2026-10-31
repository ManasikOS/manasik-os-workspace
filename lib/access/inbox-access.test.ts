import { describe, expect, it } from "vitest";

import { capabilitiesForInbox } from "@/lib/access/inbox-access";
import { STAFF_ROLES, type StaffRole } from "@/lib/access/departure-groups-access";

const MANAGE_ROLES: StaffRole[] = ["ADMIN", "MARKETING", "OPERATIONS"];

describe("capabilitiesForInbox — manageSavedReplies", () => {
  it.each(MANAGE_ROLES)("grants manageSavedReplies to %s, matching saved_replies' RLS write policy", (role) => {
    expect(capabilitiesForInbox(role).manageSavedReplies).toBe(true);
  });

  it.each(STAFF_ROLES.filter((role) => !MANAGE_ROLES.includes(role)))("denies manageSavedReplies to %s", (role) => {
    expect(capabilitiesForInbox(role).manageSavedReplies).toBe(false);
  });
});

describe("capabilitiesForInbox — deleteConversation", () => {
  it("is granted to administrators only, because deleting a conversation cannot be undone", () => {
    expect(STAFF_ROLES.filter((role) => capabilitiesForInbox(role).deleteConversation)).toEqual(["ADMIN"]);
  });
});

describe("capabilitiesForInbox — read-only roles (decision 2026-10-17)", () => {
  const WRITE_CAPABILITIES = [
    "takeControl",
    "releaseToAi",
    "sendMessage",
    "closeConversation",
    "deleteConversation",
    "assignConversation",
    "retryFailedJob",
    "convertConversation",
    "manageSavedReplies",
  ] as const;

  it.each(["CEO", "FINANCE", "VISA"] as const)("%s may open the Inbox and read every conversation, but change nothing", (role) => {
    const capabilities = capabilitiesForInbox(role);
    expect(capabilities.viewModule).toBe(true);
    for (const key of WRITE_CAPABILITIES) expect(capabilities[key], key).toBe(false);
  });

  it("GUIDE cannot open the Inbox", () => {
    expect(capabilitiesForInbox("GUIDE").viewModule).toBe(false);
  });
});
