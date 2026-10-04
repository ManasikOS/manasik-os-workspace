import { describe, expect, it } from "vitest";

import type { QueueCode } from "@/lib/inbox/intelligence/contracts";

import { decideBreachActions } from "./breach";
import type { SlaBasis } from "./due-at";
import { DEFAULT_SLA_POLICIES } from "./policies";

const policies = new Map(DEFAULT_SLA_POLICIES.map((policy) => [policy.queueCode, policy]));

const breach = (queues: QueueCode[], deadlineQueue: QueueCode | null, basis: SlaBasis = "FIRST_REPLY") => decideBreachActions({ band: "BREACHED", basis, deadlineQueue, queues, policies });

describe("a breach is a signal, not an email storm (R2 rule 3)", () => {
  it("records the signal for every queue, and opens an intervention for none of the low-stakes ones", () => {
    for (const queue of ["NEEDS_REPLY", "NEW_ENQUIRIES", "DEPARTURE_CHANGES", "GROUP_CHANGES", "QUALIFIED", "QUOTE_SENT", "DOCUMENTS", "VISA_ISSUES"] as const) {
      const plan = breach([queue], queue);
      expect(plan.recordSignal, queue).toBe(true);
      expect(plan.intervention, queue).toBeNull();
    }
  });

  it("opens an intervention for exactly the four queues R2 names", () => {
    for (const queue of ["ESCALATIONS", "COMPLAINTS", "PAYMENT_DISCUSSIONS", "BOOKING_READY"] as const) {
      const plan = breach([queue], queue);
      expect(plan.recordSignal, queue).toBe(true);
      expect(plan.intervention?.headline, queue).toBe("A reply is overdue");
      expect(plan.intervention?.guidance, queue).toMatch(/close this review/);
    }
  });

  it("follows the queue that set the deadline: a documents deadline breach inside a complaint still only signals", () => {
    expect(breach(["COMPLAINTS", "DOCUMENTS"], "DOCUMENTS").intervention).toBeNull();
    expect(breach(["COMPLAINTS", "DOCUMENTS"], "COMPLAINTS").intervention).not.toBeNull();
  });

  it("respects an owner who switched intervention-on-breach off for a queue", () => {
    const quiet = new Map(policies);
    quiet.set("COMPLAINTS", { ...policies.get("COMPLAINTS")!, opensInterventionOnBreach: false });
    expect(decideBreachActions({ band: "BREACHED", basis: "FIRST_REPLY", deadlineQueue: "COMPLAINTS", queues: ["COMPLAINTS"], policies: quiet }).intervention).toBeNull();
  });

  it("a channel-window breach is as serious as the most serious in-scope queue the customer is in, and says what is at stake", () => {
    const inScope = breach(["NEEDS_REPLY", "PAYMENT_DISCUSSIONS"], null, "CHANNEL_WINDOW");
    expect(inScope.intervention?.headline).toBe("This customer's messaging window is about to close");
    expect(inScope.intervention?.guidance).toMatch(/approved template/);
    expect(breach(["NEEDS_REPLY"], null, "CHANNEL_WINDOW").intervention).toBeNull();
    expect(breach(["NEEDS_REPLY"], null, "CHANNEL_WINDOW").recordSignal).toBe(true);
  });

  it("does nothing before a breach, and asks for the signal to be superseded once the conversation is back within its deadline", () => {
    for (const band of ["NONE", "NEARING"] as const) {
      expect(decideBreachActions({ band, basis: "FIRST_REPLY", deadlineQueue: "COMPLAINTS", queues: ["COMPLAINTS"], policies })).toEqual({ recordSignal: false, supersedeSignal: true, intervention: null });
    }
  });
});
