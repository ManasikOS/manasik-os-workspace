/**
 * The golden set — 3 scenarios, a starter subset of the plan's ~25 (see
 * fixtures.ts's header for why that is disclosed as a scope trim, not
 * silently shipped). Each maps to a named example from §13 of
 * docs/modules/departure-operations-agent-implementation-plan.md.
 */

import { buildScenarioStore, daysFromNow } from "./fixtures";
import type { EvalCheck } from "./check";

const AGENCY_ID = "fixture-agency";

/** A group with nothing wrong — CONFIRMING tier, hotels confirmed, guide assigned, no refused visas. The negative-case check: no critical noise on a clean group. */
const healthyOnTrack: EvalCheck = {
  name: "healthy-on-track",
  build: () => {
    const { store, groupId } = buildScenarioStore({
      groupOverrides: { id: "grp-healthy", departure_date: daysFromNow(30) },
      travellerCount: 4,
      pilgrimOverrides: () => ({ visa_status: "UNDER_REVIEW" }), // in progress, not yet due — should not read as a blocker
      accommodationOverrides: {
        makkah: { id: "acc-healthy-makkah", status: "CONFIRMED", booking_reference: "MK-REF-1" },
        madinah: { id: "acc-healthy-madinah", status: "CONFIRMED", booking_reference: "MD-REF-1" },
      },
      flightOverrides: {
        outbound: { status: "HELD", pnr: "PNR123", ticketing_deadline: daysFromNow(20) },
      },
    });
    return { store, groupId, agencyId: AGENCY_ID };
  },
  expect: {
    blockerIdsAbsent: ["hotel-acc-healthy-makkah", "hotel-acc-healthy-madinah", "visa-refused", "guide-unassigned"],
    tier: "CONFIRMING",
  },
};

/** A refused visa and an unconfirmed Madinah hotel at T-10 — the plan's own two named CRITICAL examples, in one group. */
const criticalBlockers: EvalCheck = {
  name: "critical-blockers-refused-visa-unconfirmed-hotel",
  build: () => {
    const { store, groupId } = buildScenarioStore({
      groupOverrides: { id: "grp-critical", departure_date: daysFromNow(10) },
      travellerCount: 3,
      pilgrimOverrides: (i) => (i === 0 ? { visa_status: "REJECTED", visa_rejection_reason: "Name mismatch" } : { visa_status: "APPROVED" }),
      accommodationOverrides: {
        makkah: { id: "acc-critical-makkah", status: "CONFIRMED", booking_reference: "MK-REF-2" },
        madinah: { id: "acc-critical-madinah", status: "NOT_REQUESTED" }, // never even asked for — the T-10 unconfirmed hotel
      },
    });
    return { store, groupId, agencyId: AGENCY_ID };
  },
  expect: {
    blockerIdsPresent: ["visa-refused", "hotel-acc-critical-madinah"],
    blockerIdsAbsent: ["hotel-acc-critical-makkah"], // Makkah is confirmed — must not be flagged
    tier: "FINALISING",
  },
};

/** A PNR held with a ticketing deadline 3 days out — the flight readiness item must read AT_RISK, the one case deriveReadinessStatuses() treats as urgent short of BLOCKED. */
const urgentTicketing: EvalCheck = {
  name: "urgent-ticketing-deadline",
  build: () => {
    const { store, groupId } = buildScenarioStore({
      groupOverrides: { id: "grp-urgent", departure_date: daysFromNow(5) },
      travellerCount: 2,
      flightOverrides: {
        outbound: { status: "HELD", pnr: "PNR999", ticketing_deadline: daysFromNow(3) },
      },
    });
    return { store, groupId, agencyId: AGENCY_ID };
  },
  expect: {
    tier: "IMMINENT",
    readinessItemStatusBySource: { FLIGHT_TICKETED: "AT_RISK", FLIGHT_OUTBOUND_CONFIRMED: "IN_PROGRESS" },
  },
};

export const GOLDEN_SET: EvalCheck[] = [healthyOnTrack, criticalBlockers, urgentTicketing];
