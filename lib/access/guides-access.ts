/**
 * Role-based access for the Guides & Field Team module — Phase 0 (P0.3)
 * registration; real page lands in Phase 2 (P2.6) of
 * docs/modules/manasik-intelligence-build-roadmap.md. Placeholder capability set —
 * see `lib/access/module-defaults.ts`.
 */

import { buildPlaceholderCapabilities } from "@/lib/access/module-defaults";
import type { StaffRole } from "@/lib/access/departure-groups-access";

export interface GuidesCapabilities {
  viewModule: boolean;
  manageRoster: boolean;
  assignGuides: boolean;
  viewGuideWorkload: boolean;
  viewAssignedManifest: boolean;
  submitCheckin: boolean;
  recordHandover: boolean;
  viewPilgrimContacts: boolean;
  viewMedicalFlags: boolean;
}

const CAPABILITIES: Record<StaffRole, GuidesCapabilities> = buildPlaceholderCapabilities<GuidesCapabilities>([
  "viewModule",
  "manageRoster",
  "assignGuides",
  "viewGuideWorkload",
  "viewAssignedManifest",
  "submitCheckin",
  "recordHandover",
  "viewPilgrimContacts",
  "viewMedicalFlags",
]);

export function capabilitiesForGuides(role: StaffRole): GuidesCapabilities {
  return CAPABILITIES[role];
}
