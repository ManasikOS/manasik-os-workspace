/**
 * Capability resolution for the proposal kernel — Phase 0 (P0.2). Replaces
 * `approveProposal()`'s hard-coded `capabilitiesFor(ctx.role)` (departure
 * groups only) with a lookup keyed by `executor.module`, so a proposal on
 * any module resolves the *right* module's capabilities, merged with any
 * dynamic per-role override the same way every page in this app already
 * does via `lib/access/dynamic-capabilities.ts`.
 *
 * The fallback map only needs an entry for a module once that module
 * actually has a proposal kind registered — a module absent from
 * `FALLBACK_BY_MODULE` simply can never approve a proposal, which is a
 * loud, obvious failure at registry-load time (see `registry.ts`'s
 * capability-key assertion), not a silent one here.
 */

import "server-only";

import { capabilitiesFor as capabilitiesForDepartureGroups, type StaffRole } from "@/lib/access/departure-groups-access";
import { capabilitiesForDocuments } from "@/lib/access/documents-access";
import { capabilitiesForFinance } from "@/lib/access/finance-access";
import { capabilitiesForInbox } from "@/lib/access/inbox-access";
import { capabilitiesForLeads } from "@/lib/access/leads-access";
import { capabilitiesForMarketing } from "@/lib/access/marketing-access";
import { capabilitiesForOperations } from "@/lib/access/operations-access";
import { capabilitiesForPackages } from "@/lib/access/packages-access";
import { capabilitiesForPilgrims } from "@/lib/access/pilgrims-access";
import { capabilitiesForReports } from "@/lib/access/reports-access";
import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { capabilitiesForSuppliers } from "@/lib/access/suppliers-access";
import { capabilitiesForTeam } from "@/lib/access/team-access";
import { capabilitiesForVisa } from "@/lib/access/visa-access";
import { capabilitiesForAiAgent } from "@/lib/access/ai-agent-access";
import { capabilitiesForBookings } from "@/lib/access/bookings-access";
import { capabilitiesForQuotes } from "@/lib/access/quotes-access";
import { capabilitiesForFieldOps } from "@/lib/access/field-ops-access";
import { capabilitiesForGuides } from "@/lib/access/guides-access";
import { capabilitiesForSupport } from "@/lib/access/support-access";
import { capabilitiesForRelationships } from "@/lib/access/relationships-access";
import { capabilitiesForAgents } from "@/lib/access/agents-access";
import { capabilitiesForAnalytics } from "@/lib/access/analytics-access";
import { capabilitiesForInsights } from "@/lib/access/insights-access";
import { loadDynamicCapabilities } from "@/lib/access/dynamic-capabilities";
import type { Db, PermissionModule } from "@/lib/data/role-permissions-repository";

type CapabilityFallback = (role: StaffRole) => Record<string, boolean>;

/**
 * One entry per module that can currently own a proposal kind. Extend this
 * — never a second resolution path — as later phases add native v2
 * executors for bookings, quotes, refunds, etc. (each of those modules'
 * `lib/access/<module>-access.ts` is added in P0.3/Phase 1+, at which
 * point it gets an entry here too).
 */
const FALLBACK_BY_MODULE: Partial<Record<PermissionModule, CapabilityFallback>> = {
  departure_groups: capabilitiesForDepartureGroups as unknown as CapabilityFallback,
  documents: capabilitiesForDocuments as unknown as CapabilityFallback,
  finance: capabilitiesForFinance as unknown as CapabilityFallback,
  inbox: capabilitiesForInbox as unknown as CapabilityFallback,
  leads: capabilitiesForLeads as unknown as CapabilityFallback,
  marketing: capabilitiesForMarketing as unknown as CapabilityFallback,
  operations: capabilitiesForOperations as unknown as CapabilityFallback,
  packages: capabilitiesForPackages as unknown as CapabilityFallback,
  pilgrims: capabilitiesForPilgrims as unknown as CapabilityFallback,
  reports: capabilitiesForReports as unknown as CapabilityFallback,
  settings: capabilitiesForSettings as unknown as CapabilityFallback,
  suppliers: capabilitiesForSuppliers as unknown as CapabilityFallback,
  team: capabilitiesForTeam as unknown as CapabilityFallback,
  visa: capabilitiesForVisa as unknown as CapabilityFallback,
  ai_agent: capabilitiesForAiAgent as unknown as CapabilityFallback,
  bookings: capabilitiesForBookings as unknown as CapabilityFallback,
  quotes: capabilitiesForQuotes as unknown as CapabilityFallback,
  field_ops: capabilitiesForFieldOps as unknown as CapabilityFallback,
  guides: capabilitiesForGuides as unknown as CapabilityFallback,
  support: capabilitiesForSupport as unknown as CapabilityFallback,
  relationships: capabilitiesForRelationships as unknown as CapabilityFallback,
  agents: capabilitiesForAgents as unknown as CapabilityFallback,
  analytics: capabilitiesForAnalytics as unknown as CapabilityFallback,
  insights: capabilitiesForInsights as unknown as CapabilityFallback,
};

/**
 * Resolves whether `role` (optionally overridden by `roleId`'s stored
 * `role_permissions` row) holds `capabilityKey` on `module`. Unknown module
 * -> `false` (never silently permissive — an unregistered module means no
 * proposal kind should have been created against it in the first place;
 * see the registry's load-time assertion).
 */
export async function resolveCapability(
  role: StaffRole,
  roleId: string | null,
  module: string,
  capabilityKey: string,
  db: Db,
): Promise<boolean> {
  const fallbackFn = FALLBACK_BY_MODULE[module as PermissionModule];
  if (!fallbackFn) return false;

  const fallback = fallbackFn(role);
  const resolved = await loadDynamicCapabilities(db, roleId, module as PermissionModule, fallback);
  return resolved[capabilityKey] === true;
}

/** Whether `module` has a registered capability-fallback at all — used by the registry's load-time assertion. */
export function isKnownProposalModule(module: string): boolean {
  return module in FALLBACK_BY_MODULE;
}
