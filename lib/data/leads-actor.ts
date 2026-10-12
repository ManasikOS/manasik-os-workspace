import "server-only";

import { cookies } from "next/headers";

import { capabilitiesForLeads, type LeadCapabilities } from "@/lib/access/leads-access";
import { loadDynamicCapabilities } from "@/lib/access/dynamic-capabilities";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import { getCurrentStaffRole } from "@/lib/data/departure-groups";
import { createClient } from "@/utils/supabase/server";

export interface LeadActor {
  role: StaffRole;
  name: string;
  staffId: string | null;
  can: LeadCapabilities;
}

/**
 * The signed-in person and what they may do in Leads.
 *
 * Capabilities are the base role's built-in set with any custom-role overrides saved in `role_permissions` merged over it — the resolution
 * Departure Groups and the other modules already use. Reading `capabilitiesForLeads(role)` directly meant a custom role whose `convertToBooking`
 * or `sendQuote` had been switched off in Settings still had it here. Call `requireUser()` first; this does not authenticate.
 */
export async function getLeadActor(): Promise<LeadActor> {
  const { role, roleId, name, staffId } = await getCurrentStaffRole();
  const fallback = capabilitiesForLeads(role);
  const can = roleId ? await loadDynamicCapabilities(createClient(await cookies()), roleId, "leads", fallback) : fallback;
  return { role, name: name ?? "Staff", staffId: staffId ?? null, can };
}
