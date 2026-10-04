/**
 * Role-based access for the AI Insights module — Phase 0 (P0.3)
 * registration; real sub-pages land in Phase 5 (P5.2) of
 * docs/modules/manasik-intelligence-build-roadmap.md. Placeholder capability set —
 * see `lib/access/module-defaults.ts`. `manageAiSurfaces` in particular
 * gates the `ai_surface_settings` editor and the write side of `insights`'
 * RLS (`can_act_on_insight`) — restricted to ADMIN/CEO by the shared
 * placeholder builder, which is deliberate here (not just a placeholder
 * default) since it is the one capability in this module with a real
 * security consequence today, even before the settings UI exists.
 */

import { buildPlaceholderCapabilities } from "@/lib/access/module-defaults";
import type { StaffRole } from "@/lib/access/departure-groups-access";

export interface InsightsCapabilities {
  viewModule: boolean;
  viewInsight: boolean;
  dismissInsight: boolean;
  actOnInsight: boolean;
  manageAiSettings: boolean;
  viewAiActionHistory: boolean;
  viewShadowResults: boolean;
  manageAiSurfaces: boolean;
  reviewAiFeedback: boolean;
  runGenerators: boolean;
  approveInboxAnswer: boolean;
}

const CAPABILITIES: Record<StaffRole, InsightsCapabilities> = buildPlaceholderCapabilities<InsightsCapabilities>([
  "viewModule",
  "viewInsight",
  "dismissInsight",
  "actOnInsight",
  "manageAiSettings",
  "viewAiActionHistory",
  "viewShadowResults",
  "manageAiSurfaces",
  "reviewAiFeedback",
  "runGenerators",
  "approveInboxAnswer",
]);

export function capabilitiesForInsights(role: StaffRole): InsightsCapabilities {
  return CAPABILITIES[role];
}
