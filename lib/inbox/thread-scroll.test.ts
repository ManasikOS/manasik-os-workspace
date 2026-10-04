import { describe, expect, it } from "vitest";

import { decideThreadScroll, isThreadNearBottom, THREAD_BOTTOM_SLACK_PX } from "./thread-scroll";

describe("isThreadNearBottom", () => {
  it("is true at the very bottom and within the slack", () => {
    expect(isThreadNearBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(true);
    expect(isThreadNearBottom({ scrollHeight: 1000, scrollTop: 600 - THREAD_BOTTOM_SLACK_PX, clientHeight: 400 })).toBe(true);
  });

  it("is false once the person has scrolled further up", () => {
    expect(isThreadNearBottom({ scrollHeight: 1000, scrollTop: 600 - THREAD_BOTTOM_SLACK_PX - 1, clientHeight: 400 })).toBe(false);
  });
});

describe("decideThreadScroll", () => {
  const base = { switchedConversation: false, newItemArrived: true, ownSend: false, wasNearBottom: true };

  it("jumps when another chat opens, however far the last one was scrolled", () => {
    expect(decideThreadScroll({ ...base, switchedConversation: true, wasNearBottom: false })).toBe("JUMP");
  });

  it("follows a new message when the person was at the bottom", () => {
    expect(decideThreadScroll(base)).toBe("FOLLOW");
  });

  it("follows the person's own send even if they had scrolled up", () => {
    expect(decideThreadScroll({ ...base, ownSend: true, wasNearBottom: false })).toBe("FOLLOW");
  });

  it("leaves a reader of older messages where they are and says something new arrived", () => {
    expect(decideThreadScroll({ ...base, wasNearBottom: false })).toBe("NOTIFY");
  });

  it("does nothing when nothing new arrived", () => {
    expect(decideThreadScroll({ ...base, newItemArrived: false })).toBe("NONE");
  });
});
