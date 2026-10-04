/**
 * Role-based access for the Relationships module (Pilgrim Portal config,
 * Announcements, Feedback & Complaints, Loyalty) — Phase 0 (P0.3)
 * registration; real pages land across Phase 4 (P4.4, P4.6, P4.7, P4.8) of
 * docs/modules/manasik-intelligence-build-roadmap.md. Placeholder capability set —
 * see `lib/access/module-defaults.ts`.
 */

import { buildPlaceholderCapabilities } from "@/lib/access/module-defaults";
import type { StaffRole } from "@/lib/access/departure-groups-access";

export interface RelationshipsCapabilities {
  viewModule: boolean;
  configurePortal: boolean;
  managePortalAccess: boolean;
  draftAnnouncement: boolean;
  approveAnnouncement: boolean;
  sendAnnouncement: boolean;
  manageSurveys: boolean;
  viewResponses: boolean;
  manageLoyalty: boolean;
  awardCredit: boolean;
}

const CAPABILITIES: Record<StaffRole, RelationshipsCapabilities> = buildPlaceholderCapabilities<RelationshipsCapabilities>([
  "viewModule",
  "configurePortal",
  "managePortalAccess",
  "draftAnnouncement",
  "approveAnnouncement",
  "sendAnnouncement",
  "manageSurveys",
  "viewResponses",
  "manageLoyalty",
  "awardCredit",
]);

export function capabilitiesForRelationships(role: StaffRole): RelationshipsCapabilities {
  return CAPABILITIES[role];
}
