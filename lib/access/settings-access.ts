import type { StaffRole } from "@/lib/access/departure-groups-access";

/**
 * Role-based access for the Settings module.
 *
 * Same posture as every other `*-access.ts` file: pure functions over a role
 * string, usable from Server and Client Components. Settings is Admin's
 * screen — every other role sees at most one section, and several roles see
 * none at all and are redirected to their own Team profile instead (see
 * `app/(main)/management/settings/page.tsx`).
 *
 * Margin visibility is deliberately not a capability here: `editFinance`
 * lets a role change *whether the margin-visibility switch for another role
 * is on*, but the switch can only ever narrow `capabilitiesForFinance` /
 * `capabilitiesForSuppliers` `viewCosts`, never widen it — see
 * `lib/data/settings.ts#intersectMarginVisibleRoles()`.
 */

export interface SettingsCapabilities {
  viewModule: boolean;

  viewOrganisation: boolean;
  editOrganisation: boolean;

  viewBranches: boolean;
  editBranches: boolean;

  viewBranding: boolean;
  editBranding: boolean;

  viewOperations: boolean;
  editOperations: boolean;

  viewCommunications: boolean;
  editCommunications: boolean;
  /** Marketing / Visa: only templates whose `assigned_roles` include their role. */
  communicationsScopedToOwnRole: boolean;

  viewFinance: boolean;
  editFinance: boolean;

  viewIntegrations: boolean;
  editIntegrations: boolean;

  viewSecurity: boolean;
  editSecurity: boolean;

  viewAuditLog: boolean;
  editData: boolean;
  exportData: boolean;
  importData: boolean;

  viewDangerZone: boolean;
}

const NONE: SettingsCapabilities = {
  viewModule: false,
  viewOrganisation: false,
  editOrganisation: false,
  viewBranches: false,
  editBranches: false,
  viewBranding: false,
  editBranding: false,
  viewOperations: false,
  editOperations: false,
  viewCommunications: false,
  editCommunications: false,
  communicationsScopedToOwnRole: false,
  viewFinance: false,
  editFinance: false,
  viewIntegrations: false,
  editIntegrations: false,
  viewSecurity: false,
  editSecurity: false,
  viewAuditLog: false,
  editData: false,
  exportData: false,
  importData: false,
  viewDangerZone: false,
};

const CAPABILITIES: Record<StaffRole, SettingsCapabilities> = {
  ADMIN: {
    ...NONE,
    viewModule: true,
    viewOrganisation: true,
    editOrganisation: true,
    viewBranches: true,
    editBranches: true,
    viewBranding: true,
    editBranding: true,
    viewOperations: true,
    editOperations: true,
    viewCommunications: true,
    editCommunications: true,
    viewFinance: true,
    editFinance: true,
    viewIntegrations: true,
    editIntegrations: true,
    viewSecurity: true,
    editSecurity: true,
    viewAuditLog: true,
    editData: true,
    exportData: true,
    importData: true,
    viewDangerZone: true,
  },
  // Business visibility into identity and branches, read-only. No security,
  // no finance edit, no danger zone — see the role table in the spec.
  CEO: {
    ...NONE,
    viewModule: true,
    viewOrganisation: true,
    viewBranches: true,
    viewBranding: true,
    viewAuditLog: true,
    exportData: true,
  },
  FINANCE: {
    ...NONE,
    viewModule: true,
    viewFinance: true,
    editFinance: true,
  },
  OPERATIONS: {
    ...NONE,
    viewModule: true,
    viewOperations: true,
    editOperations: true,
  },
  MARKETING: {
    ...NONE,
    viewModule: true,
    viewCommunications: true,
    editCommunications: true,
    communicationsScopedToOwnRole: true,
  },
  VISA: {
    ...NONE,
    viewModule: true,
    viewCommunications: true,
    editCommunications: true,
    communicationsScopedToOwnRole: true,
  },
  // Personal preferences only — no Settings section. Redirected to their own
  // Team profile, same as Team does for non-directory roles.
  GUIDE: { ...NONE },
};

export function capabilitiesForSettings(role: StaffRole): SettingsCapabilities {
  return CAPABILITIES[role];
}

export const SETTINGS_SECTION_IDS = [
  "organisation",
  "branches",
  "branding",
  "operations",
  "service-addons",
  "communications",
  "finance",
  "integrations",
  "email",
  "whatsapp-templates",
  "whatsapp-billing",
  "security",
  "data",
  "danger",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export const SETTINGS_SECTION_LABELS: Record<SettingsSectionId, string> = {
  organisation: "Organisation",
  branches: "Branches",
  branding: "Branding & Pilgrim Portal",
  operations: "Operational Defaults",
  "service-addons": "Service Add-ons",
  communications: "Communication Templates",
  finance: "Finance Defaults",
  integrations: "Integrations",
  email: "Email & SMTP",
  "whatsapp-templates": "WhatsApp Templates",
  "whatsapp-billing": "WhatsApp Billing",
  security: "Security & Access",
  data: "Data & Audit",
  danger: "Danger Zone",
};

const SECTION_VISIBILITY: Record<SettingsSectionId, (can: SettingsCapabilities) => boolean> = {
  organisation: (can) => can.viewOrganisation,
  branches: (can) => can.viewBranches,
  branding: (can) => can.viewBranding,
  operations: (can) => can.viewOperations,
  "service-addons": (can) => can.viewOperations,
  communications: (can) => can.viewCommunications,
  finance: (can) => can.viewFinance,
  integrations: (can) => can.viewIntegrations,
  email: (can) => can.viewIntegrations || can.viewCommunications,
  // Message templates need App Review evidence and outbound sends — same
  // audience as Integrations (§5 E8 of the connection plan).
  "whatsapp-templates": (can) => can.viewIntegrations,
  // Billing follows money-visibility posture, not integration-editing
  // posture — same audience as Finance Defaults (§5 E10, open question 7
  // of the connection plan: owner/admin + Finance, not Marketing/Operations).
  "whatsapp-billing": (can) => can.viewFinance,
  security: (can) => can.viewSecurity,
  data: (can) => can.viewAuditLog,
  danger: (can) => can.viewDangerZone,
};

/** Left-nav visibility, and the set of routes that don't 404 for this role. */
export function visibleSettingsSections(role: StaffRole): SettingsSectionId[] {
  const can = capabilitiesForSettings(role);
  return SETTINGS_SECTION_IDS.filter((id) => SECTION_VISIBILITY[id](can));
}

/** Where `/management/settings` redirects to, so no role lands on a denial by default. */
export function defaultSettingsSection(role: StaffRole): SettingsSectionId | null {
  return visibleSettingsSections(role)[0] ?? null;
}
