import type { Entitlements, PlanFeatures } from "@/lib/billing/entitlements";
import type { AutonomyLevel } from "@/lib/inbox/intelligence/contracts";

export type InboxFeature = "OFFER_MATCHING" | "IDENTITY_RESOLUTION" | "SLA" | "MEDIA_INTELLIGENCE" | "OWNER_PANEL" | "ANSWER_CACHE" | "AUDIT_EXPORT";
export type InboxSurfaceName = "INBOX_REPLY" | "INBOX_INTAKE" | "INBOX_TRIAGE" | "INBOX_RISK" | "INBOX_RISK_MODEL";
export type InboxSurfaceState = { enabled: boolean; mode: "OFF" | "SHADOW" | "PROPOSE" | "ACTIVE"; autonomy?: Record<string, unknown> };

export interface InboxFeatureAvailability {
  queues: boolean;
  offerMatching: boolean;
  identityResolution: boolean;
  sla: boolean;
  mediaIntelligence: boolean;
  ownerPanel: "NONE" | "READ_ONLY" | "FULL";
  answerCache: boolean;
  auditExport: boolean;
  autonomyCeiling: AutonomyLevel;
  surfaces: Partial<Record<InboxSurfaceName, InboxSurfaceState>>;
}

function enabled(features: PlanFeatures, key: string, legacyEntitlement: boolean): boolean {
  return legacyEntitlement || features.all === true || features[key] === true;
}

function ownerPanel(features: PlanFeatures): InboxFeatureAvailability["ownerPanel"] {
  if (features.all === true || features.owner_panel === true) return "FULL";
  return features.owner_panel === "read_only" ? "READ_ONLY" : "NONE";
}

/**
 * FIX9's only product-rollout decision. Product features come from the cached
 * plan entitlement; model/autonomy settings stay in `ai_surface_settings`.
 * Human messaging and deterministic payment-risk protection are intentionally
 * absent: they are baseline Inbox behaviour, never billable feature switches.
 */
export function resolveInboxFeatureAvailability(input: {
  entitlements: Entitlements | null;
  inboxQueuesV2: boolean;
  surfaces?: Partial<Record<InboxSurfaceName, InboxSurfaceState>>;
}): InboxFeatureAvailability {
  const features = input.entitlements?.features ?? {};
  // Migration-safe compatibility for callers still constructing the pre-FIX9
  // entitlement shape. Real database reads always populate `features`.
  const legacyEntitlement = input.entitlements !== null && input.entitlements?.features === undefined;
  return {
    queues: input.inboxQueuesV2,
    offerMatching: enabled(features, "offer_matching", legacyEntitlement),
    identityResolution: enabled(features, "identity_resolution", legacyEntitlement),
    sla: enabled(features, "sla", legacyEntitlement),
    mediaIntelligence: enabled(features, "media_intelligence", legacyEntitlement),
    ownerPanel: ownerPanel(features),
    answerCache: enabled(features, "answer_cache", legacyEntitlement),
    auditExport: enabled(features, "audit_export", legacyEntitlement),
    autonomyCeiling: input.entitlements?.autonomyCeiling ?? "L0",
    surfaces: input.surfaces ?? {},
  };
}

export function inboxFeatureIsAvailable(availability: InboxFeatureAvailability, feature: InboxFeature): boolean {
  if (feature === "OWNER_PANEL") return availability.ownerPanel !== "NONE";
  return {
    OFFER_MATCHING: availability.offerMatching,
    IDENTITY_RESOLUTION: availability.identityResolution,
    SLA: availability.sla,
    MEDIA_INTELLIGENCE: availability.mediaIntelligence,
    ANSWER_CACHE: availability.answerCache,
    AUDIT_EXPORT: availability.auditExport,
  }[feature];
}
