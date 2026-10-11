import type { StaffRole } from "@/lib/access/departure-groups-access";

/**
 * Role-based access for the Packages module.
 *
 * Same posture as `lib/access/departure-groups-access.ts`: pure functions over
 * a role string, usable from both Server and Client Components. Capabilities
 * decide what is *fetched*, not merely what is rendered — `getPackageDetail`
 * nulls `finance_estimate` for roles without `viewInternalFinance`, the same
 * way the departure-groups repository nulls supplier costs.
 *
 * `editPricing` was removed (see
 * docs/modules/packages-production-readiness-plan.md, finding D3) — it existed as a
 * capability and was toggleable in the Roles & Permissions editor, but
 * nothing in the application ever checked it; Step 2 (pricing policy) has
 * always been gated by `editPackage` instead. A capability nobody checks
 * is worse than no capability at all — it tells an admin configuring a
 * custom role that this is a real, separately grantable permission, when
 * granting or denying it changed nothing. Existing `role_permissions` rows
 * that still carry an `editPricing` key are harmless — it is simply
 * ignored now, the same as any other unknown key would be.
 */

export interface PackageCapabilities {
  viewModule: boolean;
  createPackage: boolean;
  editPackage: boolean;
  publishPackage: boolean;
  duplicatePackage: boolean;
  archiveOrRestorePackage: boolean;
  /** Hard delete. Only ever offered when the package has zero departure groups. */
  deletePackage: boolean;
  toggleFeatured: boolean;
  /** Internal cost/margin figures (`finance_estimate`). */
  viewInternalFinance: boolean;
  exportCatalogue: boolean;
  createGroupFromPackage: boolean;
  /**
   * May change the payment, contract and booking terms of a package that is already on sale (the Tier 1 and Tier 2 fields in
   * `lib/access/package-field-tiers.ts`). `editPackage` alone covers drafts and display-only fields. Whether such a change also needs a
   * second person's approval is an agency setting (Settings → Operations).
   */
  editSensitiveTerms: boolean;
  /** May approve or reject another person's sensitive change request. Never lets anyone approve their own. */
  approvePackageChanges: boolean;
}

const NONE: PackageCapabilities = {
  viewModule: false,
  createPackage: false,
  editPackage: false,
  publishPackage: false,
  duplicatePackage: false,
  archiveOrRestorePackage: false,
  deletePackage: false,
  toggleFeatured: false,
  viewInternalFinance: false,
  exportCatalogue: false,
  createGroupFromPackage: false,
  editSensitiveTerms: false,
  approvePackageChanges: false,
};

const CAPABILITIES: Record<StaffRole, PackageCapabilities> = {
  ADMIN: {
    ...NONE,
    viewModule: true,
    createPackage: true,
    editPackage: true,
    publishPackage: true,
    duplicatePackage: true,
    archiveOrRestorePackage: true,
    deletePackage: true,
    toggleFeatured: true,
    viewInternalFinance: true,
    exportCatalogue: true,
    createGroupFromPackage: true,
    editSensitiveTerms: true,
    approvePackageChanges: true,
  },
  // Full visibility including margins, no editing — the same posture as CEO in
  // the Departure Groups module.
  CEO: {
    ...NONE,
    viewModule: true,
    viewInternalFinance: true,
    exportCatalogue: true,
  },
  OPERATIONS: {
    ...NONE,
    viewModule: true,
    createPackage: true,
    editPackage: true,
    publishPackage: true,
    duplicatePackage: true,
    archiveOrRestorePackage: true,
    toggleFeatured: true,
    exportCatalogue: true,
    createGroupFromPackage: true,
    // Operations can change live terms, but only an administrator approves them.
    editSensitiveTerms: true,
  },
  FINANCE: {
    ...NONE,
    viewModule: true,
    viewInternalFinance: true,
    exportCatalogue: true,
  },
  // Sells the catalogue; can spin up a draft from an existing package but
  // cannot touch pricing, publish, or see margins.
  MARKETING: {
    ...NONE,
    viewModule: true,
    duplicatePackage: true,
    toggleFeatured: true,
  },
  VISA: {
    ...NONE,
    viewModule: true,
    exportCatalogue: true,
  },
  // Guides never see the commercial catalogue.
  GUIDE: { ...NONE },
};

export function capabilitiesForPackages(role: StaffRole): PackageCapabilities {
  return CAPABILITIES[role];
}

/** Marketing only ever works packages that are actually sellable, or its own drafts. */
export function canRoleViewPackage(
  status: string,
  role: StaffRole,
  ownerId: string | null,
  currentUserId: string | null,
): boolean {
  if (role === "MARKETING") {
    return status === "Open for Sale" || (ownerId !== null && ownerId === currentUserId);
  }
  return true;
}
