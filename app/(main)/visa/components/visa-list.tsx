"use client";

import PageHeader from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { FilterSelect } from "@/components/data-table/filter-select";
import { SavedViewBar } from "@/components/data-table/saved-view-bar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import {
  CalendarCheck,
  ChevronDown,
  Download,
  MoreVertical,
  Plus,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useMemo, useState } from "react";

import { useFilteredRows } from "@/hooks/use-filtered-rows";
import { cn } from "@/lib/utils";

import { allVisaTypes } from "@/lib/data/visa-copy";
import { computeGroupVisaBoards, computeVisaKpis, deriveVisaAlerts, scoreVisaApplication } from "@/lib/data/visa";

import { useVisa } from "../visa-store";
import {
  EMPTY_VISA_FILTERS,
  VISA_QUEUES,
  VISA_SAVED_VIEWS,
  type VisaAlert,
  type VisaFilters,
  type VisaListItem,
  type VisaQueue,
  type VisaSavedView,
} from "../types";
import {
  DEFAULT_VISA_SORT,
  VISA_STATUS_LABELS,
  activeFilterCount,
  applySavedView,
  matchesQueue,
  matchesVisaFilters,
  matchesVisaSearch,
  sortVisaApplications,
  type VisaSort,
} from "../utils";
import { buildVisaColumns } from "../visa-table/visa-columns";
import { VisaDataTable } from "../visa-table/visa-data-table";
import { visaApplicationsToSubmissionPackCsv, downloadTextFile, timestampedFilename } from "../csv";
import AiVisaPanel from "./ai-visa-panel";
import ApplicationSheet from "./application-sheet";
import AssignOfficerDialog from "./assign-officer-dialog";
import BatchDetailSheet from "./batch-detail-sheet";
import CreateBatchSheet from "./create-batch-sheet";
import GroupVisaBoardView from "./group-visa-board";
import StatusCheckDialog from "./status-check-dialog";
import VisaAlerts from "./visa-alerts";
import VisaBulkActionsBar from "./visa-bulk-actions-bar";
import VisaMetrics from "./visa-metrics";

const VisaList = () => {
  const router = useRouter();
  const { applications, currentStaffName, can } = useVisa();

  const [queue, setQueue] = useState<VisaQueue>("All Applications");
  const [savedView, setSavedView] = useState<VisaSavedView>("All");
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  const [reviewItem, setReviewItem] = useState<VisaListItem | null>(null);
  const [assignTarget, setAssignTarget] = useState<VisaListItem | null>(null);
  const [statusCheckTarget, setStatusCheckTarget] = useState<VisaListItem | null>(null);
  const [createBatchOpen, setCreateBatchOpen] = useState(false);
  const [batchDetailId, setBatchDetailId] = useState<string | null>(null);
  const [bulkStatusCheckOpen, setBulkStatusCheckOpen] = useState(false);

  const groupOptions = useMemo(
    () => [...new Map(applications.map((a) => [a.groupId, a.groupName])).entries()].map(([value, label]) => ({ value, label })),
    [applications],
  );
  const branchOptions = useMemo(
    () => [...new Set(applications.map((a) => a.branch).filter(Boolean))].map((b) => ({ value: b, label: b })),
    [applications],
  );
  const assigneeOptions = useMemo(
    () =>
      [...new Set(applications.map((a) => a.assignedToName).filter((n): n is string => !!n))].map((n) => ({
        value: n,
        label: n,
      })),
    [applications],
  );
  const batchOptions = useMemo(
    () =>
      [...new Map(applications.filter((a) => a.batchId).map((a) => [a.batchId as string, a.batchReference ?? ""])).entries()].map(
        ([value, label]) => ({ value, label }),
      ),
    [applications],
  );

  const scored = useMemo(
    () => applications.map((a) => ({ ...a, priorityScore: scoreVisaApplication(a) })),
    [applications],
  );

  /**
   * The saved view and the queue both narrow the list from state the hook
   * cannot key its memos on, so they are applied before it sees the rows.
   * See the purity contract in `hooks/use-filtered-rows.ts`.
   */
  const scopedApplications = useMemo(
    () =>
      applySavedView(scored, savedView, currentStaffName).filter((item) =>
        matchesQueue(item, queue),
      ),
    [scored, savedView, queue, currentStaffName],
  );

  const list = useFilteredRows<VisaListItem, VisaFilters, VisaSort>({
    rows: scopedApplications,
    emptyFilters: EMPTY_VISA_FILTERS,
    initialSort: DEFAULT_VISA_SORT,
    searchPredicate: matchesVisaSearch,
    matches: matchesVisaFilters,
    sortRows: sortVisaApplications,
  });

  const { filters, setFilter, sort, setSort } = list;
  const sorted = list.rows;
  const kpis = useMemo(() => computeVisaKpis(scored), [scored]);
  const alerts = useMemo(() => deriveVisaAlerts(scored), [scored]);
  const groupBoards = useMemo(() => computeGroupVisaBoards(scored), [scored]);

  const columns = useMemo(
    () =>
      buildVisaColumns(
        sort,
        (s) => setSort(s as VisaSort),
        {
          onReview: (item) => setReviewItem(item),
          onAssign: (item) => setAssignTarget(item),
          onOpenDocuments: () => router.push("/documents"),
          onStatusCheck: (item) => setStatusCheckTarget(item),
          onOpenBatch: (item) => item.batchId && setBatchDetailId(item.batchId),
        },
        can.assignOfficer,
      ),
    [sort, setSort, can, router],
  );

  const openAlert = (alert: VisaAlert) => {
    setQueue((alert.queue as VisaQueue) ?? "All Applications");
    if (alert.groupId) setFilter("groupId", alert.groupId);
  };

  const openGroup = (groupId: string) => {
    setFilter("groupId", groupId);
    setQueue("All Applications");
  };

  const exportSubmissionPack = () => {
    downloadTextFile(timestampedFilename("visa-submission-pack"), visaApplicationsToSubmissionPackCsv(sorted));
    toast.add({ title: "Submission pack exported", description: `${sorted.length} application(s) exported.` });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={[
          { title: "Home", link: "/dashboard" },
          { title: "Operations", link: "/visa" },
          { title: "Visa", link: "/visa" },
        ]}
        title="Visa Operations"
        subTitle="Prepare, submit, track, and resolve pilgrim visa applications across active groups."
        action={
          <div className="flex items-center gap-2">
            {can.createBatch && (
              <Button variant="secondary" onClick={() => setCreateBatchOpen(true)}>
                <Plus /> Create Visa Batch
              </Button>
            )}
            {can.recordStatusCheck && (
              <Button
                variant="outline_without_border"
                onClick={() => {
                  if (sorted.length === 0) return;
                  setBulkStatusCheckOpen(true);
                }}
              >
                <CalendarCheck /> Check Status
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline_without_border"><MoreVertical /></Button>} />
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>More</DropdownMenuLabel>
                {can.exportSubmissionPack && (
                  <DropdownMenuItem onClick={exportSubmissionPack}>
                    <Download /> Export Submission Pack
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <VisaMetrics kpis={kpis} activeQueue={queue} onQueueChange={setQueue} readOnly={can.readOnly} />

      <VisaAlerts alerts={alerts} onOpen={openAlert} />

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4 min-w-0">
          <SavedViewBar views={VISA_QUEUES} active={queue} onChange={setQueue} />

          <SavedViewBar views={VISA_SAVED_VIEWS} active={savedView} onChange={setSavedView} />

          {!can.readOnly && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <FilterSelect label="Departure Group" value={filters.groupId} options={groupOptions} onChange={(v) => setFilter("groupId", v)} />
                <FilterSelect
                  label="Visa Status"
                  value={filters.visaStatus}
                  options={Object.entries(VISA_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
                  onChange={(v) => setFilter("visaStatus", v)}
                />
                <FilterSelect
                  label="Visa Type"
                  value={filters.visaType}
                  options={allVisaTypes().map((t) => ({ value: t, label: t }))}
                  onChange={(v) => setFilter("visaType", v)}
                />
                <FilterSelect label="Submission Batch" value={filters.batchId} options={batchOptions} onChange={(v) => setFilter("batchId", v)} />
                <Button variant="outline_without_border" size="sm" className="gap-1.5 text-muted-foreground bg-transparent dark:bg-transparent shadow-none!" onClick={() => setShowMoreFilters((v) => !v)}>
                  <SlidersHorizontal className="size-3.5" /> More Filters <ChevronDown />
                </Button>
                {activeFilterCount(filters) > 0 && (
                  <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={list.clearFilters}>
                    <X /> Clear filters
                  </Button>
                )}
              </div>

              {showMoreFilters && (
                <div className="flex flex-wrap items-center gap-2">
                  <FilterSelect
                    label="Journey Type"
                    value={filters.journeyType}
                    options={[
                      { value: "UMRAH", label: "Umrah" },
                      { value: "HAJJ", label: "Hajj" },
                      { value: "EARLY_REGISTRATION", label: "Early Registration" },
                    ]}
                    onChange={(v) => setFilter("journeyType", v)}
                  />
                  <FilterSelect label="Assigned Visa Officer" value={filters.assignedTo} options={assigneeOptions} onChange={(v) => setFilter("assignedTo", v)} />
                  <FilterSelect label="Branch" value={filters.branch} options={branchOptions} onChange={(v) => setFilter("branch", v)} />
                </div>
              )}
            </>
          )}

          {queue === "By Group" ? (
            <GroupVisaBoardView boards={groupBoards} onOpenGroup={openGroup} />
          ) : (
            <div
              className={cn(
                "transition-opacity duration-150",
                list.isStale && "opacity-60 pointer-events-none",
              )}
            >
            <VisaDataTable
              columns={columns}
              data={sorted}
              search={list.search}
              onSearchChange={list.setSearch}
              onRowClick={(item) => setReviewItem(item)}
              resetPageToken={`${queue}-${savedView}-${list.resetPageToken}`}
              sort={{ field: sort.field, direction: sort.direction }}
              sortFieldByColumnId={{ pilgrim: "fullName", departureGroup: "departureDate", submitted: "submittedAt" }}
              bulkBar={
                can.assignOfficer
                  ? (selected, clear) => <VisaBulkActionsBar selected={selected} clear={clear} can={can} />
                  : undefined
              }
            />
            </div>
          )}
        </div>

        <div className="hidden xl:block">
          <AiVisaPanel applications={applications} onOpenQueue={setQueue} />
        </div>
      </div>

      <ApplicationSheet item={reviewItem} open={reviewItem !== null} onClose={() => setReviewItem(null)} can={can} />
      <AssignOfficerDialog
        journeyIds={assignTarget ? [assignTarget.journeyId] : []}
        itemsLabel={assignTarget ? `${assignTarget.fullName} — ${assignTarget.groupName}` : ""}
        currentAssignee={assignTarget?.assignedToName}
        open={assignTarget !== null}
        onClose={() => setAssignTarget(null)}
      />
      <StatusCheckDialog
        journeyIds={statusCheckTarget ? [statusCheckTarget.journeyId] : []}
        itemsLabel={statusCheckTarget?.fullName ?? ""}
        open={statusCheckTarget !== null}
        onClose={() => setStatusCheckTarget(null)}
      />
      <StatusCheckDialog
        journeyIds={sorted.map((s) => s.journeyId)}
        itemsLabel={`${sorted.length} application(s) in the current view`}
        open={bulkStatusCheckOpen}
        onClose={() => setBulkStatusCheckOpen(false)}
      />
      <CreateBatchSheet
        applications={applications}
        currentStaffName={currentStaffName}
        open={createBatchOpen}
        onClose={() => setCreateBatchOpen(false)}
        preselectedGroupId={filters.groupId !== "ALL" ? filters.groupId : null}
      />
      <BatchDetailSheet batchId={batchDetailId} applications={applications} can={can} open={batchDetailId !== null} onClose={() => setBatchDetailId(null)} />
    </div>
  );
};

export default VisaList;
