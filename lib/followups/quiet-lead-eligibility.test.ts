import { describe, expect, it } from "vitest";

import {
  decideQuietLeadNudge,
  firstNameForNudge,
  renderNudgeText,
  WINDOW_SAFETY_MARGIN_MS,
  type QuietLeadInput,
} from "@/lib/followups/quiet-lead-eligibility";

const NOW = new Date("2026-10-01T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
const hoursAhead = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

const DEFAULT_SETTINGS: QuietLeadInput["settings"] = { enabled: true, dryRun: false, delaysHours: [3, 22, 72], hasApprovedTemplate: true };

/** Customer silent for 4 h; we spoke 3.9 h ago; the 24 h window closes in 20 h. */
function input(overrides: Partial<QuietLeadInput> = {}, conversation: Partial<QuietLeadInput["conversation"]> = {}): QuietLeadInput {
  return {
    now: NOW,
    settings: DEFAULT_SETTINGS,
    connectionReady: true,
    withinWorkingHours: true,
    conversation: {
      channel: "MESSENGER",
      state: "AI_ACTIVE",
      aiEnabled: true,
      lastInboundAt: hoursAgo(4),
      lastOutboundAt: hoursAgo(3.9),
      serviceWindowExpiresAt: hoursAhead(20),
      ...conversation,
    },
    lead: { stage: "CONTACTED", postponedUntil: null },
    consent: { consentStatus: "UNKNOWN", doNotContact: false, contactableChannels: [] },
    ledger: { nudgesRecorded: 0, lastNudgeAt: null, stopped: false },
    ...overrides,
  };
}

describe("decideQuietLeadNudge — eligibility rules", () => {
  it("sends the first nudge once the delay has passed", () => {
    expect(decideQuietLeadNudge(input())).toEqual({ action: "SEND", sequence: 1, mode: "TEXT", dryRun: false });
  });

  it("waits until the delay has passed, measured from the customer's last message", () => {
    expect(decideQuietLeadNudge(input({}, { lastInboundAt: hoursAgo(2.9), lastOutboundAt: hoursAgo(2.8) }))).toEqual({ action: "WAIT", reason: "NOT_DUE_YET" });
  });

  it("does nothing when the feature is off or the connection is not ready", () => {
    expect(decideQuietLeadNudge(input({ settings: { ...DEFAULT_SETTINGS, enabled: false } }))).toMatchObject({ reason: "DISABLED" });
    expect(decideQuietLeadNudge(input({ connectionReady: false }))).toMatchObject({ reason: "CONNECTION_NOT_READY" });
  });

  it("never nudges a conversation a person owns or that has the assistant switched off", () => {
    expect(decideQuietLeadNudge(input({}, { state: "HUMAN_ACTIVE" }))).toMatchObject({ reason: "STAFF_OWNS" });
    expect(decideQuietLeadNudge(input({}, { state: "HUMAN_REQUESTED" }))).toMatchObject({ reason: "STAFF_OWNS" });
    expect(decideQuietLeadNudge(input({}, { state: "CLOSED" }))).toMatchObject({ reason: "STAFF_OWNS" });
    expect(decideQuietLeadNudge(input({}, { aiEnabled: false }))).toMatchObject({ reason: "STAFF_OWNS" });
  });

  it("allows AI_RESUMED", () => {
    expect(decideQuietLeadNudge(input({}, { state: "AI_RESUMED" })).action).toBe("SEND");
  });

  it("requires that we spoke last", () => {
    expect(decideQuietLeadNudge(input({}, { lastOutboundAt: hoursAgo(5) }))).toMatchObject({ reason: "CUSTOMER_SPOKE_LAST" });
    expect(decideQuietLeadNudge(input({}, { lastOutboundAt: null }))).toMatchObject({ reason: "CUSTOMER_SPOKE_LAST" });
    expect(decideQuietLeadNudge(input({}, { lastInboundAt: null }))).toMatchObject({ reason: "CUSTOMER_SPOKE_LAST" });
  });

  it("needs an open lead", () => {
    expect(decideQuietLeadNudge(input({ lead: null }))).toMatchObject({ reason: "NO_LEAD" });
    for (const stage of ["BOOKED", "LOST", "POSTPONED", "DUPLICATE", "SPAM"] as const) {
      expect(decideQuietLeadNudge(input({ lead: { stage, postponedUntil: null } }))).toMatchObject({ reason: "LEAD_CLOSED" });
    }
  });

  it("respects a postponed lead until the date passes", () => {
    expect(decideQuietLeadNudge(input({ lead: { stage: "CONTACTED", postponedUntil: hoursAhead(5) } }))).toMatchObject({ reason: "LEAD_POSTPONED" });
    expect(decideQuietLeadNudge(input({ lead: { stage: "CONTACTED", postponedUntil: hoursAgo(1) } })).action).toBe("SEND");
  });

  it("blocks on do-not-contact and opt-out, recording a skip", () => {
    expect(decideQuietLeadNudge(input({ consent: { consentStatus: "UNKNOWN", doNotContact: true, contactableChannels: [] } }))).toEqual({ action: "SKIP", reason: "CONSENT" });
    expect(decideQuietLeadNudge(input({ consent: { consentStatus: "OPTED_OUT", doNotContact: false, contactableChannels: [] } }))).toEqual({ action: "SKIP", reason: "CONSENT" });
  });

  it("is dry-run when the settings say so", () => {
    expect(decideQuietLeadNudge(input({ settings: { ...DEFAULT_SETTINGS, dryRun: true } }))).toMatchObject({ action: "SEND", dryRun: true });
  });

  it("waits outside working hours", () => {
    expect(decideQuietLeadNudge(input({ withinWorkingHours: false }))).toMatchObject({ reason: "OUTSIDE_WORKING_HOURS" });
  });

  it("ignores channels it cannot nudge on", () => {
    expect(decideQuietLeadNudge(input({}, { channel: "GMAIL" }))).toMatchObject({ reason: "UNSUPPORTED_CHANNEL" });
  });
});

describe("decideQuietLeadNudge — sequence and spacing", () => {
  it("moves to the next nudge using the next delay", () => {
    const second = input(
      { ledger: { nudgesRecorded: 1, lastNudgeAt: hoursAgo(3), stopped: false } },
      { lastInboundAt: hoursAgo(23), lastOutboundAt: hoursAgo(3), serviceWindowExpiresAt: hoursAhead(1.5) },
    );
    expect(decideQuietLeadNudge(second)).toMatchObject({ action: "SEND", sequence: 2 });
  });

  it("waits for the second delay", () => {
    const early = input({ ledger: { nudgesRecorded: 1, lastNudgeAt: hoursAgo(3), stopped: false } }, { lastInboundAt: hoursAgo(10), lastOutboundAt: hoursAgo(3) });
    expect(decideQuietLeadNudge(early)).toMatchObject({ reason: "NOT_DUE_YET" });
  });

  it("stops after the last configured nudge", () => {
    expect(decideQuietLeadNudge(input({ ledger: { nudgesRecorded: 3, lastNudgeAt: hoursAgo(40), stopped: false } }))).toMatchObject({ reason: "SEQUENCE_DONE" });
  });

  it("stops after a failure or skip on this customer message", () => {
    expect(decideQuietLeadNudge(input({ ledger: { nudgesRecorded: 1, lastNudgeAt: null, stopped: true } }))).toMatchObject({ reason: "SEQUENCE_STOPPED" });
  });

  it("never sends two nudges within two hours", () => {
    const tooSoon = input({ ledger: { nudgesRecorded: 1, lastNudgeAt: hoursAgo(1.9), stopped: false } }, { lastInboundAt: hoursAgo(23) });
    expect(decideQuietLeadNudge(tooSoon)).toMatchObject({ reason: "TOO_SOON_AFTER_LAST_NUDGE" });
  });

  it("supports a single-step sequence", () => {
    const one = input({ settings: { ...DEFAULT_SETTINGS, delaysHours: [3] } });
    expect(decideQuietLeadNudge(one).action).toBe("SEND");
    expect(decideQuietLeadNudge({ ...one, ledger: { nudgesRecorded: 1, lastNudgeAt: null, stopped: false } })).toMatchObject({ reason: "SEQUENCE_DONE" });
  });
});

describe("decideQuietLeadNudge — the 24-hour window", () => {
  const lapsed = { lastInboundAt: hoursAgo(72), lastOutboundAt: hoursAgo(71), serviceWindowExpiresAt: hoursAgo(48) };
  const lapsedLedger = { nudgesRecorded: 2, lastNudgeAt: hoursAgo(30), stopped: false };

  it("skips Messenger and Instagram once the window has closed", () => {
    for (const channel of ["MESSENGER", "INSTAGRAM"]) {
      expect(decideQuietLeadNudge(input({ ledger: lapsedLedger }, { ...lapsed, channel }))).toEqual({ action: "SKIP", reason: "WINDOW_CLOSED" });
    }
  });

  it("uses the approved template on WhatsApp once the window has closed", () => {
    const whatsapp = input(
      { ledger: lapsedLedger, consent: { consentStatus: "OPTED_IN", doNotContact: false, contactableChannels: ["WHATSAPP"] } },
      { ...lapsed, channel: "WHATSAPP" },
    );
    expect(decideQuietLeadNudge(whatsapp)).toMatchObject({ action: "SEND", sequence: 3, mode: "TEMPLATE" });
  });

  it("skips a WhatsApp nudge outside the window when no template is set", () => {
    const noTemplate = input({ ledger: lapsedLedger, settings: { ...DEFAULT_SETTINGS, hasApprovedTemplate: false } }, { ...lapsed, channel: "WHATSAPP" });
    expect(decideQuietLeadNudge(noTemplate)).toEqual({ action: "SKIP", reason: "NO_TEMPLATE" });
  });

  it("needs WhatsApp channel consent for a template, but not for a free-text nudge in the window", () => {
    expect(decideQuietLeadNudge(input({ ledger: lapsedLedger }, { ...lapsed, channel: "WHATSAPP" }))).toEqual({ action: "SKIP", reason: "CONSENT" });
    expect(decideQuietLeadNudge(input({}, { channel: "WHATSAPP" })).action).toBe("SEND");
  });

  it("treats an unknown expiry as closed", () => {
    expect(decideQuietLeadNudge(input({}, { serviceWindowExpiresAt: null }))).toEqual({ action: "SKIP", reason: "WINDOW_CLOSED" });
  });

  it("closes the window a safety margin early", () => {
    const justInside = new Date(NOW.getTime() + WINDOW_SAFETY_MARGIN_MS + 1_000).toISOString();
    const justOutside = new Date(NOW.getTime() + WINDOW_SAFETY_MARGIN_MS).toISOString();
    expect(decideQuietLeadNudge(input({}, { serviceWindowExpiresAt: justInside })).action).toBe("SEND");
    expect(decideQuietLeadNudge(input({}, { serviceWindowExpiresAt: justOutside }))).toEqual({ action: "SKIP", reason: "WINDOW_CLOSED" });
  });

  it("never sends on Messenger or Instagram at or past the margin, whatever else is true", () => {
    for (const channel of ["MESSENGER", "INSTAGRAM"]) {
      for (let remainingMinutes = -3000; remainingMinutes <= 60; remainingMinutes += 15) {
        const expiry = new Date(NOW.getTime() + remainingMinutes * 60_000).toISOString();
        for (const dryRun of [true, false]) {
          for (const state of ["AI_ACTIVE", "AI_RESUMED"]) {
            const decision = decideQuietLeadNudge(
              input({ settings: { ...DEFAULT_SETTINGS, dryRun } }, { channel, state, serviceWindowExpiresAt: expiry }),
            );
            expect(decision.action).not.toBe("SEND");
          }
        }
      }
    }
  });
});

describe("nudge text", () => {
  it("uses the first name, or a neutral fallback", () => {
    expect(firstNameForNudge("Aisha Rahman")).toBe("Aisha");
    expect(firstNameForNudge("+94771234567")).toBe("there");
    expect(firstNameForNudge("")).toBe("there");
    expect(firstNameForNudge(null)).toBe("there");
  });

  it("fills every name placeholder", () => {
    expect(renderNudgeText("Hi {name}, {name}!", "Aisha Rahman")).toBe("Hi Aisha, Aisha!");
    expect(renderNudgeText("Hi {name}", null)).toBe("Hi there");
  });
});
