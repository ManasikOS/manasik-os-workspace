"use client";

import PageHeader from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { runWithLoadingToast, toast } from "@/components/ui/toast";
import { ToneBadge } from "@/components/ui/tone-badge";
import {
  DataTable,
  type DataTableSort,
} from "@/components/data-table/data-table";
import { FilterMenu } from "@/components/data-table/filter-menu";
import { SavedViewBar } from "@/components/data-table/saved-view-bar";
import type { PackageCapabilities } from "@/lib/access/packages-access";
import {
  PACKAGE_SAVED_VIEWS,
  type PackageListItem,
  type PackageSavedView,
} from "@/lib/types/packages";
import { Archive, Download, MoreVertical, Plus, ShieldAlert } from "lucide-react";
import type { PackageChangeRequest } from "@/lib/data/packages-repository";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useMemo, useState } from "react";

import {
  downloadBinaryFile,
  downloadTextFile,
  packagesToCsv,
  matrixToXlsxFile,
  timestampedFilename,
  XLSX_MIME,
} from "../csv";
import {
  applySavedView,
  computeListKpis,
  DEFAULT_PACKAGE_SORT,
  matchesSearch,
  sortLabel,
  sortPackages,
  type PackageSort,
} from "../utils";
import { authorisePackageExportAction } from "../actions";
import { usePackageLifecycle } from "../use-package-lifecycle";
import ArchivedPackagesSheet from "./archived-packages-sheet";
import ConfirmPackageActionDialog from "./confirm-package-action-dialog";
import DeletePackageDialog from "./delete-package-dialog";
import PackageChangeQueueSheet from "./package-change-queue-sheet";
import ForceArchivePackageDialog from "./force-archive-package-dialog";
import {
  buildPackageColumns,
  PACKAGE_COLUMN_SORT_FIELDS,
} from "./packages-table/packages-columns";
import PackagesKpi from "./packages-kpi";
import { PackagesActionMenuItems } from "./packages-action-menu-items";
import { CONTEXT_MENU_SLOTS } from "../../departure-groups/components/groups-table/group-action-menu-items";

const ALL = "ALL";

interface Filters {
  journeyType: string;
  category: string;
  status: string;
  branch: string;
}

const EMPTY_FILTERS: Filters = {
  journeyType: ALL,
  category: ALL,
  status: ALL,
  branch: ALL,
};

interface PackagesListProps {
  packages: PackageListItem[];
  archivedPackages: PackageListItem[];
  /**
   * Resolved server-side (`packages/page.tsx`) via `loadDynamicCapabilities`
   * — a custom role's saved overrides merged over its base role's default,
   * not the hardcoded default alone. Passed down rather than re-derived
   * from a bare `role` prop with `capabilitiesForPackages(role)`, which
   * would silently ignore any override an ADMIN configured in Management →
   * Roles & Permissions for this module (finding A4).
   */
  can: PackageCapabilities;
  currentUserId: string | null;
  /** Changes to packages on sale that are waiting for approval (TASK-043). */
  pendingChanges: PackageChangeRequest[];
}

/**
 * Everything below filters, searches and sorts the `packages` array the
 * server fetched once — same posture as `DepartureGroupsList`. No filter,
 * search or sort change ever triggers a server round trip; only the
 * mutations (archive, publish, ...) do, and those refresh via
 * `router.refresh()` afterwards.
 *
 * Create and Edit go to the full-page editor at `/packages/new` and
 * `/packages/[id]/edit` (TASK-044).
 */
const PackagesList = ({
  packages,
  archivedPackages,
  can,
  currentUserId,
  pendingChanges,
}: PackagesListProps) => {
  const router = useRouter();
  const lifecycle = usePackageLifecycle();

  const [search, setSearch] = useState("");
  const [savedView, setSavedView] = useState<PackageSavedView>("All Packages");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<PackageSort>(DEFAULT_PACKAGE_SORT);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  // Which packages have a change waiting, so the table can mark them.
  const pendingPackageIds = useMemo(() => new Set(pendingChanges.map((request) => request.packageId)), [pendingChanges]);

  const setFilter = (key: keyof Filters, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  // Filter option lists are derived from the data actually in view, so a
  // branch with no packages never appears as a dead-end filter.
  const branchOptions = useMemo(
    () =>
      [...new Set(packages.map((p) => p.branch).filter(Boolean))]
        .sort()
        .map((v) => ({ value: v, label: v })),
    [packages],
  );

  const filtered = useMemo(() => {
    const viewed = applySavedView(packages, savedView, currentUserId);

    return viewed.filter((p) => {
      if (!matchesSearch(p, search)) return false;
      if (filters.journeyType !== ALL && p.journeyType !== filters.journeyType)
        return false;
      if (filters.category !== ALL && p.packageCategory !== filters.category)
        return false;
      if (filters.status !== ALL && p.status !== filters.status) return false;
      if (filters.branch !== ALL && p.branch !== filters.branch) return false;
      return true;
    });
  }, [packages, savedView, search, filters, currentUserId]);

  const sorted = useMemo(() => sortPackages(filtered, sort), [filtered, sort]);
  const kpis = useMemo(() => computeListKpis(filtered), [filtered]);

  /**
   * Exports exactly what is on screen — the current saved view, filters and
   * sort — built straight from the array already in the browser, so this is
   * instant and needs no server round trip.
   */
  const exportPackages = async (format: "csv" | "xlsx") => {
    if (sorted.length === 0) {
      toast.add({
        title: "Nothing to export",
        description: "No packages match the current filters.",
      });
      return;
    }

    // One tiny server call checks permission, applies the hourly limit and records the export. The file is then built here from the list already
    // loaded, so there is no second download. If this fails, nothing is exported.
    const filtersUsed: Record<string, string> = { view: savedView };
    if (search.trim()) filtersUsed.search = search.trim().slice(0, 80);
    for (const [key, value] of Object.entries(filters)) if (value !== ALL) filtersUsed[key] = value.slice(0, 80);
    const authorised = await runWithLoadingToast(
      () => authorisePackageExportAction({ format, rowCount: sorted.length, filters: filtersUsed }),
      {
        loadingTitle: "Preparing export…",
        successTitle: "Export ready",
        errorTitle: "Could not export packages",
        getFailureMessage: (response) => (response.ok ? undefined : response.error),
        shouldDismissSilently: (response) => response.ok,
      },
    );
    if (!authorised?.ok) return;

    if (format === "xlsx") {
      downloadBinaryFile(
        timestampedFilename("packages", "xlsx"),
        matrixToXlsxFile(sorted),
        XLSX_MIME,
      );
    } else {
      downloadTextFile(timestampedFilename("packages"), packagesToCsv(sorted));
    }

    toast.add({
      title: "Export ready",
      description: `${sorted.length} package${
        sorted.length === 1 ? "" : "s"
      } exported to ${format === "xlsx" ? "Excel" : "CSV"}.`,
    });
  };

  const rowActions = {
    ...lifecycle.actions,
    onOpen: (p: PackageListItem) => router.push(`/packages/${p.id}`),
    onEdit: (p: PackageListItem) => router.push(`/packages/${p.id}/edit`),
    onCreateGroup: (p: PackageListItem) =>
      router.push(`/departure-groups?create=1&template=${p.id}`),
  };

  const columns = useMemo(
    () =>
      buildPackageColumns(
        can,
        rowActions,
        { field: sort.field, direction: sort.direction },
        (next: DataTableSort) =>
          setSort({
            field: next.field as PackageSort["field"],
            direction: next.direction,
          }),
        pendingPackageIds,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can, router, sort.field, sort.direction, lifecycle.actions, pendingPackageIds],
  );

  return (
    <>
      <ConfirmPackageActionDialog
        pending={lifecycle.pending}
        onClose={lifecycle.closePending}
        onConfirmed={lifecycle.confirmPending}
      />
      <ForceArchivePackageDialog
        key={`force-archive-${lifecycle.forceArchiveTarget?.pkg.id ?? "none"}`}
        pkg={lifecycle.forceArchiveTarget?.pkg ?? null}
        liveGroupCount={lifecycle.forceArchiveTarget?.liveGroupCount ?? 0}
        onClose={lifecycle.closeForceArchive}
        onConfirm={lifecycle.forceArchive}
      />
      <DeletePackageDialog
        key={`delete-${lifecycle.deleteTarget?.id ?? "none"}`}
        pkg={lifecycle.deleteTarget}
        onClose={lifecycle.closeDelete}
        onDeleted={lifecycle.finishDelete}
      />
      <ArchivedPackagesSheet
        open={archivedOpen}
        onOpenChange={setArchivedOpen}
        packages={archivedPackages}
        canRestore={can.archiveOrRestorePackage}
      />
      <PackageChangeQueueSheet
        open={queueOpen}
        onOpenChange={setQueueOpen}
        requests={pendingChanges}
        can={can}
        currentUserId={currentUserId}
      />

      <div className="flex flex-col gap-6 w-full mx-auto pb-10">
        <PageHeader
          subTitle="The commercial catalogue behind every departure group."
          title="Packages"
          breadcrumb={[
            { title: "Home", link: "/dashboard" },
            { title: "Packages", link: "/packages" },
          ]}
          action={
            <div className="flex items-center gap-4">
              {pendingChanges.length > 0 && (
                <Button variant="outline_without_border" onClick={() => setQueueOpen(true)}>
                  <ShieldAlert /> Awaiting approval
                  <ToneBadge tone="warning" label={String(pendingChanges.length)} className="ml-1 px-1.5 py-0.5 text-[10px] tabular-nums" />
                </Button>
              )}
              {can.createPackage && (
                <Button onClick={() => router.push("/packages/new")}>
                  <Plus /> Create Package
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline_without_border"
                      aria-label="More actions"
                    >
                      <MoreVertical />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  {can.exportCatalogue && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Download /> Export Packages
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem onClick={() => exportPackages("csv")}>
                          CSV (.csv) — smallest, opens anywhere
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => exportPackages("xlsx")}
                        >
                          Excel (.xlsx)
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setArchivedOpen(true)}>
                    <Archive /> View Archived Packages
                    {archivedPackages.length > 0 && (
                      <span className="ml-auto text-[10px] tabular-nums px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground">
                        {archivedPackages.length}
                      </span>
                    )}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          }
        />

        <PackagesKpi kpis={kpis} packageCount={filtered.length} />

        <div className="flex flex-wrap items-center justify-between gap-4">
          <SavedViewBar<PackageSavedView>
            views={PACKAGE_SAVED_VIEWS}
            active={savedView}
            onChange={setSavedView}
          />
        </div>

        <div className="flex items-center justify-between gap-4 w-full">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              {savedView}
            </h2>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-sm bg-primary/10 text-primary">
              {filtered.length} Total
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            Sorted by {sortLabel(sort).toLowerCase()}
          </span>
        </div>

        <DataTable<PackageListItem>
          columns={columns}
          data={sorted}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search title, code..."
          toolbar={
            <FilterMenu<keyof Filters>
              groups={[
                {
                  key: "journeyType",
                  label: "Journey",
                  value: filters.journeyType,
                  options: [
                    { value: "Umrah", label: "Umrah" },
                    { value: "Hajj", label: "Hajj" },
                    {
                      value: "Early Registration",
                      label: "Early Registration",
                    },
                  ],
                },
                {
                  key: "category",
                  label: "Category",
                  value: filters.category,
                  options: [
                    { value: "Economy", label: "Economy" },
                    { value: "Standard", label: "Standard" },
                    { value: "Premium", label: "Premium" },
                    { value: "VIP", label: "VIP" },
                    { value: "Custom", label: "Custom" },
                  ],
                },
                {
                  key: "status",
                  label: "Status",
                  value: filters.status,
                  options: [
                    { value: "Draft", label: "Draft" },
                    { value: "Open for Sale", label: "Open for Sale" },
                    { value: "Sales Closed", label: "Sales Closed" },
                  ],
                },
                {
                  key: "branch",
                  label: "Branch",
                  value: filters.branch,
                  options: branchOptions,
                },
              ]}
              onChange={setFilter}
              onClear={() => setFilters(EMPTY_FILTERS)}
            />
          }
          onRowClick={(p) => router.push(`/packages/${p.id}`)}
          getRowId={(p) => p.id}
          resetPageToken={`${sort.field}:${sort.direction}:${savedView}`}
          sort={sort}
          sortFieldByColumnId={PACKAGE_COLUMN_SORT_FIELDS}
          contextMenuContents={(pkg) => (
            <PackagesActionMenuItems
              packages={pkg}
              can={can}
              actions={rowActions}
              slots={CONTEXT_MENU_SLOTS}
            />
          )}
          emptyMessage={
            packages.length === 0
              ? "No packages yet. Create your first package template to start selling."
              : undefined
          }
        />
      </div>
    </>
  );
};

export default PackagesList;
