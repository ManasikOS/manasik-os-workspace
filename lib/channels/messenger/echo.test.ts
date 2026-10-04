import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { classifyEcho, reconcileEcho, MESSENGER_PAGE_INBOX_LABEL } = await import("./echo");

describe("classifyEcho", () => {
  it("recognises our own app by id", () => {
    expect(classifyEcho("555", "555")).toBe("OWN_APP");
  });

  it("treats a different app, no app, or an unconfigured own id as another sender — never assumed ours", () => {
    expect(classifyEcho("999", "555")).toBe("OTHER");
    expect(classifyEcho(null, "555")).toBe("OTHER");
    expect(classifyEcho("555", undefined)).toBe("OTHER");
    expect(classifyEcho("555", "")).toBe("OTHER");
  });
});

const payload = {
  connectionId: "cc-1",
  pageId: "page-1",
  psid: "psid-1",
  mid: "e1",
  text: "Hello from the team",
  messageType: "TEXT" as const,
  contactName: "Fatima",
};

function deps(known: boolean) {
  return {
    messageExists: vi.fn(async () => known),
    markHandled: vi.fn(async () => ({ id: "conv-1" }) as never),
    insertMessage: vi.fn(async () => null),
  };
}

const db = {} as never;

describe("reconcileEcho", () => {
  it("does nothing when the message has been recognised by the time the job runs (our own send saved its id)", async () => {
    const d = deps(true);
    await expect(reconcileEcho(db, "agency-1", payload, d)).resolves.toBe("ALREADY_KNOWN");
    expect(d.markHandled).not.toHaveBeenCalled();
    expect(d.insertMessage).not.toHaveBeenCalled();
  });

  it("hands a still-unknown echo to staff and records it as a person's message", async () => {
    const d = deps(false);
    await expect(reconcileEcho(db, "agency-1", payload, d)).resolves.toBe("RECORDED_AS_PERSON");

    expect(d.markHandled).toHaveBeenCalledWith(db, {
      agencyId: "agency-1",
      waId: "psid-1",
      contactName: "Fatima",
      channel: "MESSENGER",
      connectionId: "cc-1",
    });
    expect(d.insertMessage).toHaveBeenCalledWith(db, {
      agencyId: "agency-1",
      conversationId: "conv-1",
      externalMessageId: "e1",
      role: "staff",
      actorKind: "STAFF",
      actorName: MESSENGER_PAGE_INBOX_LABEL,
      content: "Hello from the team",
      messageType: "TEXT",
      deliveryStatus: "SENT",
      metadata: { source: "messenger_page_inbox" },
    });
  });

  it("checks for the message before handing the conversation over, so the race resolves the safe way", async () => {
    const order: string[] = [];
    const d = {
      messageExists: vi.fn(async () => {
        order.push("check");
        return false;
      }),
      markHandled: vi.fn(async () => {
        order.push("handover");
        return { id: "conv-1" } as never;
      }),
      insertMessage: vi.fn(async () => {
        order.push("record");
        return null;
      }),
    };
    await reconcileEcho(db, "agency-1", payload, d);
    expect(order).toEqual(["check", "handover", "record"]);
  });
});
