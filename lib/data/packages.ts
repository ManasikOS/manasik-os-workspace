/**
 * Thin re-export — the real implementation moved to `packages-repository.ts`
 * so the list screen's query/filter/sort/paginate logic and the KPI/usage
 * aggregates have somewhere to live that isn't a single flat file.
 */
export {
  getPackage,
  getPackageDetail,
  getPackageUsage,
  listDepartureGroupsForPackage,
  listPackages,
  type PackageUsageSummary,
  type DepartureGroupUsingPackage,
} from "./packages-repository";
