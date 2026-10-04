import { describe, expect, it } from "vitest";

import { inboxPageHref, inboxPageRequestFromSearchParams } from "./page-request";

const ID = "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b";

describe("inboxPageRequestFromSearchParams", () => {
  it("opens the default view with no chat when the address has nothing", () => {
    expect(inboxPageRequestFromSearchParams({})).toEqual({ conversationId: null, view: "all" });
  });

  it("reads a valid conversation and view", () => {
    expect(inboxPageRequestFromSearchParams({ conversation: ID, view: "needs-reply" })).toEqual({ conversationId: ID, view: "needs-reply" });
  });

  it("ignores a conversation id that is not a well-formed id", () => {
    for (const conversation of ["", "abc", "1; drop table conversations", `${ID}x`, "../../etc/passwd"]) {
      expect(inboxPageRequestFromSearchParams({ conversation }).conversationId).toBeNull();
    }
  });

  it("ignores an unknown view", () => {
    expect(inboxPageRequestFromSearchParams({ view: "everything" }).view).toBe("all");
  });

  it("uses the first value when a parameter is repeated, and normalises the id's case", () => {
    expect(inboxPageRequestFromSearchParams({ conversation: [ID.toUpperCase(), "other"], view: ["closed", "spam"] })).toEqual({ conversationId: ID, view: "closed" });
  });
});

describe("inboxPageHref", () => {
  it("builds the shortest address", () => {
    expect(inboxPageHref({})).toBe("/inbox");
    expect(inboxPageHref({ view: "all" })).toBe("/inbox");
  });

  it("carries the view and conversation", () => {
    expect(inboxPageHref({ view: "payments", conversationId: ID })).toBe(`/inbox?view=payments&conversation=${ID}`);
    expect(inboxPageHref({ conversationId: ID })).toBe(`/inbox?conversation=${ID}`);
  });

  it("round-trips through the reader", () => {
    const href = inboxPageHref({ view: "visa", conversationId: ID });
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(inboxPageRequestFromSearchParams(params)).toEqual({ conversationId: ID, view: "visa" });
  });
});
