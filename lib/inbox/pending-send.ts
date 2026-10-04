/**
 * One attempt at sending a staff message that is already showing as "Sending…" — SC6 of docs/inbox/scaling.md §8.5.
 *
 * The composer (first attempt) and the conversation panel (retry) both run an attempt the same way, so the rule lives here once:
 *
 *   - the server accepted it  → mark it accepted, then read just the new message (a send never waits on realtime);
 *   - the server refused it   → mark it failed with the reason; nothing was stored, so there is nothing to read;
 *   - the request threw       → it may have committed before the connection dropped. Mark it failed with a retry-safe message
 *                               and read the thread: if it did commit, the canonical message settles the pending one by key,
 *                               and if the person retries, the same key returns the same message — never a second one.
 *
 * This function never rejects, so a caller may start it without awaiting.
 */

export const UNCONFIRMED_SEND_MESSAGE = "We could not confirm this message was sent. Retry — it will not be sent twice.";

export type StaffSendOutcome = { ok: true } | { ok: false; error: string };

export async function runPendingSend(input: {
  key: string;
  send: () => Promise<StaffSendOutcome>;
  /** Runs first on success, before the message is marked accepted (the composer uses it to forget the Copilot proposal). */
  onSucceeded?: () => void;
  onAccepted: (key: string) => void;
  onFailed: (key: string, error: string) => void;
  syncThread: () => void;
}): Promise<void> {
  try {
    const result = await input.send();
    if (result.ok) {
      input.onSucceeded?.();
      input.onAccepted(input.key);
      input.syncThread();
    } else {
      input.onFailed(input.key, result.error);
    }
  } catch {
    input.onFailed(input.key, UNCONFIRMED_SEND_MESSAGE);
    input.syncThread();
  }
}
