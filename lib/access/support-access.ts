/**
 * Role-based access for the Support & Incidents module — Phase 0 (P0.3)
 * registration; real page lands in Phase 2 (P2.1) of
 * docs/modules/manasik-intelligence-build-roadmap.md. Placeholder capability set —
 * see `lib/access/module-defaults.ts`.
 */

import { buildPlaceholderCapabilities } from "@/lib/access/module-defaults";
import type { StaffRole } from "@/lib/access/departure-groups-access";

export interface SupportCapabilities {
  viewModule: boolean;
  createCase: boolean;
  assignCase: boolean;
  escalate: boolean;
  resolveCase: boolean;
  closeCase: boolean;
  viewMedicalDetail: boolean;
  viewComplaints: boolean;
  runPostTripReview: boolean;
}

const CAPABILITIES: Record<StaffRole, SupportCapabilities> = buildPlaceholderCapabilities<SupportCapabilities>([
  "viewModule",
  "createCase",
  "assignCase",
  "escalate",
  "resolveCase",
  "closeCase",
  "viewMedicalDetail",
  "viewComplaints",
  "runPostTripReview",
]);

export function capabilitiesForSupport(role: StaffRole): SupportCapabilities {
  return CAPABILITIES[role];
}
