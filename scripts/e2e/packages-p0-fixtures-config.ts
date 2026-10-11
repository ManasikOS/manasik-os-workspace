import { formDataToRow } from "@/app/(main)/packages/create-package/mappers";
import { INITIAL_PACKAGE_FORM_DATA, type PackageFormData } from "@/app/(main)/packages/create-package/types";

/**
 * Fixture plan for the Packages P0 run (docs/runbooks/packages-screen-p0-run-sheet.md, section 3).
 *
 * Everything here is data and pure functions, so the plan can be unit-tested without a database. The seeder
 * (seed-packages-p0-fixtures.ts) and the cleanup (cleanup-packages-p0-fixtures.ts) read it and are the only code that writes.
 */

export const packagesFixtureAgency = {
  /** The test plan names this agency `E2E-packages-20261008` (docs/runbooks/packages-screen-test-plan.md, section 2). */
  name: "E2E-packages-20261008",
  slug: "e2e-packages-20261008",
} as const;

/** The second agency for the isolation tests. It is the existing LR2 fixture agency B, so no new agency is invented. */
export const packagesFixtureOtherAgencySlug = "lr2-fixture-agency-b";

/** Every package the seeder creates starts with this; the test plan's rule 3 asks testers to use it too. */
export const PACKAGES_FIXTURE_CODE_PREFIX = "ZZTEST-";

/** Production project refs the seeder refuses to run against, whatever the environment variables say. */
export const KNOWN_PRODUCTION_PROJECT_REFS = ["bidmihfsljrurlnraqmf"] as const;

export type PackagesFixtureStaffKey = "ADMIN" | "OPERATIONS" | "MARKETING" | "FINANCE" | "CEO" | "VISA" | "GUIDE" | "OTHER_AGENCY_ADMIN";

export const packagesFixtureStaff: Record<PackagesFixtureStaffKey, { role: string; agency: "test" | "other"; fullName: string; emailEnv: string }> = {
  ADMIN: { role: "ADMIN", agency: "test", fullName: "Packages P0 Admin", emailEnv: "PACKAGES_E2E_ADMIN_EMAIL" },
  OPERATIONS: { role: "OPERATIONS", agency: "test", fullName: "Packages P0 Operations", emailEnv: "PACKAGES_E2E_OPERATIONS_EMAIL" },
  MARKETING: { role: "MARKETING", agency: "test", fullName: "Packages P0 Marketing", emailEnv: "PACKAGES_E2E_MARKETING_EMAIL" },
  FINANCE: { role: "FINANCE", agency: "test", fullName: "Packages P0 Finance", emailEnv: "PACKAGES_E2E_FINANCE_EMAIL" },
  CEO: { role: "CEO", agency: "test", fullName: "Packages P0 CEO", emailEnv: "PACKAGES_E2E_CEO_EMAIL" },
  VISA: { role: "VISA", agency: "test", fullName: "Packages P0 Visa", emailEnv: "PACKAGES_E2E_VISA_EMAIL" },
  GUIDE: { role: "GUIDE", agency: "test", fullName: "Packages P0 Guide", emailEnv: "PACKAGES_E2E_GUIDE_EMAIL" },
  OTHER_AGENCY_ADMIN: { role: "ADMIN", agency: "other", fullName: "Packages P0 Other Agency Admin", emailEnv: "PACKAGES_E2E_OTHER_AGENCY_ADMIN_EMAIL" },
};

export type PackagesFixtureStatus = "Draft" | "Open for Sale" | "Sales Closed" | "Archived";

export type PackagesFixtureGroup = {
  /** Always starts with ZZTEST-. */
  code: string;
  name: string;
  groupStatus: "PLANNING" | "PREPARING" | "READY_TO_DEPART" | "DEPARTED" | "COMPLETED" | "CLOSED" | "CANCELLED";
  salesStatus: "SELLING" | "LIMITED_AVAILABILITY" | "WAITLIST" | "SALES_CLOSED" | "CANCELLED";
  capacity: number;
  bookedSeats: number;
  archived: boolean;
  /** Days from the day the seeder runs. */
  departInDays: number;
};

export type PackagesFixturePlan = {
  id: string;
  /** The test plan's fixture id (P1...P13). */
  planId: string;
  code: string;
  title: string;
  status: PackagesFixtureStatus;
  owner: PackagesFixtureStaffKey;
  complete: boolean;
  /** Short note for people reading the dry run. */
  purpose: string;
  /** For the one fixture that has neither a code nor a title, so it can be found again. */
  marker?: string;
  featured?: boolean;
  journeyType?: PackagesFixtureStaffKeyJourney;
  packageCategory?: PackageFormData["package_category"];
  branch?: string;
  previousStatus?: PackagesFixtureStatus;
  groups?: PackagesFixtureGroup[];
  /** Only for the plan's "step 1 only" package. */
  stepOneOnly?: boolean;
  /** Clears code and title (and every other free-text field). */
  blank?: boolean;
};

type PackagesFixtureStaffKeyJourney = "Umrah" | "Hajj" | "Early Registration";

const LONG_TITLE = `ZZTEST P12 long title ${"x".repeat(200)}`.slice(0, 200);

export const packagesFixturePlans: PackagesFixturePlan[] = [
  { id: "P1", planId: "P1", code: "ZZTEST-001", title: "ZZTEST P1 Draft, complete", status: "Draft", owner: "OPERATIONS", complete: true, purpose: "publish from the menu, My Drafts" },
  { id: "P2", planId: "P2", code: "ZZTEST-002", title: "ZZTEST P2 Draft, step 1 only", status: "Draft", owner: "ADMIN", complete: false, stepOneOnly: true, purpose: "publish refusal, Needs Attention" },
  { id: "P3", planId: "P3", code: "", title: "", status: "Draft", owner: "ADMIN", complete: false, blank: true, marker: "ZZTEST fixture P3 (blank code and title)", purpose: "Untitled package fallback, publish refusal" },
  { id: "P4", planId: "P4", code: "ZZTEST-004", title: "ZZTEST P4 On sale, no groups", status: "Open for Sale", owner: "ADMIN", complete: true, purpose: "unpublish, archive, delete" },
  {
    id: "P5", planId: "P5", code: "ZZTEST-005", title: "ZZTEST P5 On sale, two live groups", status: "Open for Sale", owner: "ADMIN", complete: true,
    purpose: "KPIs, archive guard, delete blocked",
    groups: [
      { code: "ZZTEST-G-005A", name: "ZZTEST P5 group A", groupStatus: "PLANNING", salesStatus: "SELLING", capacity: 40, bookedSeats: 18, archived: false, departInDays: 60 },
      { code: "ZZTEST-G-005B", name: "ZZTEST P5 group B", groupStatus: "READY_TO_DEPART", salesStatus: "LIMITED_AVAILABILITY", capacity: 45, bookedSeats: 30, archived: false, departInDays: 90 },
    ],
  },
  { id: "P6", planId: "P6", code: "ZZTEST-006", title: "ZZTEST P6 Sales closed", status: "Sales Closed", owner: "ADMIN", complete: true, purpose: "reopen" },
  { id: "P7", planId: "P7", code: "ZZTEST-007", title: "ZZTEST P7 Archived", status: "Archived", previousStatus: "Open for Sale", owner: "ADMIN", complete: true, purpose: "archived sheet, restore target" },
  { id: "P8", planId: "P8", code: "ZZTEST-008", title: "ZZTEST P8 Hajj premium, featured", status: "Open for Sale", owner: "ADMIN", complete: true, featured: true, journeyType: "Hajj", packageCategory: "Premium", branch: "Kandy", purpose: "filters, featured view, duplicate" },
  { id: "P9", planId: "P9", code: "ZZTEST-009", title: "ZZTEST P9 Draft owned by Marketing", status: "Draft", owner: "MARKETING", complete: true, purpose: "marketing visibility" },
  { id: "P10", planId: "P10", code: "ZZTEST-010", title: "ZZTEST P10 Draft owned by Operations", status: "Draft", owner: "OPERATIONS", complete: true, purpose: "must be hidden from Marketing" },
  {
    id: "P11", planId: "P11", code: "ZZTEST-011", title: "ZZTEST P11 On sale, only cancelled and archived groups", status: "Open for Sale", owner: "ADMIN", complete: true,
    purpose: "delete blocked, archive allowed",
    groups: [
      { code: "ZZTEST-G-011A", name: "ZZTEST P11 cancelled group", groupStatus: "CANCELLED", salesStatus: "CANCELLED", capacity: 40, bookedSeats: 0, archived: false, departInDays: 45 },
      { code: "ZZTEST-G-011B", name: "ZZTEST P11 archived group", groupStatus: "CLOSED", salesStatus: "SALES_CLOSED", capacity: 40, bookedSeats: 12, archived: true, departInDays: -30 },
    ],
  },
  { id: "P12a", planId: "P12", code: "ZZTEST-012A", title: '=HYPERLINK("http://x","y")', status: "Draft", owner: "ADMIN", complete: true, purpose: "export formula injection" },
  { id: "P12b", planId: "P12", code: "ZZTEST-012B", title: LONG_TITLE, status: "Draft", owner: "ADMIN", complete: true, purpose: "export and table truncation (200 characters)" },
  { id: "P12c", planId: "P12", code: "ZZTEST-012C", title: "عمرة اقتصادية 🕋 ZZTEST", status: "Draft", owner: "ADMIN", complete: true, purpose: "export encoding (Arabic and emoji)" },
  {
    id: "P13", planId: "P13", code: "ZZTEST-013", title: "ZZTEST P13 On sale, one completed group", status: "Open for Sale", owner: "ADMIN", complete: true,
    // The test plan expects this package to appear in Needs Attention (no LIVE groups). The package_usage view counts every group that is
    // neither archived nor CANCELLED as live, and COMPLETED is neither. If the Needs Attention check disagrees with the plan, that is the
    // finding to record: the view and the plan do not agree on what "live" means for a completed group.
    purpose: "live vs total counts",
    groups: [{ code: "ZZTEST-G-013A", name: "ZZTEST P13 completed group", groupStatus: "COMPLETED", salesStatus: "SALES_CLOSED", capacity: 40, bookedSeats: 40, archived: false, departInDays: -90 }],
  },
];

/** A second agency's package, for the cross-agency tests (PKG-ACC-11, PKG-SEC-01..03). */
export const packagesFixtureOtherAgencyPlan: PackagesFixturePlan = {
  id: "B1", planId: "B1", code: "ZZTEST-B-001", title: "ZZTEST B1 other agency package", status: "Open for Sale", owner: "OTHER_AGENCY_ADMIN", complete: true,
  purpose: "must never be visible from the test agency",
};

/** Bulk packages for PKG-PRF-03. On sale, because an agency holds at most 500 drafts. */
export const PACKAGES_FIXTURE_BULK_PREFIX = "ZZTEST-BULK-";
export const PACKAGES_FIXTURE_BULK_MAX = 2000;

export function bulkFixtureCode(index: number): string {
  return `${PACKAGES_FIXTURE_BULK_PREFIX}${String(index).padStart(5, "0")}`;
}

/** The form for a plan: complete unless the plan says otherwise, always passing through the same mapper the app uses. */
export function buildFixtureForm(plan: PackagesFixturePlan): PackageFormData {
  const base: PackageFormData = {
    ...INITIAL_PACKAGE_FORM_DATA,
    title: plan.title,
    internalCode: plan.code,
    status: plan.status,
    featured: plan.featured ?? false,
    journeyType: plan.journeyType ?? "Umrah",
    category: plan.journeyType === "Hajj" ? "Hajj" : "Umrah",
    package_category: plan.packageCategory ?? INITIAL_PACKAGE_FORM_DATA.package_category,
    branch: plan.branch ?? INITIAL_PACKAGE_FORM_DATA.branch,
  };

  if (plan.blank) {
    return {
      ...base,
      title: "",
      internalCode: "",
      description: plan.marker ?? "",
      paymentMilestones: [],
      cancellationPolicy: "",
      itinerary: [],
      includedServices: [],
      makkahAccommodationStandard: "",
      madinahAccommodationStandard: "",
      transportRequirements: [],
      inclusions: [],
      exclusions: [],
      documentRequirements: [],
      seatReservationRule: "",
      defaultGroupCapacity: "",
      groupReadinessChecklist: [],
      duration: "",
    };
  }

  if (plan.stepOneOnly) {
    // Step 1 stays valid (title, code, overview, capacity, minimum size, days); steps 2-6 are emptied.
    return {
      ...base,
      paymentMilestones: [],
      cancellationPolicy: "",
      duration: "",
      itinerary: [],
      includedServices: [],
      makkahAccommodationStandard: "",
      madinahAccommodationStandard: "",
      transportRequirements: [],
      inclusions: [],
      exclusions: [],
      documentRequirements: [],
      seatReservationRule: "",
      defaultGroupCapacity: "",
      groupReadinessChecklist: [],
    };
  }

  return base;
}

/** The `packages` row for a plan, without the columns only the seeder knows (agency_id, owner_id). */
export function buildFixtureRow(plan: PackagesFixturePlan, now: Date): Record<string, unknown> {
  const row: Record<string, unknown> = { ...formDataToRow(buildFixtureForm(plan)) };
  const iso = now.toISOString();
  row.status = plan.status;
  row.previous_status = plan.status === "Archived" ? (plan.previousStatus ?? "Draft") : null;
  row.archived_at = plan.status === "Archived" ? iso : null;
  row.published_at = plan.status === "Draft" ? null : iso;
  row.published_version_id = null;
  return row;
}

/** Rows that must exist as a version for every package that has been on sale (so PKG-SEC-13 is meaningful for fixtures). */
export function planNeedsVersion(plan: PackagesFixturePlan): boolean {
  return plan.status === "Open for Sale" || plan.status === "Sales Closed" || (plan.status === "Archived" && plan.previousStatus === "Open for Sale");
}

export type PackagesFixtureEnvironment = { url: string; projectRef: string };

/** Refuses anything that is not a named, non-production project. Same rule as the Inbox LR2 seeder, with Packages' own variables. */
export function assertPackagesFixtureTarget(values: Record<string, string | undefined>): PackagesFixtureEnvironment {
  const environment = values.PACKAGES_E2E_ENVIRONMENT?.trim();
  if (environment !== "staging" && environment !== "disposable") throw new Error("PACKAGES_E2E_ENVIRONMENT must be staging or disposable.");
  const url = values.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const projectRef = values.PACKAGES_E2E_PROJECT_REF?.trim();
  const productionRef = values.PACKAGES_E2E_PRODUCTION_PROJECT_REF?.trim();
  if (!url || !projectRef || !productionRef) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL, PACKAGES_E2E_PROJECT_REF and PACKAGES_E2E_PRODUCTION_PROJECT_REF are required.");
  }
  if (projectRef === productionRef) throw new Error("PACKAGES_E2E_PROJECT_REF must not match PACKAGES_E2E_PRODUCTION_PROJECT_REF.");
  if ((KNOWN_PRODUCTION_PROJECT_REFS as readonly string[]).includes(projectRef)) {
    throw new Error("PACKAGES_E2E_PROJECT_REF is a known production project; refusing to run.");
  }
  if (new URL(url).hostname.split(".")[0] !== projectRef) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL does not point at PACKAGES_E2E_PROJECT_REF; refusing to run.");
  }
  return { url, projectRef };
}

/** Parses `--bulk <n>` (or `--bulk=<n>`), returning 0 when absent. */
export function parseBulkCount(argv: string[]): number {
  const index = argv.findIndex((arg) => arg === "--bulk" || arg.startsWith("--bulk="));
  if (index === -1) return 0;
  const raw = argv[index].includes("=") ? argv[index].split("=")[1] : argv[index + 1];
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 1 || count > PACKAGES_FIXTURE_BULK_MAX) {
    throw new Error(`--bulk needs a whole number from 1 to ${PACKAGES_FIXTURE_BULK_MAX}.`);
  }
  return count;
}
