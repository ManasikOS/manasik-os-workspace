import {
  ROLE_LABELS,
  STAFF_ROLES,
  capabilitiesFor as capabilitiesForDepartureGroups,
  type StaffRole,
} from "@/lib/access/departure-groups-access";
import { capabilitiesForDocuments } from "@/lib/access/documents-access";
import { capabilitiesForFinance } from "@/lib/access/finance-access";
import { capabilitiesForLeads } from "@/lib/access/leads-access";
import { capabilitiesForOperations } from "@/lib/access/operations-access";
import { capabilitiesForPackages } from "@/lib/access/packages-access";
import { capabilitiesForPilgrims } from "@/lib/access/pilgrims-access";
import { capabilitiesForReports } from "@/lib/access/reports-access";
import { capabilitiesForSettings } from "@/lib/access/settings-access";
import { capabilitiesForSuppliers } from "@/lib/access/suppliers-access";
import { capabilitiesForVisa } from "@/lib/access/visa-access";

/**
 * Role-based access for the Team module.
 *
 * Same posture as every other `*-access.ts` file: pure functions over a role
 * string, usable from Server and Client Components. Unlike the others, this
 * module also *reads* the other nine capability files — `describeRoleAccess()`
 * renders the spec's "Can access / Cannot access" panel directly from the
 * enforcement code, so the panel can never say something the app does not
 * actually do.
 */

export interface TeamCapabilities {
  /** Admin, CEO. Marketing/Operations/Visa/Finance/Guide land on their own profile only. */
  viewModule: boolean;
  viewFullDirectory: boolean;
  inviteStaff: boolean;
  editProfile: boolean;
  changeRole: boolean;
  deactivateStaff: boolean;
  /** Group ownership is operational, not administrative — Operations runs this today via free text. */
  assignGroups: boolean;
  viewWorkload: boolean;
  viewSecurityTab: boolean;
  manageSessionsAndPasswords: boolean;
  exportTeamList: boolean;
  exportAccessAudit: boolean;
  viewOwnProfileOnly: boolean;
}

const NONE: TeamCapabilities = {
  viewModule: false,
  viewFullDirectory: false,
  inviteStaff: false,
  editProfile: false,
  changeRole: false,
  deactivateStaff: false,
  assignGroups: false,
  viewWorkload: false,
  viewSecurityTab: false,
  manageSessionsAndPasswords: false,
  exportTeamList: false,
  exportAccessAudit: false,
  viewOwnProfileOnly: true,
};

const CAPABILITIES: Record<StaffRole, TeamCapabilities> = {
  ADMIN: {
    ...NONE,
    viewModule: true,
    viewFullDirectory: true,
    inviteStaff: true,
    editProfile: true,
    changeRole: true,
    deactivateStaff: true,
    assignGroups: true,
    viewWorkload: true,
    viewSecurityTab: true,
    manageSessionsAndPasswords: true,
    exportTeamList: true,
    exportAccessAudit: true,
    viewOwnProfileOnly: false,
  },
  // Business visibility, read-only. Sees everyone, changes no one.
  CEO: {
    ...NONE,
    viewModule: true,
    viewFullDirectory: true,
    viewWorkload: true,
    exportTeamList: true,
    viewOwnProfileOnly: false,
  },
  // Runs group ownership day to day — the same person who assigns guides
  // today via the (free-text) assign-guide dialog.
  OPERATIONS: {
    ...NONE,
    assignGroups: true,
    viewWorkload: true,
  },
  FINANCE: { ...NONE },
  MARKETING: { ...NONE },
  VISA: { ...NONE },
  GUIDE: { ...NONE },
};

export function capabilitiesForTeam(role: StaffRole): TeamCapabilities {
  return CAPABILITIES[role];
}

export const TEAM_TAB_IDS = [
  "overview",
  "access",
  "groups",
  "tasks",
  "activity",
] as const;

export type TeamTabId = (typeof TEAM_TAB_IDS)[number];

/**
 * Everyone sees Overview, Access (read-only unless Admin) and their own
 * Assigned Groups. Tasks & Workload and Activity & Security are either an
 * Admin/CEO/Operations lens on a colleague, or the signed-in person's own
 * tabs on their own profile — never a colleague's task list or security
 * panel for anyone else.
 */
export function visibleTabsForTeamMember(role: StaffRole, isSelf: boolean): TeamTabId[] {
  const can = capabilitiesForTeam(role);
  const tabs: TeamTabId[] = ["overview", "access", "groups"];

  if (can.viewWorkload || isSelf) tabs.push("tasks");
  if (can.viewSecurityTab || isSelf) tabs.push("activity");

  return tabs;
}

/* ── Role access summary — renders §"Access & permissions" from the real gates ── */

export interface RoleAccessSummary {
  role: StaffRole;
  label: string;
  canAccess: string[];
  cannotAccess: string[];
}

/**
 * Walks every module's capability matrix for one role and turns it into the
 * spec's two-column ✓ / ✕ list. Deliberately coarse — module-level, not
 * every individual boolean — so the panel reads like the mock rather than a
 * dump of internal flags.
 */
export function describeRoleAccess(role: StaffRole): RoleAccessSummary {
  const canAccess: string[] = [];
  const cannotAccess: string[] = [];

  const push = (label: string, granted: boolean) => (granted ? canAccess : cannotAccess).push(label);

  const groups = capabilitiesForDepartureGroups(role);
  push("Departure Groups", groups.viewModule);
  push("Supplier costs & margin on Departure Groups", groups.viewSupplierCosts);
  push("Passport / visa data on Departure Groups", groups.viewSensitiveTravellerData);
  push("Departure Group finance & payments", groups.viewFinance);

  const operations = capabilitiesForOperations(role);
  push("Operations control centre", operations.viewModule);

  const suppliers = capabilitiesForSuppliers(role);
  push("Suppliers", suppliers.viewModule);
  push("Supplier costs & payment terms", suppliers.viewCosts);

  const leads = capabilitiesForLeads(role);
  push("Leads", leads.viewModule);

  const pilgrims = capabilitiesForPilgrims(role);
  push("Pilgrims", pilgrims.viewModule);

  const packages = capabilitiesForPackages(role);
  push("Packages", packages.viewModule);

  const documents = capabilitiesForDocuments(role);
  push("Documents", documents.viewModule);

  const visa = capabilitiesForVisa(role);
  push("Visa", visa.viewModule);

  const finance = capabilitiesForFinance(role);
  push("Full finance ledger", finance.viewModule);

  const reports = capabilitiesForReports(role);
  push("Reports", reports.viewModule);

  const team = capabilitiesForTeam(role);
  push("Team administration", team.viewFullDirectory);

  const settings = capabilitiesForSettings(role);
  push("Agency settings", settings.viewModule);

  return {
    role,
    label: ROLE_LABELS[role],
    canAccess,
    cannotAccess,
  };
}

export { STAFF_ROLES, ROLE_LABELS };
export type { StaffRole };
