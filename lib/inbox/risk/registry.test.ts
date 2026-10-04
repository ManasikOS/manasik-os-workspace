import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { RULE_ONLY_SIGNAL_CODES } from "@/lib/inbox/intelligence/contracts";

import { customerMessage, facts, MESSAGE_ID } from "./fixtures";
import { RISK_DETECTORS } from "./registry";
import { findingsToSignals, runRiskDetectors } from "./run";

describe("the registry", () => {
  it("names exactly the eleven rule-only detectors, once each", () => {
    const codes = RISK_DETECTORS.map((detector) => detector.code);
    expect([...codes].sort()).toEqual([...RULE_ONLY_SIGNAL_CODES].sort());
    expect(new Set(codes).size).toBe(11);
  });

  it("every detector is a pure function of the facts: running twice gives the same answer", () => {
    const input = facts({ latest: customerMessage("I have paid LKR 250,000 to account 8001234567 and my booking X-BK099"), claimedReferences: [{ reference: "X-BK099", exists: false }] });
    for (const detector of RISK_DETECTORS) expect(detector.detect(input), detector.code).toEqual(detector.detect(input));
  });

  it("no detector file imports the database or a model", () => {
    const dir = join(process.cwd(), "lib/inbox/risk/detectors");
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, file).not.toMatch(/supabase|generateStructured|@\/lib\/ai\/provider|server-only/);
    }
  });
});

describe("runRiskDetectors", () => {
  it("collects every finding in one pass", () => {
    const run = runRiskDetectors(facts({ latest: customerMessage("I have paid LKR 250,000"), intentConfidence: 0.3 }));
    expect(run.findings.map((finding) => finding.code).sort()).toEqual(["LOW_CONFIDENCE_DRAFT", "PAYMENT_CLAIM_UNVERIFIED"]);
    expect(run.failed).toEqual([]);
  });

  it("a detector that throws is reported and skipped: it never hides another", () => {
    const boom = { code: "STALE_PRICE_QUOTED" as const, detect: vi.fn(() => { throw new Error("bad rule"); }) };
    const ok = { code: "LOW_CONFIDENCE_DRAFT" as const, detect: () => ({ code: "LOW_CONFIDENCE_DRAFT" as const, messageId: null, confidence: 1, evidence: [] }) };
    const run = runRiskDetectors(facts(), [boom, ok]);
    expect(run.findings).toHaveLength(1);
    expect(run.failed).toEqual([{ code: "STALE_PRICE_QUOTED", message: "bad rule" }]);
  });

  it("turns findings into RULE signals that point at the message that caused them", () => {
    const signals = findingsToSignals(runRiskDetectors(facts({ latest: customerMessage("I have paid") })).findings);
    expect(signals).toEqual([{ signalCode: "PAYMENT_CLAIM_UNVERIFIED", messageId: MESSAGE_ID, detector: "RULE", confidence: 0.9, evidence: [{ messageId: MESSAGE_ID, snippet: "I have paid" }] }]);
  });

  it("runs no model: nothing in the run path is asynchronous", () => {
    expect(runRiskDetectors(facts())).not.toBeInstanceOf(Promise);
  });
});

describe("the migration", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261202091600_mi4_1_approved_payment_accounts.sql"), "utf8");
  it("locks the approved list to Admin and Finance and seeds the surface OFF", () => {
    expect(sql).toContain("staff_role_in('ADMIN', 'FINANCE')");
    expect(sql).toContain("'INBOX_RISK', false, 'SHADOW'");
    expect(sql).toContain("offer_snapshot_max_age_minutes integer not null default 60");
  });
});
