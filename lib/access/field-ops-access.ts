/**
 * Role-based access for the Field Operations module (Flights, Hotels,
 * Rooming, Transport, Itinerary) — Phase 0 (P0.3) registration; real pages
 * land across Phase 2 (P2.2–P2.5) of
 * docs/modules/manasik-intelligence-build-roadmap.md. Placeholder capability set —
 * see `lib/access/module-defaults.ts`.
 */

import { buildPlaceholderCapabilities } from "@/lib/access/module-defaults";
import type { StaffRole } from "@/lib/access/departure-groups-access";

export interface FieldOpsCapabilities {
  viewModule: boolean;
  manageFlights: boolean;
  issueTickets: boolean;
  manageHotelContracts: boolean;
  manageRooming: boolean;
  unlockRoomAssignments: boolean;
  manageTransport: boolean;
  manageItinerary: boolean;
  publishItinerary: boolean;
  exportManifest: boolean;
  viewSupplierCosts: boolean;
  assignedGroupOnly: boolean;
}

const CAPABILITIES: Record<StaffRole, FieldOpsCapabilities> = buildPlaceholderCapabilities<FieldOpsCapabilities>([
  "viewModule",
  "manageFlights",
  "issueTickets",
  "manageHotelContracts",
  "manageRooming",
  "unlockRoomAssignments",
  "manageTransport",
  "manageItinerary",
  "publishItinerary",
  "exportManifest",
  "viewSupplierCosts",
  "assignedGroupOnly",
]);

export function capabilitiesForFieldOps(role: StaffRole): FieldOpsCapabilities {
  return CAPABILITIES[role];
}
