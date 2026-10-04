import { describe, expect, it } from "vitest";

import {
  buildPendingStaffMessage,
  dismissPendingMessage,
  markPendingAccepted,
  markPendingFailed,
  markPendingRetrying,
  retryRequestFor,
  settlePendingMessages,
  type PendingStaffMessage,
} from "@/lib/inbox/pending-messages";

const KEY_A = "11111111-1111-4111-8111-111111111111";
const KEY_B = "22222222-2222-4222-8222-222222222222";

const pending = (id: string, content: string, status: PendingStaffMessage["status"] = "SENDING"): PendingStaffMessage => ({
  id,
  conversationId: "c1",
  content,
  body: content,
  attachment: null,
  createdAt: "2026-09-24T10:00:00.000Z",
  status,
});

const canonical = (key: string | null, content = "Hello") => ({ role: "staff", content, client_idempotency_key: key });

describe("settlePendingMessages — exact reconciliation by idempotency key", () => {
  it("keeps a pending message until the thread contains its key", () => {
    const list = [pending(KEY_A, "Hello")];
    expect(settlePendingMessages(list, [])).toBe(list);
    expect(settlePendingMessages(list, [canonical(KEY_B)])).toBe(list);
  });

  it("drops it once the canonical message with the same key has arrived", () => {
    expect(settlePendingMessages([pending(KEY_A, "Hello")], [canonical(KEY_A)])).toEqual([]);
  });

  it("does NOT settle by text: the same words with a different key are a different message", () => {
    const list = [pending(KEY_A, "Ok")];
    expect(settlePendingMessages(list, [canonical(KEY_B, "Ok")])).toEqual(list);
  });

  it("sends the same text twice, keeps both bubbles until each arrives, and settles each independently", () => {
    const list = [pending(KEY_A, "Ok"), pending(KEY_B, "Ok")];
    const afterFirst = settlePendingMessages(list, [canonical(KEY_A, "Ok")]);
    expect(afterFirst.map((entry) => entry.id)).toEqual([KEY_B]);
    expect(settlePendingMessages(afterFirst, [canonical(KEY_A, "Ok"), canonical(KEY_B, "Ok")])).toEqual([]);
  });

  it("is indifferent to the browser clock: there is no time comparison at all", () => {
    const skewed = { ...pending(KEY_A, "Hello"), createdAt: "2099-01-01T00:00:00.000Z" };
    expect(settlePendingMessages([skewed], [canonical(KEY_A)])).toEqual([]);
  });

  it("ignores messages with no key (customer messages, older staff messages)", () => {
    const list = [pending(KEY_A, "Hello")];
    const thread = [canonical(null), { role: "user", content: "Hello", client_idempotency_key: null }];
    expect(settlePendingMessages(list, thread)).toBe(list);
  });

  it("settles a failed message whose canonical row turned up anyway — the send committed and only its response was lost", () => {
    expect(settlePendingMessages([pending(KEY_A, "Hello", "FAILED")], [canonical(KEY_A)])).toEqual([]);
  });

  it("never drops a genuinely failed message on its own", () => {
    const failed = [pending(KEY_A, "Hello", "FAILED")];
    expect(settlePendingMessages(failed, [canonical(KEY_B)])).toBe(failed);
  });

  it("returns the same array when nothing settles, so a re-render is not forced", () => {
    const list = [pending(KEY_A, "Hello"), pending(KEY_B, "World")];
    expect(settlePendingMessages(list, [canonical("33333333-3333-4333-8333-333333333333")])).toBe(list);
  });
});

describe("pending state transitions", () => {
  it("accepts, fails, retries and dismisses by id, leaving the others alone", () => {
    const list = [pending(KEY_A, "One"), pending(KEY_B, "Two")];
    expect(markPendingAccepted(list, KEY_A).map((entry) => entry.status)).toEqual(["ACCEPTED", "SENDING"]);

    const failed = markPendingFailed(list, KEY_B, "Not permitted.");
    expect(failed[1]).toMatchObject({ status: "FAILED", error: "Not permitted." });
    expect(failed[0].status).toBe("SENDING");

    const retried = markPendingRetrying(failed, KEY_B);
    expect(retried[1]).toMatchObject({ status: "SENDING", error: undefined, id: KEY_B });

    expect(dismissPendingMessage(retried, KEY_B).map((entry) => entry.id)).toEqual([KEY_A]);
  });

  it("a retry keeps the SAME id — that id is the idempotency key the retry sends", () => {
    const failed = markPendingFailed([pending(KEY_A, "Hello")], KEY_A, "network");
    expect(markPendingRetrying(failed, KEY_A)[0].id).toBe(KEY_A);
  });

  it("only a failed message can be put back to sending; an accepted one is left as it is", () => {
    const accepted = markPendingAccepted([pending(KEY_A, "Hello")], KEY_A);
    expect(markPendingRetrying(accepted, KEY_A)[0].status).toBe("ACCEPTED");
  });

  it("ignores an id it does not hold", () => {
    const list = [pending(KEY_A, "One")];
    expect(markPendingAccepted(list, KEY_B)).toEqual(list);
    expect(markPendingFailed(list, KEY_B, "x")).toEqual(list);
  });
});

describe("retrying a failed send", () => {
  const FILE = { path: "agency/outbound/c1/9c1d2e3f.pdf", filename: "Itinerary.pdf", mimeType: "application/pdf" };
  const NOW = new Date("2026-09-27T10:00:00.000Z");

  const started = (over: Partial<Parameters<typeof buildPendingStaffMessage>[0]> = {}) =>
    buildPendingStaffMessage({ key: KEY_A, conversationId: "c1", content: "Hello", body: "Hello", attachment: null, proposalId: null, now: NOW, ...over });

  it("starts as a SENDING bubble whose id is the idempotency key", () => {
    expect(started()).toEqual({
      id: KEY_A,
      conversationId: "c1",
      content: "Hello",
      body: "Hello",
      attachment: null,
      proposalId: null,
      createdAt: "2026-09-27T10:00:00.000Z",
      status: "SENDING",
    });
  });

  it("retries a text message with the same key, text and proposal", () => {
    const entry = started({ proposalId: "proposal-1" });

    expect(retryRequestFor(entry)).toEqual({ conversationId: "c1", body: "Hello", proposalId: "proposal-1", key: KEY_A, attachment: null });
  });

  it("retries a file sent without a caption as that file with NO text, never the 'Sending…' placeholder the bubble shows", () => {
    const entry = started({ content: "Sending Itinerary.pdf…", body: "", attachment: FILE });

    const request = retryRequestFor(entry);

    expect(request.body).toBe("");
    expect(request.attachment).toEqual(FILE);
    expect(request.key).toBe(KEY_A);
  });

  it("retries a file sent with a caption as the same file with the same caption", () => {
    const entry = started({ content: "Your itinerary", body: "Your itinerary", attachment: FILE });

    expect(retryRequestFor(entry)).toMatchObject({ body: "Your itinerary", attachment: FILE });
  });

  it("keeps the request the same after the entry fails and is put back to sending", () => {
    const entry = started({ content: "Sending Itinerary.pdf…", body: "", attachment: FILE });
    const failed = markPendingFailed([entry], KEY_A, "offline");
    const retrying = markPendingRetrying(failed, KEY_A)[0];

    expect(retryRequestFor(retrying)).toEqual(retryRequestFor(entry));
  });

  it("does not let the display text leak into a retry when the caption is empty", () => {
    const request = retryRequestFor(started({ content: "anything shown to the person", body: "", attachment: FILE }));

    expect(request.body).not.toContain("anything shown");
  });
});
