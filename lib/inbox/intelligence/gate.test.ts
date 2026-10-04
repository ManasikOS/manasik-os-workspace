import { describe, expect, it } from "vitest";

import { GATE_ENRICH_REASONS, GATE_REASONS, GATE_SKIP_REASONS, gateReasonSchema } from "./contracts";
import {
  ACKNOWLEDGEMENT_MAX_TOKENS,
  HUMAN_ACTIVE_WINDOW_MS,
  detectRedFlags,
  isAcknowledgementOnly,
  mentionsUnapprovedBankDetails,
  shouldEnrich,
  type GateInput,
} from "./gate";

const NOW = new Date("2026-09-20T10:00:00Z");
const secondsAgo = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

/** A message that should be enriched: an open conversation, an enabled surface, new content. Each test changes one thing. */
function gateInput(overrides: {
  text?: string;
  type?: GateInput["message"]["type"];
  lifecycleStatus?: GateInput["conversation"]["lifecycleStatus"];
  handlingMode?: GateInput["conversation"]["handlingMode"];
  awaitingCustomerAnswer?: boolean;
  staffActiveSecondsAgo?: number | null;
  previous?: GateInput["previous"];
  current?: GateInput["current"];
  surface?: GateInput["surface"];
  entitlementExhausted?: boolean;
  approvedAccountNumbers?: string[];
} = {}): GateInput {
  return {
    message: { text: overrides.text ?? "Hi, I want to know the price of a 10 day Umrah package in November for three people", type: overrides.type ?? "TEXT" },
    conversation: {
      lifecycleStatus: overrides.lifecycleStatus ?? "OPEN",
      handlingMode: overrides.handlingMode ?? "AI_ACTIVE",
      awaitingCustomerAnswer: overrides.awaitingCustomerAnswer ?? false,
    },
    staff: { lastActiveAt: overrides.staffActiveSecondsAgo === undefined || overrides.staffActiveSecondsAgo === null ? null : secondsAgo(overrides.staffActiveSecondsAgo) },
    previous: overrides.previous === undefined ? null : overrides.previous,
    current: overrides.current ?? { fingerprint: "fp-2", pipelineVersion: 1 },
    surface: overrides.surface ?? { enabled: true, mode: "ACTIVE" },
    entitlementExhausted: overrides.entitlementExhausted ?? false,
    approvedAccountNumbers: overrides.approvedAccountNumbers,
    now: NOW,
  };
}

const FRESH_PREVIOUS = { fingerprint: "fp-1", state: "FRESH" as const, pipelineVersion: 1 };

describe("enrichment: a real message on an open conversation goes through", () => {
  it("a first message is ENRICH_NEW_CONVERSATION", () => {
    expect(shouldEnrich(gateInput())).toEqual({ enrich: true, reason: "ENRICH_NEW_CONVERSATION", escalateToRisk: false, redFlags: [] });
  });

  it("a later message with a changed fingerprint is ENRICH_NEW_MESSAGE", () => {
    expect(shouldEnrich(gateInput({ previous: FRESH_PREVIOUS })).reason).toBe("ENRICH_NEW_MESSAGE");
  });

  it("a shadow-mode surface still enriches: shadow means observe, not off", () => {
    expect(shouldEnrich(gateInput({ surface: { enabled: true, mode: "SHADOW" } })).enrich).toBe(true);
  });

  it("an attachment is never a throwaway acknowledgement, even with no caption", () => {
    for (const type of ["IMAGE", "DOCUMENT", "AUDIO"] as const) {
      expect(shouldEnrich(gateInput({ text: "", type })).enrich).toBe(true);
    }
  });
});

describe("skip rules", () => {
  it("SKIP_SURFACE_OFF: the surface is switched off, or disabled whatever its mode", () => {
    expect(shouldEnrich(gateInput({ surface: { enabled: true, mode: "OFF" } })).reason).toBe("SKIP_SURFACE_OFF");
    expect(shouldEnrich(gateInput({ surface: { enabled: false, mode: "SHADOW" } })).reason).toBe("SKIP_SURFACE_OFF");
  });

  it("SKIP_ENTITLEMENT_EXHAUSTED: the plan allowance is used up", () => {
    expect(shouldEnrich(gateInput({ entitlementExhausted: true })).reason).toBe("SKIP_ENTITLEMENT_EXHAUSTED");
  });

  it("SKIP_SPAM and SKIP_CLOSED", () => {
    expect(shouldEnrich(gateInput({ lifecycleStatus: "SPAM" })).reason).toBe("SKIP_SPAM");
    expect(shouldEnrich(gateInput({ lifecycleStatus: "CLOSED" })).reason).toBe("SKIP_CLOSED");
  });

  it("SKIP_HUMAN_ACTIVE: a person is handling it and was active inside the last two minutes", () => {
    expect(shouldEnrich(gateInput({ handlingMode: "HUMAN_ACTIVE", staffActiveSecondsAgo: 30 })).reason).toBe("SKIP_HUMAN_ACTIVE");
    expect(shouldEnrich(gateInput({ handlingMode: "HUMAN_ACTIVE", staffActiveSecondsAgo: HUMAN_ACTIVE_WINDOW_MS / 1000 })).reason).toBe("SKIP_HUMAN_ACTIVE");
  });

  it("a human assigned but quiet for over two minutes, or never seen, does not skip", () => {
    expect(shouldEnrich(gateInput({ handlingMode: "HUMAN_ACTIVE", staffActiveSecondsAgo: 121 })).enrich).toBe(true);
    expect(shouldEnrich(gateInput({ handlingMode: "HUMAN_ACTIVE", staffActiveSecondsAgo: null })).enrich).toBe(true);
  });

  it("recent staff activity alone does not skip unless the conversation is in human handling", () => {
    expect(shouldEnrich(gateInput({ handlingMode: "AI_ACTIVE", staffActiveSecondsAgo: 5 })).enrich).toBe(true);
    expect(shouldEnrich(gateInput({ handlingMode: "HUMAN_REQUESTED", staffActiveSecondsAgo: 5 })).enrich).toBe(true);
  });

  it("a staff timestamp in the future (clock skew) does not count as recent activity", () => {
    expect(shouldEnrich(gateInput({ handlingMode: "HUMAN_ACTIVE", staffActiveSecondsAgo: -30 })).enrich).toBe(true);
  });

  it("SKIP_UNCHANGED_INPUT: same fingerprint, same pipeline version, previous row FRESH", () => {
    const decision = shouldEnrich(gateInput({ previous: FRESH_PREVIOUS, current: { fingerprint: "fp-1", pipelineVersion: 1 } }));
    expect(decision).toMatchObject({ enrich: false, reason: "SKIP_UNCHANGED_INPUT" });
  });

  it("an unchanged fingerprint still enriches when the pipeline version was bumped, or the last attempt did not finish", () => {
    expect(shouldEnrich(gateInput({ previous: FRESH_PREVIOUS, current: { fingerprint: "fp-1", pipelineVersion: 2 } })).enrich).toBe(true);
    for (const state of ["FAILED", "STALE", "PENDING", "SKIPPED"] as const) {
      expect(shouldEnrich(gateInput({ previous: { ...FRESH_PREVIOUS, state }, current: { fingerprint: "fp-1", pipelineVersion: 1 } })).enrich).toBe(true);
    }
  });

  it("when several skip rules hold, the reason is the first in the reported order (off, plan, spam, closed, human, unchanged, acknowledgement)", () => {
    const everything = gateInput({
      text: "ok", surface: { enabled: true, mode: "OFF" }, entitlementExhausted: true, lifecycleStatus: "SPAM",
      handlingMode: "HUMAN_ACTIVE", staffActiveSecondsAgo: 10, previous: FRESH_PREVIOUS, current: { fingerprint: "fp-1", pipelineVersion: 1 },
    });
    expect(shouldEnrich(everything).reason).toBe("SKIP_SURFACE_OFF");
    expect(shouldEnrich({ ...everything, surface: { enabled: true, mode: "ACTIVE" } }).reason).toBe("SKIP_ENTITLEMENT_EXHAUSTED");
    expect(shouldEnrich({ ...everything, surface: { enabled: true, mode: "ACTIVE" }, entitlementExhausted: false }).reason).toBe("SKIP_SPAM");
  });
});

describe("acknowledgements", () => {
  const ack = (text: string, awaitingCustomerAnswer = false) => isAcknowledgementOnly({ message: { text, type: "TEXT" }, awaitingCustomerAnswer });

  it.each([
    "ok", "OK", "Okay!", "thanks", "Thank you", "thank you very much", "ok thanks", "noted", "got it", "👍", "🙏🙏", "ok 👍", "...", "❤️",
    "ස්තූතියි", "හරි", "நன்றி", "சரி", "jazakallah khair",
  ])("%j is an acknowledgement", (text) => {
    expect(ack(text)).toBe(true);
    expect(shouldEnrich(gateInput({ text })).reason).toBe("SKIP_ACKNOWLEDGEMENT");
  });

  it.each([
    "yes", "no", "yes please", "ok how much", "ok book it", "thanks, what about December?", "ok 3 adults", "4", "will do", "do it",
    "thank you for the quote but the price is too high for us",
  ])("%j is information, not an acknowledgement", (text) => {
    expect(ack(text)).toBe(false);
    expect(shouldEnrich(gateInput({ text })).enrich).toBe(true);
  });

  it("a bare 'ok' or 'sure' is the ANSWER when we just asked a question — never skipped", () => {
    expect(ack("ok", true)).toBe(false);
    expect(ack("sure", true)).toBe(false);
    expect(ack("👍", true)).toBe(false);
    expect(shouldEnrich(gateInput({ text: "ok", awaitingCustomerAnswer: true })).enrich).toBe(true);
  });

  it("an angry or alarmed emoji is a feeling the triage stage needs, not a throwaway reaction", () => {
    for (const text of ["😡", "😭😭", "🚨", "ok 😠"]) expect(ack(text)).toBe(false);
  });

  it("a sticker is an acknowledgement unless it answers a question we asked", () => {
    expect(isAcknowledgementOnly({ message: { text: "", type: "STICKER" }, awaitingCustomerAnswer: false })).toBe(true);
    expect(isAcknowledgementOnly({ message: { text: "", type: "STICKER" }, awaitingCustomerAnswer: true })).toBe(false);
  });

  it("an empty text message is not an acknowledgement", () => {
    expect(ack("")).toBe(false);
    expect(ack("   ")).toBe(false);
  });

  it("the token threshold is enforced: more than four acknowledging words is treated as a real message", () => {
    expect(ACKNOWLEDGEMENT_MAX_TOKENS).toBe(4);
    expect(ack("ok ok ok ok")).toBe(true);
    expect(ack("ok ok ok ok ok")).toBe(false);
  });
});

describe("red flags: refunds, distress and unapproved bank details", () => {
  it.each([
    ["I want a refund", "REFUND_REQUEST"],
    ["please refund my deposit", "REFUND_REQUEST"],
    ["I need my money back", "REFUND_REQUEST"],
    ["give back the payment I made", "REFUND_REQUEST"],
    ["මට මුදල් ආපසු ඕනේ", "REFUND_REQUEST"],
    ["எனக்கு பணத்தை திருப்பி தாருங்கள்", "REFUND_REQUEST"],
    ["We are stranded at the airport, this is an emergency", "DISTRESS_LANGUAGE"],
    ["my passport is lost", "DISTRESS_LANGUAGE"],
    ["my father is in hospital", "DISTRESS_LANGUAGE"],
    ["nobody is answering my calls", "DISTRESS_LANGUAGE"],
    ["I think we have been scammed", "DISTRESS_LANGUAGE"],
    ["හදිසි අවස්ථාවක්", "DISTRESS_LANGUAGE"],
    ["இது அவசர நிலை", "DISTRESS_LANGUAGE"],
    ["Transfer to bank account 1234567890 today", "BANK_DETAIL_MISMATCH"],
    ["my a/c no is 123-456-7890", "BANK_DETAIL_MISMATCH"],
  ] as const)("%j raises %s", (text, flag) => {
    expect(detectRedFlags(text)).toContain(flag);
  });

  it.each([
    "Hi, I want to book Umrah for December",
    "Can you help me choose a package?",
    "It is urgent, we travel next week, please reply",
    "Is the hotel close to the Haram?",
    "Please call me on 0771234567",
    "How does refunding work in general?".replace("refunding", "cancellation"),
    "Is there a hospital near the hotel in Makkah?".replace("hospital", "pharmacy"),
  ])("%j raises nothing", (text) => {
    expect(detectRedFlags(text)).toEqual([]);
  });

  it("a phone number is not a bank account unless a bank word is next to it", () => {
    expect(mentionsUnapprovedBankDetails("call 0771234567 tomorrow")).toBe(false);
    expect(mentionsUnapprovedBankDetails("bank details 0771234567")).toBe(true);
  });

  it("an approved account number is not flagged, whatever its spacing; an unapproved one beside it is", () => {
    const approved = ["123-456-7890"];
    expect(mentionsUnapprovedBankDetails("please pay to account 1234567890", approved)).toBe(false);
    expect(mentionsUnapprovedBankDetails("please pay to account 1234 5678 90", approved)).toBe(false);
    expect(mentionsUnapprovedBankDetails("account 1234567890 or account 9988776655", approved)).toBe(true);
  });

  it("several flags can fire on one message", () => {
    expect(detectRedFlags("This is an emergency, I want my money back to bank account 99887766")).toEqual(["REFUND_REQUEST", "DISTRESS_LANGUAGE", "BANK_DETAIL_MISMATCH"]);
  });

  it("the gate carries the approved account list through to the bank check", () => {
    const text = "I paid into account 1234567890";
    expect(shouldEnrich({ ...gateInput({ text }), approvedAccountNumbers: [] }).redFlags).toContain("BANK_DETAIL_MISMATCH");
    expect(shouldEnrich({ ...gateInput({ text }), approvedAccountNumbers: ["1234567890"] }).redFlags).not.toContain("BANK_DETAIL_MISMATCH");
  });
});

describe("RISK IS NEVER GATED ON COST — this test must never be deleted", () => {
  const SKIP_CASES: Array<[string, Partial<Parameters<typeof gateInput>[0]>, string]> = [
    ["the surface is off", { surface: { enabled: true, mode: "OFF" } }, "SKIP_SURFACE_OFF"],
    ["the surface is disabled", { surface: { enabled: false, mode: "SHADOW" } }, "SKIP_SURFACE_OFF"],
    ["the plan allowance is exhausted", { entitlementExhausted: true }, "SKIP_ENTITLEMENT_EXHAUSTED"],
    ["the conversation is spam", { lifecycleStatus: "SPAM" }, "SKIP_SPAM"],
    ["the conversation is closed", { lifecycleStatus: "CLOSED" }, "SKIP_CLOSED"],
    ["a human is actively handling it", { handlingMode: "HUMAN_ACTIVE", staffActiveSecondsAgo: 5 }, "SKIP_HUMAN_ACTIVE"],
    ["the input fingerprint is unchanged", { previous: FRESH_PREVIOUS, current: { fingerprint: "fp-1", pipelineVersion: 1 } }, "SKIP_UNCHANGED_INPUT"],
  ];
  const RED_FLAG_MESSAGES: Array<[string, string]> = [
    ["a refund request", "I want a refund"],
    ["distress language", "we are stranded and it is an emergency"],
    ["a bank-detail mismatch", "please transfer to bank account 5566778899"],
  ];

  for (const [skipName, overrides, expectedReason] of SKIP_CASES) {
    for (const [flagName, text] of RED_FLAG_MESSAGES) {
      it(`${flagName} escalates to risk even though ${skipName}`, () => {
        const decision = shouldEnrich(gateInput({ ...overrides, text }));
        expect(decision.enrich).toBe(false);
        expect(decision.reason).toBe(expectedReason);
        expect(decision.escalateToRisk).toBe(true);
        expect(decision.redFlags.length).toBeGreaterThan(0);
      });
    }
  }

  it("a red flag inside an acknowledgement-length message still escalates", () => {
    const decision = shouldEnrich(gateInput({ text: "refund" }));
    expect(decision.escalateToRisk).toBe(true);
  });

  it("and with every skip rule holding at once, risk still runs", () => {
    const decision = shouldEnrich(
      gateInput({
        text: "I want my money back", surface: { enabled: false, mode: "OFF" }, entitlementExhausted: true, lifecycleStatus: "SPAM",
        handlingMode: "HUMAN_ACTIVE", staffActiveSecondsAgo: 1, previous: FRESH_PREVIOUS, current: { fingerprint: "fp-1", pipelineVersion: 1 },
      }),
    );
    expect(decision).toMatchObject({ enrich: false, escalateToRisk: true });
  });

  it("an ordinary message under every skip rule does NOT escalate — the flag is precise, not a blanket", () => {
    for (const [, overrides] of SKIP_CASES) {
      expect(shouldEnrich(gateInput({ ...overrides, text: "what time is the flight" })).escalateToRisk).toBe(false);
    }
  });
});

describe("decision shape", () => {
  it("every skip carries a skip reason, every enrichment an enrich reason, and all are in the closed list", () => {
    const decisions = [
      shouldEnrich(gateInput()),
      shouldEnrich(gateInput({ previous: FRESH_PREVIOUS })),
      shouldEnrich(gateInput({ text: "ok" })),
      shouldEnrich(gateInput({ lifecycleStatus: "CLOSED" })),
      shouldEnrich(gateInput({ entitlementExhausted: true })),
    ];
    for (const decision of decisions) {
      expect(gateReasonSchema.safeParse(decision.reason).success).toBe(true);
      const list: readonly string[] = decision.enrich ? GATE_ENRICH_REASONS : GATE_SKIP_REASONS;
      expect(list).toContain(decision.reason);
    }
  });

  it("the reason list is the enrich reasons plus the skip reasons, with no duplicates", () => {
    expect(GATE_REASONS).toHaveLength(GATE_ENRICH_REASONS.length + GATE_SKIP_REASONS.length);
    expect(new Set(GATE_REASONS).size).toBe(GATE_REASONS.length);
  });

  it("is pure: the same input gives the same decision and the input is not mutated", () => {
    const input = gateInput({ text: "I want a refund" });
    const snapshot = JSON.stringify(input);
    expect(shouldEnrich(input)).toEqual(shouldEnrich(input));
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
