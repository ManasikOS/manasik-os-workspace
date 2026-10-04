import { describe, expect, it } from "vitest";

import { assignmentNotification, canTakeInboxConversations, ownerChangedEventData, planConversationAssignment } from "./assignment";

const nadeesha = { id: "s1", name: "Nadeesha" };

describe("planConversationAssignment", () => {
  it("gives the chat to a person and pauses the assistant", () => {
    expect(planConversationAssignment({ state: "AI_ACTIVE", currentAssigneeId: null, target: nadeesha })).toEqual({
      ok: true,
      changed: true,
      patch: { assigned_to_id: "s1", assigned_to_name: "Nadeesha", state: "HUMAN_ACTIVE" },
    });
  });

  it("moves a chat from one owner to another", () => {
    expect(planConversationAssignment({ state: "HUMAN_ACTIVE", currentAssigneeId: "s9", target: nadeesha })).toMatchObject({ changed: true, patch: { assigned_to_id: "s1", state: "HUMAN_ACTIVE" } });
  });

  it("changes nothing when the person already owns it", () => {
    expect(planConversationAssignment({ state: "HUMAN_ACTIVE", currentAssigneeId: "s1", target: nadeesha })).toEqual({ ok: true, changed: false });
    expect(planConversationAssignment({ state: "AI_ACTIVE", currentAssigneeId: null, target: null })).toEqual({ ok: true, changed: false });
  });

  it("returns an unowned staff chat to 'waiting for staff' instead of leaving it paused with no owner", () => {
    expect(planConversationAssignment({ state: "HUMAN_ACTIVE", currentAssigneeId: "s1", target: null })).toMatchObject({ changed: true, patch: { assigned_to_id: null, assigned_to_name: null, state: "HUMAN_REQUESTED" } });
  });

  it("keeps the state when removing an owner from a chat the assistant handles or that already waits for staff", () => {
    for (const state of ["AI_ACTIVE", "AI_RESUMED", "HUMAN_REQUESTED"] as const) {
      expect(planConversationAssignment({ state, currentAssigneeId: "s1", target: null })).toMatchObject({ patch: { state } });
    }
  });

  it("refuses to assign a closed conversation", () => {
    expect(planConversationAssignment({ state: "CLOSED", currentAssigneeId: null, target: nadeesha }).ok).toBe(false);
  });
});

describe("canTakeInboxConversations", () => {
  it("allows active staff whose role can reply in the Inbox", () => {
    for (const role of ["ADMIN", "MARKETING", "OPERATIONS", "admin"]) {
      expect(canTakeInboxConversations({ role, status: "ACTIVE" })).toBe(true);
    }
  });

  it("refuses roles that can only look, or cannot open the Inbox", () => {
    for (const role of ["CEO", "FINANCE", "VISA", "GUIDE"]) {
      expect(canTakeInboxConversations({ role, status: "ACTIVE" })).toBe(false);
    }
  });

  it("refuses inactive staff and unknown or missing roles", () => {
    expect(canTakeInboxConversations({ role: "ADMIN", status: "SUSPENDED" })).toBe(false);
    expect(canTakeInboxConversations({ role: "ADMIN", status: null })).toBe(false);
    expect(canTakeInboxConversations({ role: "WIZARD", status: "ACTIVE" })).toBe(false);
    expect(canTakeInboxConversations({ role: null, status: "ACTIVE" })).toBe(false);
  });
});

describe("assignmentNotification", () => {
  it("tells the new owner who gave them which conversation", () => {
    expect(assignmentNotification({ actorId: "s9", actorName: "Amina", target: nadeesha, customerName: "Afraz" })).toEqual({
      recipientId: "s1",
      title: "Amina gave you the conversation with Afraz",
    });
  });

  it("does not notify anyone about their own change, or when the owner is removed", () => {
    expect(assignmentNotification({ actorId: "s1", actorName: "Nadeesha", target: nadeesha, customerName: "Afraz" })).toBeNull();
    expect(assignmentNotification({ actorId: "s9", actorName: "Amina", target: null, customerName: "Afraz" })).toBeNull();
  });

  it("falls back to plain words for missing names", () => {
    expect(assignmentNotification({ actorId: "s9", actorName: " ", target: nadeesha, customerName: null })?.title).toBe("A colleague gave you the conversation with a customer");
  });
});

describe("ownerChangedEventData", () => {
  it("records the owner before and after and who changed it", () => {
    expect(ownerChangedEventData({ from: { id: "s9", name: "Amina" }, to: { id: "s1", name: "Nadeesha" }, actorName: "Admin" })).toEqual({
      from_id: "s9",
      from_name: "Amina",
      to_id: "s1",
      to_name: "Nadeesha",
      changed_by_name: "Admin",
    });
  });

  it("records an unowned side as null", () => {
    expect(ownerChangedEventData({ from: { id: "s9", name: "Amina" }, to: { id: null, name: null }, actorName: null })).toMatchObject({ to_id: null, to_name: null });
  });
});
