/**
 * The signed-in person's Dashboard capabilities: their base role's built-in
 * set for each module the Dashboard gates on, with any custom-role overrides
 * saved in `role_permissions` merged over it — the same resolution every
 * other module uses (see `lib/access/dynamic-capabilities.ts` and
 * `getLeadActor()` in `lib/data/leads-actor.ts`).
 *
 * Reading `capabilitiesFor*(role)` directly meant a custom role restricted
 * from, say, the finance ledger still got the Dashboard's finance panels
 * whenever its base role had them.
 */

import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";

import { baseDashboardCapabilities, type DashboardCapabilities } from "@/lib/access/dashboard-access";
import { loadDynamicCapabilities } from "@/lib/access/dynamic-capabilities";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import type { Db } from "@/lib/data/role-permissions-repository";
import { createClient } from "@/utils/supabase/server";

/**
 * Pure of request context so it can be tested with a stand-in `db`. With no
 * `roleId` (a built-in role) nothing is read. A module whose row cannot be
 * read is denied for this request by `loadDynamicCapabilities`, without
 * affecting the others.
 */
export async function resolveDashboardCapabilities(
  db: Db,
  role: StaffRole,
  roleId: string | null,
): Promise<DashboardCapabilities> {
  const base = baseDashboardCapabilities(role);
  if (!roleId) return base;

  const [finance, leads, operations, reports, departureGroups, inbox, visa, documents, suppliers, quotes] = await Promise.all([
    loadDynamicCapabilities(db, roleId, "finance", base.finance),
    loadDynamicCapabilities(db, roleId, "leads", base.leads),
    loadDynamicCapabilities(db, roleId, "operations", base.operations),
    loadDynamicCapabilities(db, roleId, "reports", base.reports),
    loadDynamicCapabilities(db, roleId, "departure_groups", base.departureGroups),
    loadDynamicCapabilities(db, roleId, "inbox", base.inbox),
    loadDynamicCapabilities(db, roleId, "visa", base.visa),
    loadDynamicCapabilities(db, roleId, "documents", base.documents),
    loadDynamicCapabilities(db, roleId, "suppliers", base.suppliers),
    loadDynamicCapabilities(db, roleId, "quotes", base.quotes),
  ]);

  return { finance, leads, operations, reports, departureGroups, inbox, visa, documents, suppliers, quotes };
}

/** One resolution per request (React `cache`). Call `requireUser()`/the page's auth first; this does not authenticate. */
export const getCurrentDashboardCapabilities = cache(async (): Promise<DashboardCapabilities> => {
  const { role, roleId } = await getCurrentStaffRole();
  return resolveDashboardCapabilities(createClient(await cookies()), role, roleId);
});
