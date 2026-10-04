/**
 * Saves the composer's draft without losing or resurrecting text.
 *
 * Saving is debounced, but three things went wrong with a bare timer: leaving a chat within the pause cancelled the save (the
 * last words were lost), the clear sent after a message was sent could overtake a slower earlier save (the sent text came back
 * as a draft), and a failed save was silent. Here every write goes through one queue, so writes reach the server in the order
 * they were made; `flush` sends what is waiting now; `clearNow` drops what is waiting and queues the empty draft.
 */
export interface DraftSaver {
  /** Remember `body` and save it after the typing pause. A newer call replaces an older one. */
  schedule(conversationId: string, body: string): void;
  /** Save what is waiting right now (leaving the chat, closing the tab). */
  flush(): void;
  /** The message was sent: forget anything waiting and queue an empty draft behind any save already in flight. */
  clearNow(conversationId: string): void;
}

export function createDraftSaver(options: {
  save: (conversationId: string, body: string) => Promise<unknown>;
  onError?: (cause: unknown) => void;
  delayMs?: number;
}): DraftSaver {
  const delayMs = options.delayMs ?? 700;
  let waiting: { conversationId: string; body: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const behind: Array<[string, string]> = [];
  let inFlight = false;

  const cancelTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  // One write at a time, in the order made; an idle saver starts the write straight away.
  const run = async (conversationId: string, body: string): Promise<void> => {
    inFlight = true;
    try {
      await options.save(conversationId, body);
    } catch (cause) {
      options.onError?.(cause);
    } finally {
      inFlight = false;
    }
    const next = behind.shift();
    if (next) await run(next[0], next[1]);
  };

  const enqueue = (conversationId: string, body: string) => {
    if (inFlight) behind.push([conversationId, body]);
    else void run(conversationId, body);
  };

  const flush = () => {
    cancelTimer();
    if (!waiting) return;
    const { conversationId, body } = waiting;
    waiting = null;
    enqueue(conversationId, body);
  };

  return {
    schedule(conversationId, body) {
      waiting = { conversationId, body };
      cancelTimer();
      timer = setTimeout(flush, delayMs);
    },
    flush,
    clearNow(conversationId) {
      cancelTimer();
      waiting = null;
      enqueue(conversationId, "");
    },
  };
}
