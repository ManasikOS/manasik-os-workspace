import { describe, expect, it } from "vitest";

import { facts, NOW } from "../fixtures";
import { detectWindowClosingSoon } from "./window-closing-soon";

const inMinutes = (minutes: number) => new Date(Date.parse(NOW) + minutes * 60_000).toISOString();

describe("WINDOW_CLOSING_SOON", () => {
  it("fires inside two hours while the customer is waiting for us", () => {
    const finding = detectWindowClosingSoon(facts({ serviceWindowExpiresAt: inMinutes(90) }));
    expect(finding).toMatchObject({ code: "WINDOW_CLOSING_SOON", messageId: null });
    expect(finding?.evidence[0].snippet).toBe("The reply window closes in 90 minutes");
  });

  it("near-miss: exactly two hours fires, one minute more does not", () => {
    expect(detectWindowClosingSoon(facts({ serviceWindowExpiresAt: inMinutes(120) }))).not.toBeNull();
    expect(detectWindowClosingSoon(facts({ serviceWindowExpiresAt: inMinutes(121) }))).toBeNull();
  });

  it("does not fire once the window has already closed, or exactly now", () => {
    expect(detectWindowClosingSoon(facts({ serviceWindowExpiresAt: inMinutes(-5) }))).toBeNull();
    expect(detectWindowClosingSoon(facts({ serviceWindowExpiresAt: inMinutes(0) }))).toBeNull();
  });

  it("does not fire when we have already answered", () => {
    expect(detectWindowClosingSoon(facts({ serviceWindowExpiresAt: inMinutes(30), awaitingReply: false }))).toBeNull();
  });

  it("negative: a channel with no window", () => {
    expect(detectWindowClosingSoon(facts())).toBeNull();
  });
});
