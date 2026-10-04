import { describe, expect, it, vi } from "vitest";

import { dismissPendingMessage, markPendingAccepted, markPendingFailed, markPendingRetrying, settlePendingMessages, type PendingStaffMessage } from "./pending-messages";
import { UNCONFIRMED_SEND_MESSAGE, runPendingSend } from "./pending-send";

const KEY = "3f0c1c52-7d0e-4a55-9c39-0d1c6b1f2a10";
const CONVERSATION = "5d2f9a41-8c7e-4b3a-a6d1-2e9f0c7b4a83";

function harness() {
  const calls: string[] = [];
  return {
    calls,
    onSucceeded: vi.fn(() => calls.push("succeeded")),
    onAccepted: vi.fn((key: string) => calls.push(`accepted:${key}`)),
    onFailed: vi.fn((key: string, error: string) => calls.push(`failed:${key}:${error}`)),
    syncThread: vi.fn(() => calls.push("sync")),
  };
}

describe("runPendingSend", () => {
  it("accepts the message, then reads the thread, when the server says ok", async () => {
    const h = harness();

    await runPendingSend({ key: KEY, send: async () => ({ ok: true }), ...h });

    expect(h.calls).toEqual(["succeeded", `accepted:${KEY}`, "sync"]);
  });

  it("fails the message with the server's reason, and does not read the thread, when the server refuses", async () => {
    const h = harness();

    await runPendingSend({ key: KEY, send: async () => ({ ok: false, error: "The 24-hour window is closed." }), ...h });

    expect(h.calls).toEqual([`failed:${KEY}:The 24-hour window is closed.`]);
  });

  it("does not run the success hook for a refusal", async () => {
    const h = harness();

    await runPendingSend({ key: KEY, send: async () => ({ ok: false, error: "No." }), ...h });

    expect(h.onSucceeded).not.toHaveBeenCalled();
    expect(h.onAccepted).not.toHaveBeenCalled();
  });

  it("marks the message failed with a retry-safe message when the request throws, then reads the thread in case it committed", async () => {
    const h = harness();

    await runPendingSend({
      key: KEY,
      send: async () => {
        throw new Error("network dropped");
      },
      ...h,
    });

    expect(h.calls).toEqual([`failed:${KEY}:${UNCONFIRMED_SEND_MESSAGE}`, "sync"]);
    expect(UNCONFIRMED_SEND_MESSAGE).toContain("will not be sent twice");
  });

  it("never rejects, so a fire-and-forget caller cannot leak an unhandled rejection", async () => {
    const h = harness();

    await expect(
      runPendingSend({
        key: KEY,
        send: () => Promise.reject(new Error("boom")),
        ...h,
      }),
    ).resolves.toBeUndefined();
  });

  it("works without a success hook, as a retry has none", async () => {
    const h = harness();

    await runPendingSend({ key: KEY, send: async () => ({ ok: true }), onAccepted: h.onAccepted, onFailed: h.onFailed, syncThread: h.syncThread });

    expect(h.calls).toEqual([`accepted:${KEY}`, "sync"]);
  });

  it("calls the send function exactly once per attempt", async () => {
    const h = harness();
    const send = vi.fn(async () => ({ ok: true as const }));

    await runPendingSend({ key: KEY, send, ...h });

    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("an optimistic send, end to end through the pending state", () => {
  const pendingEntry = (): PendingStaffMessage => ({ id: KEY, conversationId: CONVERSATION, content: "Hello", body: "Hello", attachment: null, createdAt: "2026-09-27T10:00:00.000Z", status: "SENDING", proposalId: null });

  /** Wires runPendingSend to the same transitions the conversation panel applies. */
  function panel(initial: PendingStaffMessage[]) {
    let state = initial;
    return {
      get state() {
        return state;
      },
      hooks: {
        onAccepted: (key: string) => {
          state = markPendingAccepted(state, key);
        },
        onFailed: (key: string, error: string) => {
          state = markPendingFailed(state, key, error);
        },
        syncThread: () => undefined,
      },
      retry: (key: string) => {
        state = markPendingRetrying(state, key);
      },
      dismiss: (key: string) => {
        state = dismissPendingMessage(state, key);
      },
    };
  }

  it("shows Sending, then Accepted, and disappears when the canonical message with the same key arrives", async () => {
    const view = panel([pendingEntry()]);

    await runPendingSend({ key: KEY, send: async () => ({ ok: true }), ...view.hooks });

    expect(view.state[0].status).toBe("ACCEPTED");
    expect(settlePendingMessages(view.state, [{ client_idempotency_key: KEY }])).toEqual([]);
  });

  it("fails, then a retry with the SAME key succeeds, and only one message ever settles", async () => {
    const view = panel([pendingEntry()]);
    const keysSent: string[] = [];

    await runPendingSend({
      key: KEY,
      send: async () => {
        keysSent.push(KEY);
        throw new Error("offline");
      },
      ...view.hooks,
    });
    expect(view.state[0]).toMatchObject({ status: "FAILED", error: UNCONFIRMED_SEND_MESSAGE });

    view.retry(KEY);
    expect(view.state[0].status).toBe("SENDING");
    await runPendingSend({
      key: view.state[0].id,
      send: async () => {
        keysSent.push(view.state[0].id);
        return { ok: true };
      },
      ...view.hooks,
    });

    expect(keysSent).toEqual([KEY, KEY]);
    expect(view.state).toHaveLength(1);
    expect(view.state[0].status).toBe("ACCEPTED");
  });

  it("a lost response that actually committed settles by key, so nothing is left to retry and nothing is duplicated", async () => {
    const view = panel([pendingEntry()]);

    await runPendingSend({ key: KEY, send: () => Promise.reject(new Error("response lost")), ...view.hooks });
    const afterCanonicalArrives = settlePendingMessages(view.state, [{ client_idempotency_key: KEY }]);

    expect(view.state[0].status).toBe("FAILED");
    expect(afterCanonicalArrives).toEqual([]);
  });

  it("a refused message stays visible and failed until the person dismisses it", async () => {
    const view = panel([pendingEntry()]);

    await runPendingSend({ key: KEY, send: async () => ({ ok: false, error: "Take control of this conversation before replying." }), ...view.hooks });
    expect(settlePendingMessages(view.state, [])).toHaveLength(1);
    expect(view.state[0]).toMatchObject({ status: "FAILED", error: "Take control of this conversation before replying." });

    view.dismiss(KEY);
    expect(view.state).toEqual([]);
  });
});
