/**
 * `FinancePeriodPack` — Phase 1 (P1.1) of
 * docs/modules/manasik-intelligence-build-roadmap.md; Plan §3.3/§4.12. The
 * deterministic, evidence-linked read model every Finance Intelligence
 * workflow reads — built once from the metrics registry
 * (`lib/metrics/registry.ts`), never a second computation of a number the
 * registry already derives.
 */

import { FINANCE_METRICS, type FinanceMetricsInput } from "@/lib/metrics/registry";

export interface FinancePeriodPackMetric {
  label: string;
  definition: string;
  available: boolean;
  byCurrency: Record<string, number>;
  count?: number;
  drillDownHref: string;
}

export interface FinancePeriodPack {
  agencyId: string;
  generatedAt: string;
  nowIso: string;
  metrics: Record<string, FinancePeriodPackMetric>;
}

export function buildFinancePeriodPack(agencyId: string, input: FinanceMetricsInput): FinancePeriodPack {
  const metrics: Record<string, FinancePeriodPackMetric> = {};
  for (const metric of FINANCE_METRICS) {
    const result = metric.compute(input);
    metrics[metric.key] = {
      label: metric.label,
      definition: metric.definition,
      available: result.available,
      byCurrency: result.byCurrency,
      count: result.count,
      drillDownHref: metric.drillDownHref,
    };
  }
  return { agencyId, generatedAt: new Date().toISOString(), nowIso: input.nowIso, metrics };
}
