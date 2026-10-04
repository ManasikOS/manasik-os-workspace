import { describe, expect, it } from "vitest";

import {
  INBOX_THREAD_MIN_WIDTH_PX,
  inboxLayoutBudget,
  inboxViewportTier,
  type InboxViewportTier,
} from "./inbox-layout-budget";

describe("inboxViewportTier", () => {
  it("splits at the lg, xl and 1440 widths", () => {
    expect(inboxViewportTier(375)).toBe("narrow");
    expect(inboxViewportTier(1023)).toBe("narrow");
    expect(inboxViewportTier(1024)).toBe("laptop");
    expect(inboxViewportTier(1279)).toBe("laptop");
    expect(inboxViewportTier(1280)).toBe("desktop");
    expect(inboxViewportTier(1439)).toBe("desktop");
    expect(inboxViewportTier(1440)).toBe("wide");
    expect(inboxViewportTier(1920)).toBe("wide");
  });
});

describe("inboxLayoutBudget defaults", () => {
  const defaults = (tier: InboxViewportTier) =>
    inboxLayoutBudget({ tier, railChoice: null, panelChoice: null });

  it("docks the customer panel as a rail from 1280px and folds the queue rail until 1440px", () => {
    expect(defaults("laptop")).toMatchObject({ railCollapsed: true, panelDocked: false });
    expect(defaults("desktop")).toMatchObject({ railCollapsed: true, panelDocked: true, panelOpen: true });
    expect(defaults("wide")).toMatchObject({ railCollapsed: false, panelDocked: true, panelOpen: true });
  });

  it("keeps the thread at or above the floor at every laptop-and-up default", () => {
    for (const tier of ["laptop", "desktop", "wide"] as const) {
      expect(defaults(tier).threadWidthPx).toBeGreaterThanOrEqual(INBOX_THREAD_MIN_WIDTH_PX);
    }
  });

  it("gives the thread more room than the original fixed layout did at 1280px (404px)", () => {
    // Originally: 1280 - 216 rail - 320 list - 340 panel = 404. Now the rail is folded: 1280 - 48 - 320 - 340 = 572.
    expect(defaults("desktop").threadWidthPx).toBeGreaterThan(404);
  });
});

describe("inboxLayoutBudget person's choice", () => {
  it("honours an expanded rail on a laptop and a collapsed rail on a wide screen", () => {
    expect(inboxLayoutBudget({ tier: "laptop", railChoice: "expanded", panelChoice: null }).railCollapsed).toBe(false);
    expect(inboxLayoutBudget({ tier: "wide", railChoice: "collapsed", panelChoice: null }).railCollapsed).toBe(true);
  });

  it("lets the person hide a docked panel, which returns its room to the thread", () => {
    const open = inboxLayoutBudget({ tier: "wide", railChoice: null, panelChoice: "open" });
    const closed = inboxLayoutBudget({ tier: "wide", railChoice: null, panelChoice: "closed" });
    expect(closed.panelOpen).toBe(false);
    expect(closed.threadWidthPx - open.threadWidthPx).toBe(340);
  });
});
