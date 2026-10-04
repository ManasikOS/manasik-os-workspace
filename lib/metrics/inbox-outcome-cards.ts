/**
 * Turns the computed Inbox outcome values (OUT-02) into the cards a person sees. The role filter is applied here, on the server,
 * before anything is sent to the browser, so a card a role may not see never reaches that role's page. Every state is explicit:
 * a number, "no data yet", "not measurable yet" (with the reason), or "could not be read". Cards carry no message content.
 */

import type { StaffRole } from "@/lib/access/departure-groups-access";
import {
  inboxOutcomeMetricsVisibleTo,
  type OutcomeAudience,
  type OutcomeMetricContract,
  type OutcomeMetricFamily,
  type OutcomeMetricValue,
} from "@/lib/metrics/inbox-outcomes";
import { viewForQueue, type InboxView } from "@/lib/inbox/views";

export type InboxOutcomeCardState = "VALUE" | "NO_DATA" | "NOT_MEASURABLE" | "UNAVAILABLE";

export interface InboxOutcomeCard {
  key: string;
  family: OutcomeMetricFamily;
  audience: OutcomeAudience;
  label: string;
  definition: string;
  state: InboxOutcomeCardState;
  /** Ready to show: "12", "3 min", "$0.42", "18%". Null unless state is VALUE. */
  displayValue: string | null;
  /** Plain-language explanation for every state except VALUE (and a note when a value is partial). */
  note: string | null;
  partial: boolean;
  unit: OutcomeMetricContract["unit"];
  basis: string;
  /** The Inbox view whose rows are exactly what the count counts. Null when no screen shows them yet. */
  drillDownView: InboxView | null;
  drillDownLabel: string | null;
}

export const OUTCOME_FAMILY_LABELS: Record<OutcomeMetricFamily, string> = {
  OPERATIONAL: "Daily work",
  COMMERCIAL: "Sales",
  SAFETY: "Safety",
  AI_QUALITY_COST: "AI cost and quality",
};

const FAMILY_ORDER: readonly OutcomeMetricFamily[] = ["OPERATIONAL", "COMMERCIAL", "SAFETY", "AI_QUALITY_COST"];

export function formatOutcomeValue(unit: OutcomeMetricContract["unit"], value: number): string {
  switch (unit) {
    case "COUNT":
      return String(Math.round(value));
    case "RATIO":
      return `${Math.round(value * 1000) / 10}%`;
    case "USD":
      return `$${value.toFixed(value < 1 ? 4 : 2)}`;
    case "SECONDS": {
      if (value < 90) return `${Math.round(value)} sec`;
      if (value < 5400) return `${Math.round(value / 60)} min`;
      return `${Math.round((value / 3600) * 10) / 10} hr`;
    }
  }
}

function basisText(metric: OutcomeMetricContract): string {
  return metric.valueBasis === "NOW_SNAPSHOT" ? "Right now" : `Last ${metric.windowDays ?? 30} days`;
}

function drillDownFor(metric: OutcomeMetricContract): { view: InboxView | null; label: string | null } {
  if (metric.drillDown.kind !== "QUEUE") return { view: null, label: null };
  const view = viewForQueue(metric.drillDown.queue);
  return view ? { view, label: "Open these conversations" } : { view: null, label: null };
}

function cardFor(metric: OutcomeMetricContract, value: OutcomeMetricValue | undefined, sourceUnreadable: boolean): InboxOutcomeCard {
  const drill = drillDownFor(metric);
  const base = {
    key: metric.key,
    family: metric.family,
    audience: metric.audience,
    label: metric.label,
    definition: metric.definition,
    unit: metric.unit,
    basis: basisText(metric),
    partial: false,
    drillDownView: drill.view,
    drillDownLabel: drill.label,
  };

  if (metric.status === "BLOCKED") {
    return { ...base, state: "NOT_MEASURABLE", displayValue: null, note: metric.blockedBy ?? "This cannot be measured yet." };
  }
  if (!value || (value.status === "NO_DATA" && sourceUnreadable)) {
    return { ...base, state: "UNAVAILABLE", displayValue: null, note: "This could not be read just now. Try again in a moment." };
  }
  if (value.status === "BLOCKED") {
    return { ...base, state: "NOT_MEASURABLE", displayValue: null, note: value.reason ?? "This cannot be measured yet." };
  }
  if (value.status === "NO_DATA" || value.value === null) {
    return { ...base, state: "NO_DATA", displayValue: null, note: value.reason ?? "There is nothing to measure in this period yet." };
  }
  return {
    ...base,
    state: "VALUE",
    displayValue: formatOutcomeValue(metric.unit, value.value),
    partial: value.partial,
    note: value.partial ? "Based on part of this period, because there was too much to read at once." : null,
  };
}

/**
 * The cards a role may see, grouped in a stable order. `unreadableMetricKeys` marks metrics whose source could not be read, so
 * they show "could not be read" rather than a calm "no data".
 */
export function buildInboxOutcomeCards(input: {
  role: StaffRole;
  values: Record<string, OutcomeMetricValue>;
  unreadableMetricKeys?: ReadonlySet<string>;
}): InboxOutcomeCard[] {
  const unreadable = input.unreadableMetricKeys ?? new Set<string>();
  const visible = inboxOutcomeMetricsVisibleTo(input.role);
  return [...visible]
    .sort((a, b) => FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family))
    .map((metric) => cardFor(metric, input.values[metric.key], unreadable.has(metric.key)));
}

/** Which metrics read from a table that failed to load. */
export function metricKeysReadingFrom(tables: readonly string[], metrics: readonly OutcomeMetricContract[]): Set<string> {
  const failed = new Set(tables);
  return new Set(metrics.filter((metric) => metric.status === "MEASURABLE" && metric.sources.some((source) => failed.has(source.table))).map((metric) => metric.key));
}
