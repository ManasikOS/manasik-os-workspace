/**
 * Role-based access for the Agent / Sub-Agent Portal module (internal
 * admin side) — Phase 0 (P0.3) registration; real page lands in Phase 4
 * (P4.9) of docs/modules/manasik-intelligence-build-roadmap.md. Placeholder
 * capability set — see `lib/access/module-defaults.ts`.
 */

import { buildPlaceholderCapabilities } from "@/lib/access/module-defaults";
import type { StaffRole } from "@/lib/access/departure-groups-access";

export interface AgentsCapabilities {
  viewModule: boolean;
  onboardAgent: boolean;
  setCreditLimit: boolean;
  allocatePackages: boolean;
  approveAgentBooking: boolean;
  viewAgentMargin: boolean;
  settleCommissions: boolean;
}

const CAPABILITIES: Record<StaffRole, AgentsCapabilities> = buildPlaceholderCapabilities<AgentsCapabilities>([
  "viewModule",
  "onboardAgent",
  "setCreditLimit",
  "allocatePackages",
  "approveAgentBooking",
  "viewAgentMargin",
  "settleCommissions",
]);

export function capabilitiesForAgents(role: StaffRole): AgentsCapabilities {
  return CAPABILITIES[role];
}
