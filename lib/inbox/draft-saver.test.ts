import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDraftSaver } from "./draft-saver";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("createDraftSaver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("saves once, after the typing pause", () => {
    const save = vi.fn(async () => undefined);
    const saver = createDraftSaver({ save, delayMs: 700 });
    saver.schedule("c1", "He");
    saver.schedule("c1", "Hello");
    vi.advanceTimersByTime(699);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("c1", "Hello");
  });

  it("flush saves what is waiting right now, so leaving the chat does not lose the last words", () => {
    const save = vi.fn(async () => undefined);
    const saver = createDraftSaver({ save, delayMs: 700 });
    saver.schedule("c1", "Almost done");
    saver.flush();
    expect(save).toHaveBeenCalledWith("c1", "Almost done");
    vi.advanceTimersByTime(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush with nothing waiting saves nothing", () => {
    const save = vi.fn(async () => undefined);
    createDraftSaver({ save }).flush();
    expect(save).not.toHaveBeenCalled();
  });

  it("never lets a slow older save land after a newer one: the clear waits for the save in flight", async () => {
    const first = deferred();
    const order: string[] = [];
    const save = vi.fn(async (_id: string, body: string) => {
      order.push(`start:${body}`);
      if (body === "typed") await first.promise;
      order.push(`end:${body}`);
    });
    const saver = createDraftSaver({ save, delayMs: 700 });
    saver.schedule("c1", "typed");
    vi.advanceTimersByTime(700);
    saver.clearNow("c1");
    await Promise.resolve();
    expect(order).toEqual(["start:typed"]);
    first.resolve();
    await vi.runAllTimersAsync();
    expect(order).toEqual(["start:typed", "end:typed", "start:", "end:"]);
  });

  it("clearNow drops a waiting save so a cleared box is not brought back", () => {
    const save = vi.fn(async () => undefined);
    const saver = createDraftSaver({ save, delayMs: 700 });
    saver.schedule("c1", "sent text");
    saver.clearNow("c1");
    vi.advanceTimersByTime(5000);
    expect(save.mock.calls).toEqual([["c1", ""]]);
  });

  it("a failing save is reported and does not block the next one", async () => {
    const onError = vi.fn();
    const save = vi.fn(async (_id: string, body: string) => {
      if (body === "a") throw new Error("offline");
    });
    const saver = createDraftSaver({ save, onError, delayMs: 700 });
    saver.schedule("c1", "a");
    saver.flush();
    saver.schedule("c1", "b");
    saver.flush();
    await vi.runAllTimersAsync();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith("c1", "b");
  });
});
