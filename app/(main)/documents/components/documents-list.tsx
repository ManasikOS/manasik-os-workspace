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
  ChevronDown,
  Download,
  MessageSquarePlus,
  MoreVertical,
  Settings,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";
import React, { useMemo, useState } from "react";

import { useFilteredRows } from "@/hooks/use-filtered-rows";
import { cn } from "@/lib/utils";

import {
  computeDocumentKpis,
  computeGroupDocumentBoards,
  deriveCriticalAlerts,
  scoreDocument,
} from "@/lib/data/documents";

import { useDocuments } from "../documents-store";
import {
  DOCUMENT_QUEUES,
  DOCUMENT_SAVED_VIEWS,
  EMPTY_DOCUMENT_FILTERS,
  type CriticalAlert,
  type DocumentFilters,
  type DocumentListItem,
  type DocumentQueue,
  type DocumentSavedView,
} from "../types";
import {
  DEFAULT_DOCUMENT_SORT,
  DOCUMENT_TYPE_OPTIONS,
  activeFilterCount,
  applySavedView,
  matchesDocumentFilters,
  matchesDocumentSearch,
  matchesQueue,
  sortDocuments,
  whatsappLink,
  type DocumentSort,
} from "../utils";
import { buildDocumentColumns } from "../documents-table/documents-columns";
import { DocumentsDataTable } from "../documents-table/documents-data-table";
import {
  documentsToChecklistCsv,
  documentsToVisaPackCsv,
  downloadTextFile,
  timestampedFilename,
} from "../csv";
import AgentSettingsSheet from "./agent-settings-sheet";
import AiAgentPanel from "./ai-agent-panel";
import AssignReviewerDialog from "./assign-reviewer-dialog";
import BulkActionsBar from "./bulk-actions-bar";
import CriticalAlerts from "./critical-alerts";
import DocumentsMetrics from "./documents-metrics";
import GroupBoard from "./group-board";
import RequestDocumentsSheet from "./request-documents-sheet";
import ReviewDocumentSheet from "./review-document-sheet";
import UploadDocumentDialog from "./upload-document-dialog";

const DocumentsList = () => {
  const { documents, nowIso, currentStaffName, can, aiConfigured } =
    useDocuments();

  const [queue, setQueue] = useState<DocumentQueue>("All Documents");
  const [savedView, setSavedView] = useState<DocumentSavedView>("All");
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  const [reviewItem, setReviewItem] = useState<DocumentListItem | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<DocumentListItem | null>(
    null,
  );
  const [requestOpen, setRequestOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<DocumentListItem | null>(
    null,
  );

  const groupOptions = useMemo(
    () =>
      [
        ...new Map(documents.map((d) => [d.groupId, d.groupName])).entries(),
      ].map(([value, label]) => ({ value, label })),
    [documents],
  );
  const branchOptions = useMemo(
    () =>
      [...new Set(documents.map((d) => d.branch).filter(Boolean))].map((b) => ({
        value: b,
        label: b,
      })),
    [documents],
  );
  const assigneeOptions = useMemo(
    () =>
      [
        ...new Set(
          documents
            .map((d) => d.assignedToName)
            .filter((n): n is string => !!n),
        ),
      ].map((n) => ({
        value: n,
        label: n,
      })),
    [documents],
  );

  const scored = useMemo(
    () => documents.map((d) => ({ ...d, priorityScore: scoreDocument(d) })),
    [documents],
  );

  /**
   * The saved view and the queue both narrow the list from state the hook
   * cannot key its memos on, so they are applied before it sees the rows.
   * See the purity contract in `hooks/use-filtered-rows.ts`.
   */
  const scopedDocuments = useMemo(
    () =>
      applySavedView(scored, savedView, currentStaffName).filter((item) =>
        matchesQueue(item, queue),
      ),
    [scored, savedView, queue, currentStaffName],
  );

  const list = useFilteredRows<DocumentListItem, DocumentFilters, DocumentSort>({
    rows: scopedDocuments,
    emptyFilters: EMPTY_DOCUMENT_FILTERS,
    initialSort: DEFAULT_DOCUMENT_SORT,
    searchPredicate: matchesDocumentSearch,
    matches: matchesDocumentFilters,
    sortRows: sortDocuments,
  });

  const { filters, setFilter, sort, setSort } = list;
  const sorted = list.rows;
  const kpis = useMemo(() => computeDocumentKpis(scored), [scored]);
  const alerts = useMemo(() => deriveCriticalAlerts(scored), [scored]);
  const groupBoards = useMemo(
    () => computeGroupDocumentBoards(scored),
    [scored],
  );

  const columns = useMemo(
    () =>
      buildDocumentColumns(sort, (s) => setSort(s as DocumentSort), nowIso, {
        onReview: (item) => setReviewItem(item),
        onSendWhatsapp: (item) =>
          window.open(whatsappLink(item.whatsappNumber), "_blank"),
        onAssign: (item) => setAssignTarget(item),
      }),
    [sort, setSort, nowIso],
  );

  const openAlert = (alert: CriticalAlert) => {
    setQueue((alert.queue as DocumentQueue) ?? "All Documents");
    if (alert.groupId) setFilter("groupId", alert.groupId);
    if (alert.documentType) setFilter("documentType", alert.documentType);
  };

  const openGroup = (groupId: string) => {
    setFilter("groupId", groupId);
    setQueue("All Documents");
  };

  const exportChecklist = () => {
    downloadTextFile(
      timestampedFilename("document-checklist"),
      documentsToChecklistCsv(sorted),
    );
    toast.add({
      title: "Export ready",
      description: `${sorted.length} document(s) exported.`,
    });
  };
  const exportVisaPack = () => {
    downloadTextFile(
      timestampedFilename("visa-submission-pack"),
      documentsToVisaPackCsv(sorted),
    );
    toast.add({ title: "Visa pack exported" });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={[
          { title: "Home", link: "/dashboard" },
          { title: "Operations", link: "/documents" },
          { title: "Documents", link: "/documents" },
        ]}
        title="Documents"
        subTitle="Review, verify, and resolve pilgrim document requirements across all groups."
        action={
          <div className="flex items-center gap-2">
            {can.uploadOnBehalf && (
              <Button
                variant="secondary"
                onClick={() => {
                  setUploadTarget(null);
                  setUploadOpen(true);
                }}
              >
                <Upload /> Upload Document
              </Button>
            )}
            {can.sendReminders && (
              <Button
                variant="outline_without_border"
                onClick={() => setRequestOpen(true)}
              >
                <MessageSquarePlus /> Request Documents
              </Button>
            )}
            {can.manageAgentSettings && (
              <Button
                variant="outline_without_border"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings /> Copilot Settings
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline_without_border">
                    <MoreVertical />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>More</DropdownMenuLabel>
                {can.exportChecklist && (
                  <DropdownMenuItem onClick={exportChecklist}>
                    <Download /> Export Document Checklist
                  </DropdownMenuItem>
                )}
                {can.exportVisaPack && (
                  <DropdownMenuItem onClick={exportVisaPack}>
                    <Download /> Export Visa Submission Pack
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <DocumentsMetrics
        kpis={kpis}
        activeQueue={queue}
        onQueueChange={setQueue}
        readOnly={can.readOnly}
      />

      <CriticalAlerts alerts={alerts} onOpen={openAlert} />

      <div className="">
        <div className="flex flex-col gap-4 min-w-0">
          <SavedViewBar
            views={DOCUMENT_QUEUES}
            active={queue}
            onChange={setQueue}
          />

          <SavedViewBar
            views={DOCUMENT_SAVED_VIEWS}
            active={savedView}
            onChange={setSavedView}
          />

          {!can.readOnly && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <FilterSelect
                  label="Departure Group"
                  value={filters.groupId}
                  options={groupOptions}
                  onChange={(v) => setFilter("groupId", v)}
                />
                <FilterSelect
                  label="Document Type"
                  value={filters.documentType}
                  options={DOCUMENT_TYPE_OPTIONS}
                  onChange={(v) => setFilter("documentType", v)}
                />
                <FilterSelect
                  label="Document Status"
                  value={filters.status}
                  options={[
                    { value: "NOT_SUBMITTED", label: "Missing" },
                    { value: "SUBMITTED", label: "Submitted" },
                    { value: "VERIFIED", label: "Verified" },
                    { value: "REJECTED", label: "Rejected" },
                    { value: "NOT_APPLICABLE", label: "Not Required" },
                  ]}
                  onChange={(v) => setFilter("status", v)}
                />
                <FilterSelect
                  label="AI Finding"
                  value={filters.aiFinding}
                  options={[
                    { value: "PASS", label: "Pass" },
                    { value: "WARNING", label: "Warning" },
                    { value: "BLOCKED", label: "Blocked" },
                  ]}
                  onChange={(v) => setFilter("aiFinding", v)}
                />
                <Button
                  variant="outline_without_border"
                  size="sm"
                  className="gap-1.5 text-muted-foreground bg-transparent dark:bg-transparent shadow-none!"
                  onClick={() => setShowMoreFilters((v) => !v)}
                >
                  <SlidersHorizontal className="size-3.5" /> More Filters{" "}
                  <ChevronDown />
                </Button>
                {activeFilterCount(filters) > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={list.clearFilters}
                  >
                    <X /> Clear filters
                  </Button>
                )}
              </div>

              {showMoreFilters && (
                <div className="flex flex-wrap items-center gap-2">
                  <FilterSelect
                    label="Assigned Reviewer"
                    value={filters.assignedTo}
                    options={assigneeOptions}
                    onChange={(v) => setFilter("assignedTo", v)}
                  />
                  <FilterSelect
                    label="Branch"
                    value={filters.branch}
                    options={branchOptions}
                    onChange={(v) => setFilter("branch", v)}
                  />
                </div>
              )}
            </>
          )}

          {queue === "By Group" ? (
            <GroupBoard boards={groupBoards} onOpenGroup={openGroup} />
          ) : (
            <div className={cn("transition-opacity duration-150", list.isStale && "opacity-60 pointer-events-none")}>
            <DocumentsDataTable
              columns={columns}
              data={sorted}
              search={list.search}
              onSearchChange={list.setSearch}
              onRowClick={(item) => setReviewItem(item)}
              resetPageToken={`${queue}-${savedView}-${list.resetPageToken}`}
              sort={{ field: sort.field, direction: sort.direction }}
              sortFieldByColumnId={{
                pilgrim: "fullName",
                departureGroup: "departureDate",
                due: "dueAt",
                updated: "lastActivityAt",
              }}
              bulkBar={
                can.bulkActions
                  ? (selected, clear) => (
                      <BulkActionsBar
                        selected={selected}
                        clear={clear}
                        can={can}
                      />
                    )
                  : undefined
              }
            />
            </div>
          )}
        </div>

        {/* <div className="hidden xl:block">
          <AiAgentPanel
            documents={documents}
            aiConfigured={aiConfigured}
            canRunScan={can.runAiScan}
            onOpenAiQueue={() => setQueue("AI Flagged")}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </div> */}
      </div>

      <ReviewDocumentSheet
        item={reviewItem}
        open={reviewItem !== null}
        onClose={() => setReviewItem(null)}
        can={can}
        aiConfigured={aiConfigured}
      />
      <UploadDocumentDialog
        documents={documents}
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        preselected={uploadTarget}
      />
      <RequestDocumentsSheet
        documents={documents}
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
      />
      <AgentSettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        aiConfigured={aiConfigured}
      />
      <AssignReviewerDialog
        documentIds={assignTarget ? [assignTarget.documentId] : []}
        itemsLabel={
          assignTarget ? `${assignTarget.name} — ${assignTarget.fullName}` : ""
        }
        currentAssignee={assignTarget?.assignedToName}
        open={assignTarget !== null}
        onClose={() => setAssignTarget(null)}
      />
    </div>
  );
};

export default DocumentsList;
