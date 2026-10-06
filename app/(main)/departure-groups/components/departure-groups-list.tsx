"use client";

import PageHeader from "@/components/page-header";
import { useDepartureCapabilities } from "@/app/(main)/departure-groups/capabilities-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import {
  type StaffRole,
} from "@/lib/access/departure-groups-access";
import { cn } from "@/lib/utils";
import {
  Archive,
  Download,
  Import,
  MoreVertical,
  Plus,
} from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import dynamic from "next/dynamic";
import React, { useMemo, useState } from "react";

import {
  ALL_FILTER,
  useFilteredRows,
  type FilterRecord,
} from "@/hooks/use-filtered-rows";
import { FilterMenu } from "@/components/data-table/filter-menu";
import { SavedViewBar } from "@/components/data-table/saved-view-bar";

import type {
  DepartureGroupListItem,
  DepartureGroupSavedView,
  PackageTemplateOption,
} from "../types";
import {
  DEPARTURE_GROUP_SAVED_VIEWS,
  type DepartureGroupStatus,
  type GroupJourneyType,
  type GroupReadinessStatus,
  type GroupSalesStatus,
} from "../types";
import {
  DEFAULT_GROUP_SORT,
  GROUP_STATUS_LABELS,
  JOURNEY_TYPE_LABELS,
  READINESS_STATUS_LABELS,
  SALES_STATUS_LABELS,
  applySavedView,
  computeListKpis,
  departureMonthKey,
  departureMonthLabel,
  compareGroups,
  sortLabel,
  type GroupSort,
} from "../utils";
import {
  archiveDepartureGroupAction,
  setGroupLifecycleAction,
} from "../actions";
import {
  downloadBinaryFile,
  downloadTextFile,
  groupsToCsv,
  groupsToMatrix,
  timestampedFilename,
} from "../csv";
import { matrixToXlsx, XLSX_MIME } from "../xlsx";
import ConfirmActionDialog, {
  type PendingGroupAction,
} from "./confirm-action-dialog";
import DepartureGroupsKPI from "./departure-groups-kpi-cards/departure-groups-kpi";

/**
 * These three sheets/dialogs are the heaviest components on the list route
 * (the create sheet alone is ~900 lines with a full form + calendar), so
 * they're code-split and only mounted once the user has actually opened them
 * at least once — otherwise every visitor pays for their JS on first paint
 * whether or not they have permission to open them.
 */
const ArchivedGroupsSheet = dynamic(() => import("./archived-groups-sheet"));
const CreateDepartureGroupDialog = dynamic(
  () => import("./create-departure-group-dialog"),
);
const ImportGroupsDialog = dynamic(() => import("./import-groups-dialog"));
import { buildGroupColumns } from "./groups-table/groups-columns";
import { DataTable } from "@/components/data-table/data-table";
import {
  GroupActionMenuItems,
  CONTEXT_MENU_SLOTS,
} from "./groups-table/group-action-menu-items";

const ALL = ALL_FILTER;

interface Filters extends FilterRecord {
  groupStatus: string;
  salesStatus: string;
  journeyType: string;
  packageTemplateId: string;
  departureMonth: string;
  readinessRisk: string;
  branch: string;
  guide: string;
}

const EMPTY_FILTERS: Filters = {
  groupStatus: ALL,
  salesStatus: ALL,
  journeyType: ALL,
  packageTemplateId: ALL,
  departureMonth: ALL,
  readinessRisk: ALL,
  branch: ALL,
  guide: ALL,
};

interface DepartureGroupsListProps {
  groups: DepartureGroupListItem[];
  /** Filed-away groups, shown through the "View Archived Groups" sheet. */
  archivedGroups: DepartureGroupListItem[];
  templates: PackageTemplateOption[];
  role: StaffRole;
  /** From `staff_group_assignments`, for the "My Assigned Groups" saved view. */
  assignedGroupIds: string[];
  /** From `?create=1` — opens the create sheet on mount. See finding C4. */
  autoOpenCreate?: boolean;
  /** From `?template=<id>` — preselected once the sheet is open, if it's a real, visible template. */
  initialCreateTemplateId?: string | null;
}

const DepartureGroupsList = ({
  groups,
  archivedGroups,
  templates,
  role,
  assignedGroupIds,
  autoOpenCreate = false,
  initialCreateTemplateId = null,
}: DepartureGroupsListProps) => {
  const router = useRouter();
  const can = useDepartureCapabilities(role);

  const [savedView, setSavedView] =
    useState<DepartureGroupSavedView>("All Groups");
  // `?create=1` (see `autoOpenCreate`'s own comment) opens the sheet from
  // its very first render via lazy initial state, rather than flipping it
  // open in a mount effect — this is a one-time "what should this start
  // as" decision from a server-provided prop, not a case of synchronising
  // with anything that changes after mount, so the initializer form is both
  // the simpler and the correct tool (an effect would render once closed,
  // then immediately again open, which is exactly the extra render the
  // lint rule this sidesteps warns about).
  const [createOpen, setCreateOpen] = useState(
    () => autoOpenCreate && can.createGroup,
  );
  const [importOpen, setImportOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [pending, setPending] = useState<PendingGroupAction | null>(null);

  // Mount each code-split sheet/dialog only once it has actually been opened,
  // then keep it mounted (rather than unmount/remount on every close) so its
  // own internal state/animation behaves the same as before.
  const [hasOpenedCreate, setHasOpenedCreate] = useState(
    () => autoOpenCreate && can.createGroup,
  );
  const [hasOpenedImport, setHasOpenedImport] = useState(false);
  const [hasOpenedArchived, setHasOpenedArchived] = useState(false);

  /**
   * The saved view is applied before `useFilteredRows` sees the rows, not
   * inside it — it reads `savedView` and `assignedGroupIds`, which the hook
   * cannot key its memos on. See the purity contract in
   * `hooks/use-filtered-rows.ts`.
   */
  const scopedGroups = useMemo(
    () => applySavedView(groups, savedView, assignedGroupIds),
    [groups, savedView, assignedGroupIds],
  );

  const list = useFilteredRows<DepartureGroupListItem, Filters, GroupSort>({
    rows: scopedGroups,
    emptyFilters: EMPTY_FILTERS,
    initialSort: DEFAULT_GROUP_SORT,
    searchFields: (g) => [
      g.groupName,
      g.groupCode,
      g.packageTemplateName,
      g.packageTemplateCode,
      g.primaryGuideName,
      g.branch,
      JOURNEY_TYPE_LABELS[g.journeyType],
    ],
    matches: (group, f) =>
      (f.groupStatus === ALL ||
        group.groupStatus === (f.groupStatus as DepartureGroupStatus)) &&
      (f.salesStatus === ALL ||
        group.salesStatus === (f.salesStatus as GroupSalesStatus)) &&
      (f.journeyType === ALL ||
        group.journeyType === (f.journeyType as GroupJourneyType)) &&
      (f.packageTemplateId === ALL ||
        group.packageTemplateId === f.packageTemplateId) &&
      (f.departureMonth === ALL ||
        departureMonthKey(group) === f.departureMonth) &&
      (f.readinessRisk === ALL ||
        group.readinessStatus === (f.readinessRisk as GroupReadinessStatus)) &&
      (f.branch === ALL || group.branch === f.branch) &&
      (f.guide === ALL || group.primaryGuideName === f.guide),
    compare: compareGroups,
  });

  const { filters, setFilter, sort, setSort } = list;

  /* Filter option lists are derived from the data actually in view, so a
     branch or guide with no groups never appears as a dead-end filter. */
  const branchOptions = list.optionsFor((g) => g.branch);
  const guideOptions = list.optionsFor((g) => g.primaryGuideName);
  const templateOptions = list.optionsFor(
    (g) => g.packageTemplateId,
    (_value, g) => g.packageTemplateName,
  );
  const monthOptions = list.optionsFor(departureMonthKey, (key) =>
    departureMonthLabel(key),
  );

  const sorted = list.rows;
  const kpis = useMemo(() => computeListKpis(sorted), [sorted]);

  /**
   * Exports exactly what is on screen — the current saved view, filters and
   * sort — so the file matches what the operator is looking at rather than the
   * unfiltered set. Nothing leaves the browser; the CSV is built from data the
   * page already holds.
   */
  const exportGroups = (format: "csv" | "xlsx") => {
    if (sorted.length === 0) {
      toast.add({
        title: "Nothing to export",
        description: "No groups match the current filters.",
      });
      return;
    }

    if (format === "xlsx") {
      downloadBinaryFile(
        timestampedFilename("departure-groups", "xlsx"),
        matrixToXlsx(groupsToMatrix(sorted), "Departure Groups"),
        XLSX_MIME,
      );
    } else {
      downloadTextFile(
        timestampedFilename("departure-groups"),
        groupsToCsv(sorted),
      );
    }

    toast.add({
      title: "Export ready",
      description: `${sorted.length} group${
        sorted.length === 1 ? "" : "s"
      } exported to ${format === "xlsx" ? "Excel" : "CSV"}.`,
    });
  };

  /**
   * Destructive-action confirmations. Archive has its own action; everything
   * else goes through the lifecycle action, which cascades into the group's
   * bookings when cancelling.
   */
  const handleConfirmedAction = async (action: PendingGroupAction) => {
    if (action.type === "ARCHIVE") {
      const result = await archiveDepartureGroupAction(action.group.id);
      if (!result.ok) {
        toast.add({
          title: "Could not archive group",
          description: result.error,
        });
        return;
      }
      toast.add({
        title: "Group archived",
        description: `${result.groupName} moved to archived groups.`,
      });
      router.refresh();
      return;
    }

    const result = await setGroupLifecycleAction({
      groupId: action.group.id,
      action: action.type === "CLOSE_SALES" ? "CLOSE_SALES" : "CANCEL",
      ...(action.type === "CANCEL"
        ? { reason: action.reason?.trim() || "Departure group cancelled." }
        : {}),
    });

    if (!result.ok) {
      toast.add({ title: "Could not update group", description: result.error });
      return;
    }

    toast.add({
      title: action.type === "CANCEL" ? "Group cancelled" : "Sales closed",
      description:
        action.type === "CANCEL"
          ? `${result.groupName}: ${result.cancelledBookings} booking${
              result.cancelledBookings === 1 ? "" : "s"
            } withdrawn.`
          : result.groupName,
    });
  };

  const rowActions = useMemo(
    () => ({
      onOpen: (group: DepartureGroupListItem) =>
        router.push(`/departure-groups/${group.id}`),
      onEdit: (group: DepartureGroupListItem) =>
        router.push(`/departure-groups/${group.id}?tab=overview&edit=1`),
      onAddBooking: (group: DepartureGroupListItem) =>
        router.push(`/departure-groups/${group.id}?tab=pilgrims&add=1`),
      onCompareTemplate: (group: DepartureGroupListItem) =>
        router.push(`/departure-groups/${group.id}?tab=overview&compare=1`),
      onCloseSales: (group: DepartureGroupListItem) =>
        setPending({ type: "CLOSE_SALES", group }),
      onCancel: (group: DepartureGroupListItem) =>
        setPending({ type: "CANCEL", group }),
      onArchive: (group: DepartureGroupListItem) =>
        setPending({ type: "ARCHIVE", group }),
    }),
    [router],
  );

  const columns = useMemo(
    // `setSort` is `useState`'s setter threaded through the hook, so it is
    // stable — listed only because it now arrives via destructuring, where
    // the lint rule can no longer prove that for itself.
    () =>
      buildGroupColumns(can, rowActions, sort, (s) => setSort(s as GroupSort)),
    [can, rowActions, sort, setSort],
  );

  return (
    <>
      {hasOpenedCreate && (
        <CreateDepartureGroupDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          templates={templates}
          role={role}
          branches={branchOptions.map((b) => b.value)}
          initialTemplateId={initialCreateTemplateId}
        />
      )}
      <ConfirmActionDialog
        pending={pending}
        onClose={() => setPending(null)}
        onConfirmed={handleConfirmedAction}
      />
      {hasOpenedImport && (
        <ImportGroupsDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          templates={templates}
        />
      )}
      {hasOpenedArchived && (
        <ArchivedGroupsSheet
          open={archivedOpen}
          onOpenChange={setArchivedOpen}
          groups={archivedGroups}
          canRestore={can.cancelOrArchiveGroup}
        />
      )}

      <div className="mx-auto flex w-full flex-col gap-8 pb-10">
        <PageHeader
          subTitle="Manage live groups, seats, bookings, and departure readiness."
          title="Departure Groups"
          breadcrumb={[
            { title: "Home", link: "/dashboard" },
            { title: "Departure Groups", link: "/departure-groups" },
          ]}
          action={
            <div className="flex items-center gap-4">
              {can.createGroup && (
                <Button
                  onClick={() => {
                    setHasOpenedCreate(true);
                    setCreateOpen(true);
                  }}
                >
                  <Plus /> Create Departure Group
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
                  {can.createGroup && (
                    <DropdownMenuItem
                      onClick={() => {
                        setHasOpenedImport(true);
                        setImportOpen(true);
                      }}
                    >
                      <Import /> Import Groups
                    </DropdownMenuItem>
                  )}
                  {can.exportReports && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Download /> Export Groups
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem onClick={() => exportGroups("xlsx")}>
                          Excel (.xlsx)
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => exportGroups("csv")}>
                          CSV (.csv)
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                  <DropdownMenuItem
                    onClick={() => {
                      setHasOpenedArchived(true);
                      setArchivedOpen(true);
                    }}
                  >
                    <Archive /> View Archived Groups
                    {archivedGroups.length > 0 && (
                      <span className="ml-auto text-[10px] font-number px-1.5 py-0.5 rounded-sm bg-muted text-muted-foreground">
                        {archivedGroups.length}
                      </span>
                    )}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          }
        />
        <DepartureGroupsKPI kpis={kpis} groupCount={sorted.length} />
        <SavedViewBar
          views={DEPARTURE_GROUP_SAVED_VIEWS}
          active={savedView}
          onChange={setSavedView}
        />
        <div className="flex w-full items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-medium tracking-tight text-foreground">
              {savedView}
            </h2>
            <span className="rounded-sm bg-primary/10 px-2 py-0.5 font-number text-[11px] font-medium text-primary">
              {sorted.length} of {groups.length}
            </span>
          </div>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Sorted by {sortLabel(sort).toLowerCase()}
          </span>
        </div>{" "}
        {/* While the deferred filter pass catches up with the typed text the
            previous rows stay on screen and simply dim — never a spinner, and
            never an unmount. `pointer-events-none` stops a click landing on a
            row that is about to be filtered away. */}
        <div
          className={cn(
            "transition-opacity duration-150",
            list.isStale && "opacity-60 pointer-events-none",
          )}
        >
          <DataTable<DepartureGroupListItem>
            columns={columns}
            data={sorted}
            search={list.search}
            onSearchChange={list.setSearch}
            searchPlaceholder="Search group name, code, package, guide, destination..."
            toolbar={
              <FilterMenu<Extract<keyof Filters, string>>
                groups={[
                  {
                    key: "groupStatus",
                    label: "Group Status",
                    value: filters.groupStatus,
                    options: Object.entries(GROUP_STATUS_LABELS).map(
                      ([value, label]) => ({ value, label }),
                    ),
                  },
                  {
                    key: "salesStatus",
                    label: "Sales Status",
                    value: filters.salesStatus,
                    options: Object.entries(SALES_STATUS_LABELS).map(
                      ([value, label]) => ({ value, label }),
                    ),
                  },
                  {
                    key: "journeyType",
                    label: "Journey",
                    value: filters.journeyType,
                    options: Object.entries(JOURNEY_TYPE_LABELS).map(
                      ([value, label]) => ({ value, label }),
                    ),
                  },
                  {
                    key: "packageTemplateId",
                    label: "Package Template",
                    value: filters.packageTemplateId,
                    options: templateOptions,
                  },
                  {
                    key: "departureMonth",
                    label: "Departure Month",
                    value: filters.departureMonth,
                    options: monthOptions,
                  },
                  {
                    key: "readinessRisk",
                    label: "Readiness Risk",
                    value: filters.readinessRisk,
                    options: Object.entries(READINESS_STATUS_LABELS).map(
                      ([value, label]) => ({ value, label }),
                    ),
                  },
                  {
                    key: "branch",
                    label: "Branch",
                    value: filters.branch,
                    options: branchOptions,
                  },
                  {
                    key: "guide",
                    label: "Assigned Guide",
                    value: filters.guide,
                    options: guideOptions,
                  },
                ]}
                onChange={setFilter}
                onClear={list.clearFilters}
              />
            }
            onRowClick={(item) => router.push(`/departure-groups/${item.id}`)}
            getRowId={(item) => item.id}
            resetPageToken={`${list.resetPageToken}|${savedView}`}
            sort={{ field: sort.field, direction: sort.direction }}
            sortFieldByColumnId={{
              teamMember: "fullName",
              role: "role",
              openTasks: "openTaskCount",
              lastActive: "lastActiveAt",
            }}
            contextMenuContents={(item) => (
              <GroupActionMenuItems
                group={item}
                can={can}
                actions={rowActions}
                slots={CONTEXT_MENU_SLOTS}
              />
            )}
          />
        </div>
      </div>
    </>
  );
};

export default DepartureGroupsList;
