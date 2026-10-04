import type { AutonomyLevel } from "@/lib/inbox/intelligence/contracts";

const LEVEL_RANK: Record<AutonomyLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };
const MODE_LEVEL = { OFF: "L0", SHADOW: "L0", PROPOSE: "L1", ACTIVE: "L3" } as const;
const AUTONOMY_LEVELS = Object.keys(LEVEL_RANK) as AutonomyLevel[];

export type AutonomySurfaceMode = keyof typeof MODE_LEVEL;
export type EffectiveAutonomyAuthority =
  | "AGENCY_SETTING"
  | "POLICY_INPUT"
  | "SURFACE_SETTING"
  | "SURFACE_MODE"
  | "PLAN_ENTITLEMENT"
  | "CHANNEL_AVAILABILITY"
  | "HUMAN_OWNERSHIP"
  | "PROMOTION_EVIDENCE"
  | "CHANNEL_POLICY"
  | "PROTECTION_GATE";

export type EffectiveAutonomyReasonCode =
  | "SETTING_MISSING"
  | "POLICY_FACTS_MALFORMED"
  | "SURFACE_DISABLED"
  | "SURFACE_MODE_LIMIT"
  | "PLAN_CEILING_LIMIT"
  | "CHANNEL_UNAVAILABLE"
  | "HUMAN_OWNERSHIP_ACTIVE"
  | "EVIDENCE_LIMIT"
  | "CHANNEL_POLICY_BLOCKED"
  | "PROTECTION_GATE_BLOCKED";

export interface EffectiveAutonomyPolicyInput {
  setting: {
    enabled: unknown;
    mode: unknown;
    requestedLevel: unknown;
  } | null | undefined;
  entitlementCeiling: unknown;
  channelAvailable: unknown;
  conversationHumanActive: unknown;
  evidenceCeiling: unknown;
  channelPolicyEligible: unknown;
  protectionGateAllowed: unknown;
}

export interface EffectiveAutonomyPolicy {
  requestedLevel: AutonomyLevel | null;
  entitlementCeiling: AutonomyLevel | null;
  channelAvailable: boolean | null;
  surfaceMode: AutonomySurfaceMode | null;
  conversationHumanActive: boolean | null;
  evidenceCeiling: AutonomyLevel | null;
  channelPolicyEligible: boolean | null;
  protectionGateAllowed: boolean | null;
  level: AutonomyLevel;
  limitingAuthority: EffectiveAutonomyAuthority;
  reasonCodes: EffectiveAutonomyReasonCode[];
  reasons: string[];
}

interface AutonomyClamp {
  level: AutonomyLevel;
  authority: EffectiveAutonomyAuthority;
  code: EffectiveAutonomyReasonCode;
  reason: string;
}

function isAutonomyLevel(value: unknown): value is AutonomyLevel {
  return typeof value === "string" && AUTONOMY_LEVELS.includes(value as AutonomyLevel);
}

function isSurfaceMode(value: unknown): value is AutonomySurfaceMode {
  return typeof value === "string" && Object.hasOwn(MODE_LEVEL, value);
}

function failClosedPolicy(
  input: EffectiveAutonomyPolicyInput,
  code: "SETTING_MISSING" | "POLICY_FACTS_MALFORMED",
  reason: string,
): EffectiveAutonomyPolicy {
  return {
    requestedLevel: isAutonomyLevel(input.setting?.requestedLevel) ? input.setting.requestedLevel : null,
    entitlementCeiling: isAutonomyLevel(input.entitlementCeiling) ? input.entitlementCeiling : null,
    channelAvailable: typeof input.channelAvailable === "boolean" ? input.channelAvailable : null,
    surfaceMode: isSurfaceMode(input.setting?.mode) ? input.setting.mode : null,
    conversationHumanActive: typeof input.conversationHumanActive === "boolean" ? input.conversationHumanActive : null,
    evidenceCeiling: isAutonomyLevel(input.evidenceCeiling) ? input.evidenceCeiling : null,
    channelPolicyEligible: typeof input.channelPolicyEligible === "boolean" ? input.channelPolicyEligible : null,
    protectionGateAllowed: typeof input.protectionGateAllowed === "boolean" ? input.protectionGateAllowed : null,
    level: "L0",
    limitingAuthority: "POLICY_INPUT",
    reasonCodes: [code],
    reasons: [reason],
  };
}

export function lowerAutonomyLevel(left: AutonomyLevel, right: AutonomyLevel): AutonomyLevel {
  return LEVEL_RANK[left] <= LEVEL_RANK[right] ? left : right;
}

/**
 * Resolves raw autonomy facts into one fail-closed policy contract. Runtime
 * callers move to this contract in AUT-03 after AUT-02 guarantees that every
 * agency has an explicit canonical setting.
 */
export function resolveEffectiveAutonomyPolicy(input: EffectiveAutonomyPolicyInput): EffectiveAutonomyPolicy {
  if (input.setting === null || input.setting === undefined) {
    return failClosedPolicy(input, "SETTING_MISSING", "The Inbox autonomy setting is missing, so autonomy is limited to L0.");
  }

  const settingEnabled = input.setting.enabled;
  const surfaceMode = input.setting.mode;
  const requestedLevel = input.setting.requestedLevel;
  const entitlementCeiling = input.entitlementCeiling;
  const channelAvailable = input.channelAvailable;
  const conversationHumanActive = input.conversationHumanActive;
  const evidenceCeiling = input.evidenceCeiling;
  const channelPolicyEligible = input.channelPolicyEligible;
  const protectionGateAllowed = input.protectionGateAllowed;
  if (
    typeof settingEnabled !== "boolean"
    || !isSurfaceMode(surfaceMode)
    || !isAutonomyLevel(requestedLevel)
    || !isAutonomyLevel(entitlementCeiling)
    || typeof channelAvailable !== "boolean"
    || typeof conversationHumanActive !== "boolean"
    || !isAutonomyLevel(evidenceCeiling)
    || typeof channelPolicyEligible !== "boolean"
    || typeof protectionGateAllowed !== "boolean"
  ) {
    return failClosedPolicy(input, "POLICY_FACTS_MALFORMED", "Inbox autonomy policy facts are malformed, so autonomy is limited to L0.");
  }

  const clamps: AutonomyClamp[] = [];

  if (!settingEnabled && requestedLevel !== "L0") {
    clamps.push({
      level: "L0",
      authority: "SURFACE_SETTING",
      code: "SURFACE_DISABLED",
      reason: "The Inbox autonomy surface is disabled.",
    });
  }
  if (LEVEL_RANK[MODE_LEVEL[surfaceMode]] < LEVEL_RANK[requestedLevel]) {
    clamps.push({
      level: MODE_LEVEL[surfaceMode],
      authority: "SURFACE_MODE",
      code: "SURFACE_MODE_LIMIT",
      reason: `The ${surfaceMode} surface mode limits Inbox autonomy to ${MODE_LEVEL[surfaceMode]}.`,
    });
  }
  if (LEVEL_RANK[entitlementCeiling] < LEVEL_RANK[requestedLevel]) {
    clamps.push({
      level: entitlementCeiling,
      authority: "PLAN_ENTITLEMENT",
      code: "PLAN_CEILING_LIMIT",
      reason: `The agency plan limits Inbox autonomy to ${entitlementCeiling}.`,
    });
  }
  if (!channelAvailable && requestedLevel !== "L0") {
    clamps.push({
      level: "L0",
      authority: "CHANNEL_AVAILABILITY",
      code: "CHANNEL_UNAVAILABLE",
      reason: "The conversation channel is unavailable for autonomous handling.",
    });
  }
  if (conversationHumanActive && requestedLevel !== "L0") {
    clamps.push({
      level: "L0",
      authority: "HUMAN_OWNERSHIP",
      code: "HUMAN_OWNERSHIP_ACTIVE",
      reason: "A staff member is actively handling this conversation.",
    });
  }
  if (LEVEL_RANK[evidenceCeiling] < LEVEL_RANK[requestedLevel]) {
    clamps.push({
      level: evidenceCeiling,
      authority: "PROMOTION_EVIDENCE",
      code: "EVIDENCE_LIMIT",
      reason: `Promotion and demotion evidence limits Inbox autonomy to ${evidenceCeiling}.`,
    });
  }
  if (!channelPolicyEligible && requestedLevel !== "L0") {
    clamps.push({
      level: "L0",
      authority: "CHANNEL_POLICY",
      code: "CHANNEL_POLICY_BLOCKED",
      reason: "Channel policy does not allow an autonomous reply.",
    });
  }
  if (!protectionGateAllowed && requestedLevel !== "L0") {
    clamps.push({
      level: "L0",
      authority: "PROTECTION_GATE",
      code: "PROTECTION_GATE_BLOCKED",
      reason: "The protection gate requires human review.",
    });
  }

  let level = requestedLevel;
  for (const clamp of clamps) level = lowerAutonomyLevel(level, clamp.level);
  const limitingClamp = clamps.find((clamp) => clamp.level === level);

  return {
    requestedLevel,
    entitlementCeiling,
    channelAvailable,
    surfaceMode,
    conversationHumanActive,
    evidenceCeiling,
    channelPolicyEligible,
    protectionGateAllowed,
    level,
    limitingAuthority: limitingClamp?.authority ?? "AGENCY_SETTING",
    reasonCodes: clamps.map((clamp) => clamp.code),
    reasons: clamps.map((clamp) => clamp.reason),
  };
}

export function resolveEffectiveAutonomy(input: { entitlementCeiling: AutonomyLevel; surfaceMode: keyof typeof MODE_LEVEL; configuredLevel: AutonomyLevel; conversationHumanActive: boolean }): AutonomyLevel {
  if (input.conversationHumanActive) return "L0";
  return lowerAutonomyLevel(input.entitlementCeiling, lowerAutonomyLevel(MODE_LEVEL[input.surfaceMode], input.configuredLevel));
}

/**
 * May the older WhatsApp assistant switch authorise an ordinary generated reply? It stays the authority only while the agency
 * has never chosen anything for the Inbox reply surface: the default row is disabled at L0, and refusing every reply from an
 * agency that never opted in would silence an assistant it switched on long ago. Once anyone has set the Inbox reply level (even
 * to L0, which is stored as "disabled"), that choice is the single policy and the older switch no longer overrides it.
 */
export function legacyAssistantMayAuthorise(input: {
  inboxReplySurfaceEnabled: boolean;
  source: string;
  legacyAssistantActive: boolean;
  inboxReplyEverConfigured: boolean;
}): boolean {
  return !input.inboxReplySurfaceEnabled && input.source === "GENERATED" && input.legacyAssistantActive && !input.inboxReplyEverConfigured;
}
