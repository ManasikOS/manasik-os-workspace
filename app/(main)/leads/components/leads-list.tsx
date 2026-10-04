"use client";

import PageHeader from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { colomboDayDiff, type CreateLeadInput } from "@/lib/data/leads";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  Import,
  MoreVertical,
  PhoneCall,
  Plus,
  Radio,
  Sparkles,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import React, { useMemo, useState } from "react";

import { useFilteredRows } from "@/hooks/use-filtered-rows";
import { FilterMenu } from "@/components/data-table/filter-menu";
import type { FilterOption } from "@/components/data-table/filter-select";
import {
  DataTable,
  type DataTableSort,
} from "@/components/data-table/data-table";
import { KpiCard, KpiRow } from "@/components/data-table/kpi-card";
import { SavedViewBar } from "@/components/data-table/saved-view-bar";

import AddNewLead from "../add-new-lead/add-new-lead";
import { downloadTextFile, leadsToCsv, timestampedFilename } from "../csv";
import { useLeads } from "../leads-store";
import {
  buildLeadColumns,
  LEAD_COLUMN_SORT_FIELDS,
} from "../leads-table/leads-columns";
import LeadTableSorting from "../leads-table/lead-table-sorting";
import {
  EMPTY_LEAD_FILTERS,
  LEAD_SAVED_VIEWS,
  type LeadFilters,
  type LeadListItem,
  type LeadLostReason,
  type LeadSavedView,
  type LeadStage,
} from "../types";
import {
  ACTIVE_STAGE_ORDER,
  DEFAULT_LEAD_SORT,
  FOLLOW_UP_STATUS_LABELS,
  JOURNEY_TYPE_LABELS,
  SOURCE_LABELS,
  STAGE_LABELS,
  TEMPERATURE_LABELS,
  applySavedView,
  computeLeadKpis,
  formatCurrencyLKR,
  matchesLeadFilters,
  matchesLeadSearch,
  sortLabel,
  sortLeads,
  type LeadSort,
} from "../utils";
import type { QuickFilter } from "../types";
import ImportLeadsDialog from "./import-leads-dialog";
import LeadDrawer from "./lead-drawer";
import LogContactDialog, {
  type LogContactSubmission,
} from "./log-contact-dialog";
import ManageLeadSourcesSheet from "./manage-lead-sources-sheet";
import MarkLostDialog from "./mark-lost-dialog";
import { UserAdd2, PhoneOutgoing } from "reicon-react";

function matchesQuickFilter(
  lead: LeadListItem,
  quickFilter: QuickFilter | null,
  nowIso: string,
): boolean {
  switch (quickFilter) {
    case "new":
      return colomboDayDiff(lead.createdAt, nowIso) <= 30;
    case "contacted":
      return lead.stage !== "NEW_LEAD";
    case "overdue":
      return lead.followUpStatus === "OVERDUE";
    case "booked":
      return lead.stage === "BOOKED";
    default:
      return true;
  }
}

const LeadsList = () => {
  const {
    leads,
    store,
    nowIso,
    currentStaffId,
    can,
    changeStage,
    assignLeads,
    logContact,
    importLeads,
    staffOptions,
  } = useLeads();

  const [savedView, setSavedView] = useState<LeadSavedView>("All Leads");
  const [quickFilter, setQuickFilter] = useState<QuickFilter | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  // Deep link from other modules — e.g. /quotes links to `/leads?open=<id>`
  // to open a lead's drawer directly instead of only landing on the list.
  // Read once, lazily, as the initial value — not in an effect — so this is
  // a plain render-time derivation rather than a synchronised external state.
  const searchParams = useSearchParams();
  const [openLeadId, setOpenLeadId] = useState<string | null>(() => searchParams.get("open"));
  const [contactLeadId, setContactLeadId] = useState<string | null>(null);
  const [lostLeadIds, setLostLeadIds] = useState<string[] | null>(null);

  /* Options come from the leads actually present, so a city or owner with no
     leads never appears as a dead-end filter. */
  const cityOptions = useMemo<FilterOption[]>(
    () =>
      [...new Set(leads.map((lead) => lead.city))]
        .sort()
        .map((city) => ({ value: city, label: city })),
    [leads],
  );

  const ownerOptions = useMemo<FilterOption[]>(
    () =>
      staffOptions
        .filter((staff) => leads.some((lead) => lead.assignedToId === staff.id))
        .map((staff) => ({ value: staff.id, label: staff.name })),
    [leads, staffOptions],
  );

  const packageOptions = useMemo<FilterOption[]>(
    () =>
      store.packages
        .filter((pkg) => leads.some((lead) => lead.packageId === pkg.id))
        .map((pkg) => ({ value: pkg.id, label: pkg.name })),
    [leads, store.packages],
  );

  /**
   * The saved view and the quick filter both narrow the list from state the
   * hook cannot key its memos on, so they are applied before it sees the
   * rows. See the purity contract in `hooks/use-filtered-rows.ts`.
   */
  const scopedLeads = useMemo(
    () =>
      applySavedView(leads, savedView, currentStaffId, nowIso).filter((lead) =>
        matchesQuickFilter(lead, quickFilter, nowIso),
      ),
    [leads, savedView, quickFilter, currentStaffId, nowIso],
  );

  const list = useFilteredRows<LeadListItem, LeadFilters, LeadSort>({
    rows: scopedLeads,
    emptyFilters: EMPTY_LEAD_FILTERS,
    initialSort: DEFAULT_LEAD_SORT,
    searchPredicate: matchesLeadSearch,
    matches: matchesLeadFilters,
    sortRows: sortLeads,
  });

  const { filters, setFilter, sort, setSort } = list;
  const sorted = list.rows;
  const kpis = useMemo(() => computeLeadKpis(sorted, nowIso), [sorted, nowIso]);

  // Live lookups rather than stored copies: after a mutation the drawer and the
  // dialogs must show the updated lead, not the snapshot they were opened with.
  const openLead = leads.find((lead) => lead.id === openLeadId) ?? null;
  const contactLead = leads.find((lead) => lead.id === contactLeadId) ?? null;
  const lostLeads = lostLeadIds
    ? leads.filter((lead) => lostLeadIds.includes(lead.id))
    : null;

  const filterCount = list.activeFilterCount;

  /* ── Handlers ───────────────────────────────────────────────────────────── */

  const handleQuickFilter = (filter: QuickFilter) =>
    setQuickFilter((current) => (current === filter ? null : filter));

  const handleChangeStage = async (lead: LeadListItem, stage: LeadStage) => {
    if (stage === "LOST") {
      setLostLeadIds([lead.id]);
      return;
    }
    const result = await changeStage([lead.id], stage);
    if (!result.ok) {
      toast.add({ title: "Could not update lead", description: result.error });
      return;
    }
    toast.add({
      title: `Moved to ${STAGE_LABELS[stage]}`,
      description: `${lead.name} · ${lead.reference}`,
    });
  };

  const handleAssign = async (lead: LeadListItem, staffId: string) => {
    const result = await assignLeads([lead.id], staffId);
    if (!result.ok) {
      toast.add({
        title: "Could not reassign lead",
        description: result.error,
      });
      return;
    }
    toast.add({
      title: "Lead reassigned",
      description: `${lead.name} → ${
        staffOptions.find((staff) => staff.id === staffId)?.name ?? "Unassigned"
      }`,
    });
  };

  const handleLogContact = async (
    lead: LeadListItem,
    submission: LogContactSubmission,
  ) => {
    const result = await logContact({
      leadId: lead.id,
      summary: submission.summary,
      nextFollowUpAt: submission.nextFollowUpAt,
      followUpType: submission.followUpType,
      advanceToStage: submission.advanceToStage,
    });

    if (!result.ok) {
      toast.add({ title: "Could not log contact", description: result.error });
      return;
    }

    setContactLeadId(null);
    toast.add({
      title: "Contact logged",
      description: submission.nextFollowUpAt
        ? `${lead.name}: next follow-up scheduled.`
        : `${lead.name}: no follow-up scheduled.`,
    });
  };

  const handleMarkLost = async (
    targets: LeadListItem[],
    reason: LeadLostReason,
    note: string,
  ) => {
    const result = await changeStage(
      targets.map((lead) => lead.id),
      "LOST",
      { lostReason: reason, lostNote: note },
    );

    if (!result.ok) {
      toast.add({ title: "Could not update leads", description: result.error });
      return;
    }

    setLostLeadIds(null);
    toast.add({
      title: `${result.changed} lead${result.changed === 1 ? "" : "s"} marked lost`,
      description: targets.map((lead) => lead.reference).join(", "),
    });
  };

  const handleImport = async (rows: CreateLeadInput[]) => {
    const result = await importLeads(rows);
    toast.add({
      title: `${result.created} lead${result.created === 1 ? "" : "s"} imported`,
      description:
        result.failures.length > 0
          ? `${result.failures.length} row${result.failures.length === 1 ? "" : "s"} could not be created.`
          : "All rows imported successfully.",
    });
  };

  /**
   * Exports exactly what is on screen — the current saved view, filters, search
   * and sort — so the file matches what the operator is looking at rather than
   * the unfiltered set.
   */
  const exportLeads = () => {
    if (sorted.length === 0) {
      toast.add({
        title: "Nothing to export",
        description: "No leads match the current filters.",
      });
      return;
    }

    downloadTextFile(timestampedFilename("leads"), leadsToCsv(sorted));
    toast.add({
      title: "Export ready",
      description: `${sorted.length} lead${sorted.length === 1 ? "" : "s"} exported to CSV.`,
    });
  };

  const columns = useMemo(
    () =>
      buildLeadColumns(
        {
          onOpen: (lead) => setOpenLeadId(lead.id),
          onLogContact: (lead) => setContactLeadId(lead.id),
          onChangeStage: handleChangeStage,
          onAssign: handleAssign,
          onMarkLost: (lead) => setLostLeadIds([lead.id]),
        },
        sort,
        (s) => setSort(s as LeadSort),
        staffOptions,
      ),
    // `handleChangeStage` and `handleAssign` close over `changeStage` /
    // `assignLeads`, which the store keeps stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sort, changeStage, assignLeads, staffOptions],
  );

  return (
    <>
      <AddNewLead open={addOpen} setOpen={setAddOpen} />

      <ImportLeadsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        existingLeads={leads}
        defaultAssigneeId={currentStaffId}
        defaultAssigneeName={
          staffOptions.find((staff) => staff.id === currentStaffId)?.name ??
          "Staff"
        }
        packages={store.packages}
        staffOptions={staffOptions}
        onImport={handleImport}
      />

      <ManageLeadSourcesSheet
        open={sourcesOpen}
        onOpenChange={setSourcesOpen}
        sources={store.sources}
        onChanged={() => {
          toast.add({ title: "Source updated" });
        }}
      />

      <LeadDrawer
        lead={openLead}
        onClose={() => setOpenLeadId(null)}
        onChangeStage={handleChangeStage}
        onAssign={handleAssign}
        onLogContact={(lead) => setContactLeadId(lead.id)}
        onMarkLost={(lead) => setLostLeadIds([lead.id])}
      />

      <LogContactDialog
        lead={contactLead}
        onClose={() => setContactLeadId(null)}
        onSubmit={handleLogContact}
      />

      <MarkLostDialog
        leads={lostLeads}
        onClose={() => setLostLeadIds(null)}
        onConfirm={handleMarkLost}
      />

      <div className="flex flex-col gap-6">
        <PageHeader
          subTitle="Track enquiries from first contact to confirmed booking"
          title="Leads"
          breadcrumb={[
            { title: "Home", link: "/dashboard" },
            { title: "Leads", link: "/leads" },
          ]}
          action={
            <div className="flex items-center gap-2">
              {can.createLead && (
                <Button onClick={() => setAddOpen(true)}>
                  <Plus /> Add Lead
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
                  {can.createLead && (
                    <DropdownMenuItem onClick={() => setImportOpen(true)}>
                      <Import /> Import Leads
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={exportLeads}>
                    <Download /> Export Leads
                  </DropdownMenuItem>
                  {can.manageSourcesAndAutomation && (
                    <DropdownMenuItem onClick={() => setSourcesOpen(true)}>
                      <Radio /> Manage Lead Sources
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => setSavedView("Duplicate Review")}
                  >
                    <Copy /> Duplicate Review Queue
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          }
        />
        <KpiRow columns={can.viewPipelineValue ? 3 : 4}>
          <KpiCard
            icon={<UserAdd2 className="size-5 text-muted-foreground" />}
            title="New Leads (30d)"
            value={String(kpis.newLeads)}
            desc={
              kpis.newLeadsDeltaPct === null
                ? `of ${sorted.length} lead${sorted.length === 1 ? "" : "s"} in view`
                : `${kpis.newLeadsDeltaPct >= 0 ? "+" : ""}${kpis.newLeadsDeltaPct}% vs previous 30 days`
            }
            onSelect={() => handleQuickFilter("new")}
            selected={quickFilter === "new"}
          />
          <KpiCard
            icon={<PhoneOutgoing className="size-5 text-muted-foreground" />}
            title="Contacted"
            value={`${kpis.contacted}/${sorted.length}`}
            desc={`${kpis.contactRate}% first-contact rate`}
            onSelect={() => handleQuickFilter("contacted")}
            selected={quickFilter === "contacted"}
          />

          <KpiCard
            icon={
              <AlertCircle
                className={cn(
                  "size-4",
                  kpis.overdueFollowUps > 0
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              />
            }
            title="Follow-up Overdue"
            value={String(kpis.overdueFollowUps)}
            desc={
              <span
                className={
                  kpis.overdueFollowUps > 0 ? "text-destructive" : undefined
                }
              >
                {kpis.overdueFollowUps > 0
                  ? `Needs action${kpis.dueToday > 0 ? ` · ${kpis.dueToday} due today` : ""}`
                  : kpis.dueToday > 0
                    ? `${kpis.dueToday} due today`
                    : "Nothing overdue"}
              </span>
            }
            onSelect={() => handleQuickFilter("overdue")}
            selected={quickFilter === "overdue"}
          />
          <KpiCard
            icon={<CheckCircle2 className="size-4 text-muted-foreground" />}
            title="Booked"
            value={String(kpis.booked)}
            desc={`${kpis.conversionRate}% conversion rate`}
            onSelect={() => handleQuickFilter("booked")}
            selected={quickFilter === "booked"}
          />
          {can.viewPipelineValue && (
            <KpiCard
              icon={<TrendingUp className="size-4 text-muted-foreground" />}
              title="Estimated Pipeline Value"
              value={formatCurrencyLKR(kpis.openPipelineLkr)}
              desc="Open leads, not yet booked"
            />
          )}
        </KpiRow>

        <SavedViewBar
          views={LEAD_SAVED_VIEWS}
          active={savedView}
          onChange={setSavedView}
        />

        <div className="flex items-center justify-between gap-4 w-full">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold tracking-tight text-foreground">
              {savedView}
            </h2>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-sm bg-primary/10 text-primary font-number">
              {sorted.length} of {leads.length}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            Sorted by {sortLabel(sort).toLowerCase()}
          </span>
        </div>

        <div
          className={cn(
            "transition-opacity duration-150",
            list.isStale && "opacity-60 pointer-events-none",
          )}
        >
          <DataTable<LeadListItem>
            columns={columns}
            data={sorted}
            search={list.search}
            onSearchChange={list.setSearch}
            searchPlaceholder="Search by name, mobile, email, lead ID, package…"
            onRowClick={(lead) => setOpenLeadId(lead.id)}
            getRowId={(lead) => lead.id}
            enableRowSelection
            rowsAreButtons
            rowAriaLabel={(lead) => `Open ${lead.name}, ${lead.reference}`}
            sort={sort as DataTableSort}
            sortFieldByColumnId={LEAD_COLUMN_SORT_FIELDS}
            // Any change that reshuffles the rows sends the table back to page one.
            resetPageToken={`${savedView}|${quickFilter}|${list.resetPageToken}`}
            emptyMessage={
              list.search
                ? `No leads matching "${list.search}"`
                : filterCount > 0 || quickFilter
                  ? "No leads match these filters."
                  : savedView === "All Leads"
                    ? "No leads yet — add your first one."
                    : `Nothing in "${savedView}".`
            }
            toolbar={
              <div className="flex flex-wrap items-center justify-end gap-2">
                <FilterMenu<keyof LeadFilters>
                  groups={[
                    {
                      key: "stage",
                      label: "Stage",
                      value: filters.stage,
                      options: ACTIVE_STAGE_ORDER.concat([
                        "LOST",
                        "POSTPONED",
                        "DUPLICATE",
                        "SPAM",
                      ]).map((stage) => ({
                        value: stage,
                        label: STAGE_LABELS[stage],
                      })),
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
                      key: "packageId",
                      label: "Package",
                      value: filters.packageId,
                      options: packageOptions,
                    },
                    {
                      key: "followUp",
                      label: "Follow-up",
                      value: filters.followUp,
                      options: Object.entries(FOLLOW_UP_STATUS_LABELS).map(
                        ([value, label]) => ({ value, label }),
                      ),
                    },
                    {
                      key: "assignedTo",
                      label: "Owner",
                      value: filters.assignedTo,
                      options: ownerOptions,
                    },
                    {
                      key: "temperature",
                      label: "Temperature",
                      value: filters.temperature,
                      options: Object.entries(TEMPERATURE_LABELS).map(
                        ([value, label]) => ({ value, label }),
                      ),
                    },
                    {
                      key: "source",
                      label: "Source",
                      value: filters.source,
                      options: Object.entries(SOURCE_LABELS).map(
                        ([value, label]) => ({ value, label }),
                      ),
                    },
                    {
                      key: "city",
                      label: "City",
                      value: filters.city,
                      options: cityOptions,
                    },
                  ]}
                  additionalActiveCount={quickFilter ? 1 : 0}
                  onChange={setFilter}
                  onClear={() => {
                    list.clearFilters();
                    setQuickFilter(null);
                  }}
                />
                <LeadTableSorting sort={sort} onChange={setSort} />
              </div>
            }
            bulkBar={
              can.changeStage || can.assignLeads
                ? (selected, clear) => (
                    <>
                      {can.changeStage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="sm">
                                Move to stage <ChevronDown />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="start">
                            {ACTIVE_STAGE_ORDER.map((stage) => (
                              <DropdownMenuItem
                                key={stage}
                                onClick={async () => {
                                  const result = await changeStage(
                                    selected.map((lead) => lead.id),
                                    stage,
                                  );
                                  clear();
                                  toast.add({
                                    title: `${result.changed} lead${
                                      result.changed === 1 ? "" : "s"
                                    } moved to ${STAGE_LABELS[stage]}`,
                                  });
                                }}
                              >
                                {STAGE_LABELS[stage]}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}

                      {can.assignLeads && (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="sm">
                                <UserCheck /> Reassign <ChevronDown />
                              </Button>
                            }
                          />
                          <DropdownMenuContent align="start">
                            {staffOptions.map((staff) => (
                              <DropdownMenuItem
                                key={staff.id}
                                onClick={async () => {
                                  const result = await assignLeads(
                                    selected.map((lead) => lead.id),
                                    staff.id,
                                  );
                                  clear();
                                  toast.add({
                                    title: `${result.changed} lead${
                                      result.changed === 1 ? "" : "s"
                                    } reassigned to ${staff.name}`,
                                  });
                                }}
                              >
                                {staff.name}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}

                      {can.changeStage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() =>
                            setLostLeadIds(selected.map((lead) => lead.id))
                          }
                        >
                          <Ban /> Mark lost
                        </Button>
                      )}
                    </>
                  )
                : undefined
            }
          />
        </div>
      </div>
    </>
  );
};

export default LeadsList;
