import { SETUP_STEP_IDS, type SetupStepId } from "./setup-steps";
import type { SetupConnectorKey } from "./connector-copy";

/**
 * Funnel events for the guided setup (docs/onboarding/plan.md Slice 6). Closed
 * vocabularies only: an event names a step or a connector and nothing else, so
 * no personal data or provider text can ever be recorded.
 */

export const ONBOARDING_EVENT_TYPES = [
  "STEP_VIEWED",
  "STEP_COMPLETED",
  "STEP_SKIPPED",
  "CONNECTOR_STARTED",
  "CONNECTOR_SUCCEEDED",
  "CONNECTOR_FAILED",
] as const;
export type OnboardingEventType = (typeof ONBOARDING_EVENT_TYPES)[number];

export const ONBOARDING_CONNECTORS: readonly SetupConnectorKey[] = ["whatsapp", "messenger", "instagram", "email", "meta_ads", "google_ads"];

export interface OnboardingEventInput {
  agencyId: string;
  event: OnboardingEventType;
  step?: SetupStepId;
  connector?: SetupConnectorKey;
}

export interface OnboardingEventRow {
  agency_id: string;
  event: OnboardingEventType;
  step: SetupStepId | null;
  connector: SetupConnectorKey | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The database row for an event, or null when the input is not a well-formed event. */
export function buildOnboardingEventRow(input: OnboardingEventInput): OnboardingEventRow | null {
  if (!UUID_PATTERN.test(input.agencyId)) return null;

  if (input.event.startsWith("STEP_")) {
    if (!input.step || !(SETUP_STEP_IDS as readonly string[]).includes(input.step)) return null;
    return { agency_id: input.agencyId, event: input.event, step: input.step, connector: null };
  }

  if (!input.connector || !ONBOARDING_CONNECTORS.includes(input.connector)) return null;
  return { agency_id: input.agencyId, event: input.event, step: null, connector: input.connector };
}

export interface OnboardingFunnelSummary {
  steps: Record<SetupStepId, { viewed: number; completed: number; skipped: number }>;
  connectors: Record<string, { started: number; succeeded: number; failed: number }>;
}

/** Counts distinct agencies per step/connector and outcome, so refreshing a page never inflates the funnel. */
export function summariseOnboardingFunnel(rows: OnboardingEventRow[]): OnboardingFunnelSummary {
  const seen = new Set<string>();
  const steps = Object.fromEntries(SETUP_STEP_IDS.map((id) => [id, { viewed: 0, completed: 0, skipped: 0 }])) as OnboardingFunnelSummary["steps"];
  const connectors = Object.fromEntries(ONBOARDING_CONNECTORS.map((id) => [id, { started: 0, succeeded: 0, failed: 0 }])) as OnboardingFunnelSummary["connectors"];

  for (const row of rows) {
    const key = `${row.agency_id}|${row.event}|${row.step ?? row.connector}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (row.step && steps[row.step]) {
      if (row.event === "STEP_VIEWED") steps[row.step].viewed += 1;
      else if (row.event === "STEP_COMPLETED") steps[row.step].completed += 1;
      else if (row.event === "STEP_SKIPPED") steps[row.step].skipped += 1;
    } else if (row.connector && connectors[row.connector]) {
      if (row.event === "CONNECTOR_STARTED") connectors[row.connector].started += 1;
      else if (row.event === "CONNECTOR_SUCCEEDED") connectors[row.connector].succeeded += 1;
      else if (row.event === "CONNECTOR_FAILED") connectors[row.connector].failed += 1;
    }
  }

  return { steps, connectors };
}
