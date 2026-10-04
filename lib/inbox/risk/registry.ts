/**
 * The eleven rule-only S4 detectors — MI4.1 (Architecture §6 S4). The list is the contract: `RULE_ONLY_SIGNAL_CODES` in
 * `lib/inbox/intelligence/contracts.ts` and this registry must name the same codes (a test compares them), so a detector cannot
 * be added, or dropped, in one place only.
 */

import { bankDetailMismatch } from "./detectors/bank-detail-mismatch";
import { concurrentComposer } from "./detectors/concurrent-composer";
import { groupFullRequested } from "./detectors/group-full-requested";
import { lowConfidenceDraft } from "./detectors/low-confidence-draft";
import { minorOrAssistanceNeeded } from "./detectors/minor-or-assistance-needed";
import { passportExpiryRisk } from "./detectors/passport-expiry-risk";
import { paymentClaimUnverified } from "./detectors/payment-claim-unverified";
import { sensitiveDocReceived } from "./detectors/sensitive-doc-received";
import { stalePriceQuoted } from "./detectors/stale-price-quoted";
import { unrecordedBookingClaim } from "./detectors/unrecorded-booking-claim";
import { windowClosingSoon } from "./detectors/window-closing-soon";
import type { RiskDetector } from "./types";

export const RISK_DETECTORS: readonly RiskDetector[] = [
  paymentClaimUnverified,
  bankDetailMismatch,
  stalePriceQuoted,
  groupFullRequested,
  passportExpiryRisk,
  windowClosingSoon,
  concurrentComposer,
  lowConfidenceDraft,
  sensitiveDocReceived,
  minorOrAssistanceNeeded,
  unrecordedBookingClaim,
];
