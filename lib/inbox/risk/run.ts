/**
 * Runs every S4 detector over one set of facts — MI4.1. Pure. A detector that throws is skipped and reported, never allowed to
 * stop the others: one bad rule must not hide a payment claim. Findings turn into `conversation_signals` inputs here; nothing is
 * written by this file. In this slice they are SHADOW signals only: no intervention is opened until MI4.2.
 */

import type { RecordSignalInput } from "@/lib/data/conversation-intelligence-repository";

import { RISK_DETECTORS } from "./registry";
import type { RiskDetector, RiskFacts, RiskFinding } from "./types";

export interface RiskRun {
  findings: RiskFinding[];
  /** Detectors that threw, by code, so the failure is visible without being fatal. */
  failed: Array<{ code: string; message: string }>;
}

export function runRiskDetectors(facts: RiskFacts, detectors: readonly RiskDetector[] = RISK_DETECTORS): RiskRun {
  const findings: RiskFinding[] = [];
  const failed: RiskRun["failed"] = [];
  for (const detector of detectors) {
    try {
      const finding = detector.detect(facts);
      if (finding) findings.push(finding);
    } catch (cause) {
      failed.push({ code: detector.code, message: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return { findings, failed };
}

export function findingsToSignals(findings: readonly RiskFinding[]): RecordSignalInput[] {
  return findings.map((finding) => ({ signalCode: finding.code, messageId: finding.messageId, detector: "RULE" as const, confidence: finding.confidence, evidence: finding.evidence }));
}
