import type { StaffRole } from "@/lib/access/departure-groups-access";

/**
 * Role-based access for the Marketing module (Campaigns, campaign-level
 * Audience use, campaign content/assets).
 *
 * Same posture as `lib/access/leads-access.ts` / `lib/access/departure-groups-access.ts`:
 * pure functions over a role string, usable from Server and Client Components.
 *
 * Campaigns previously borrowed `capabilitiesForLeads(role).manageSourcesAndAutomation`
 * — this module replaces that borrow with a dedicated capability set, per
 * `docs/architecture/remaining-modules-master-plan.md` §6 (`marketing` module) and
 * `docs/modules/campaigns-command-center-implementation-plan.md` §4. Audience
 * creation/editing itself stays owned by wherever Audiences already lives —
 * `useAudienceForBroadcast` here only governs *linking* a saved Audience to a
 * campaign, not building one.
 */

export interface MarketingCapabilities {
  viewModule: boolean;
  /** Create/edit a campaign's goal, offer, dates, targets. */
  manageCampaigns: boolean;
  /** Change a campaign's status (activate/pause/complete/archive). */
  manageCampaignStatus: boolean;
  /** Log campaign spend entries. */
  editSpend: boolean;
  /** Link a saved Audience to a campaign. */
  useAudienceForBroadcast: boolean;
  /** Create/edit campaign_assets (content/tracking-link/QR registry). */
  manageContent: boolean;
  /** See campaign_touchpoints / the AI Analysis tab. */
  viewAttribution: boolean;
  /** Act on / dismiss / resolve a CAMPAIGN insight. */
  actOnDiagnosis: boolean;
}

const NONE: MarketingCapabilities = {
  viewModule: false,
  manageCampaigns: false,
  manageCampaignStatus: false,
  editSpend: false,
  useAudienceForBroadcast: false,
  manageContent: false,
  viewAttribution: false,
  actOnDiagnosis: false,
};

const CAPABILITIES: Record<StaffRole, MarketingCapabilities> = {
  ADMIN: {
    viewModule: true,
    manageCampaigns: true,
    manageCampaignStatus: true,
    editSpend: true,
    useAudienceForBroadcast: true,
    manageContent: true,
    viewAttribution: true,
    actOnDiagnosis: true,
  },
  // Read-only overview: sees campaigns, spend, attribution, diagnosis; no editing.
  CEO: {
    ...NONE,
    viewModule: true,
    viewAttribution: true,
  },
  MARKETING: {
    viewModule: true,
    manageCampaigns: true,
    manageCampaignStatus: true,
    editSpend: true,
    useAudienceForBroadcast: true,
    manageContent: true,
    viewAttribution: true,
    actOnDiagnosis: true,
  },
  // Sees campaign outcomes for finance reporting; no campaign editing.
  FINANCE: {
    ...NONE,
    viewModule: true,
    viewAttribution: true,
  },
  // Needs to see capacity-linked campaigns (a campaign promoting their departure), read-only.
  OPERATIONS: {
    ...NONE,
    viewModule: true,
  },
  VISA: { ...NONE },
  GUIDE: { ...NONE },
};

export function capabilitiesForMarketing(role: StaffRole): MarketingCapabilities {
  return CAPABILITIES[role];
}
