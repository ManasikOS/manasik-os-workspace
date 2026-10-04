/**
 * The sweep — Phase 1 (P1.7). Cheap, run every hour or so via the cron
 * route: finds every agency with Finance Ops actually turned on, checks
 * whether today's 06:00-agency-time review has already happened, and only
 * then builds a pack and calls the model.
 *
 * KNOWN LIMITATION, flagged rather than silently shipped: this sweep uses
 * the service-role admin client so it can iterate every agency, but the
 * finance repository loaders it calls to build `FinancePeriodPack`
 * (`loadFinanceReceivables`, `loadFinancePayments`, etc.) rely on RLS
 * (`current_agency_id()`) to scope themselves — they take no `agencyId`
 * parameter, because every existing call site uses a session-scoped
 * client where that's correct. Under the admin client they are unscoped.
 * This is safe today only because this deployment backfills every tenant
 * table to "the one seeded agency" (see 20260824090000_tenancy.sql's own
 * language) — there is exactly one agency in practice. Before a second
 * agency ever exists, those loaders need an explicit `agencyId` filter
 * (or the admin-client call here needs to move to per-agency
 * session-scoped clients) — tracked here, not discovered later.
 */

import "server-only";

import {
  loadFinanceInvoices,
  loadFinancePayments,
  loadFinanceReceivables,
  loadFinanceSupplierPayables,
  loadRefundRequests,
  type Db,
} from "@/lib/data/finance-repository";
import { listGroupProfitability } from "@/lib/data/profitability-repository";
import { capabilitiesForFinance } from "@/lib/access/finance-access";
import { buildFinancePeriodPack } from "@/lib/ai/surfaces/finance/pack";
import { hashObject } from "@/lib/agent/kernel/hash";

import { executeFinanceOpsTurn, type FinanceOpsMode, type FinanceOpsRunResult } from "./run";
import { dayKeyInTimezone, isCadenceDue, isPackUnchanged } from "./guardrails";

const SURFACE = "FINANCE_OPS";
const FULL_FINANCE_CAPABILITIES = capabilitiesForFinance("ADMIN");

export type AgencySweepOutcome =
  | { agencyId: string; outcome: "SKIPPED"; reason: string }
  | { agencyId: string; outcome: "NOOP" }
  | { agencyId: string; outcome: "RAN"; result: FinanceOpsRunResult };

interface AiSurfaceSettingsRow {
  agency_id: string;
  enabled: boolean;
  mode: FinanceOpsMode | "OFF";
}

interface AgencySettingsRow {
  agency_id: string;
  agency_name: string;
  timezone: string;
}

export async function sweepFinanceOpsAgencies(db: Db): Promise<AgencySweepOutcome[]> {
  const { data: settingsRows, error: settingsError } = await db
    .from("ai_surface_settings")
    .select("agency_id, enabled, mode")
    .eq("surface", SURFACE)
    .eq("enabled", true)
    .neq("mode", "OFF");
  if (settingsError) throw new Error(`Failed to list FINANCE_OPS surface settings: ${settingsError.message}`);

  const enabledAgencies = (settingsRows ?? []) as AiSurfaceSettingsRow[];
  if (enabledAgencies.length === 0) return [];

  const agencyIds = enabledAgencies.map((r) => r.agency_id);
  const { data: agencySettingsRows, error: agencyError } = await db
    .from("agency_settings")
    .select("agency_id, agency_name, timezone")
    .in("agency_id", agencyIds);
  if (agencyError) throw new Error(`Failed to load agency_settings for FINANCE_OPS sweep: ${agencyError.message}`);
  const agencySettingsById = new Map(
    ((agencySettingsRows ?? []) as AgencySettingsRow[]).map((r) => [r.agency_id, r]),
  );

  const results: AgencySweepOutcome[] = [];
  for (const settings of enabledAgencies) {
    results.push(await sweepOneAgency(db, settings, agencySettingsById.get(settings.agency_id)));
  }
  return results;
}

async function sweepOneAgency(
  db: Db,
  settings: AiSurfaceSettingsRow,
  agencySettings: AgencySettingsRow | undefined,
): Promise<AgencySweepOutcome> {
  const agencyId = settings.agency_id;
  if (!agencySettings) {
    return { agencyId, outcome: "SKIPPED", reason: "no agency_settings row" };
  }

  const nowIso = new Date().toISOString();

  const { data: lastRunRow } = await db
    .from("ai_runs")
    .select("created_at, pack_fingerprint")
    .eq("agency_id", agencyId)
    .eq("surface", SURFACE)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const last = lastRunRow as { created_at: string; pack_fingerprint: string | null } | null;
  const lastRunDayKey = last ? dayKeyInTimezone(last.created_at, agencySettings.timezone) : null;

  if (!isCadenceDue(nowIso, agencySettings.timezone, lastRunDayKey)) {
    return { agencyId, outcome: "SKIPPED", reason: "not due yet today" };
  }

  const [receivables, payments, invoices, supplierPayables, refundRequests, groupProfitability] = await Promise.all([
    loadFinanceReceivables(db, FULL_FINANCE_CAPABILITIES),
    loadFinancePayments(db),
    loadFinanceInvoices(db),
    loadFinanceSupplierPayables(db, FULL_FINANCE_CAPABILITIES),
    loadRefundRequests(db),
    listGroupProfitability(db),
  ]);

  const pack = buildFinancePeriodPack(agencyId, {
    receivables,
    payments,
    invoices,
    supplierPayables,
    refundRequests,
    groupProfitability,
    nowIso,
  });

  const fingerprint = hashObject(pack.metrics);
  if (isPackUnchanged(fingerprint, last?.pack_fingerprint ?? null)) {
    return { agencyId, outcome: "NOOP" };
  }

  const result = await executeFinanceOpsTurn(
    { agencyId, db },
    {
      pack,
      agencyName: agencySettings.agency_name || "the agency",
      agencyTimezone: agencySettings.timezone,
      mode: settings.mode === "OFF" ? "SHADOW" : settings.mode,
    },
  );

  return { agencyId, outcome: "RAN", result };
}
