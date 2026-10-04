"use client";

import PageHeader from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { KpiCard, KpiRow } from "@/components/data-table/kpi-card";
import { SavedViewBar } from "@/components/data-table/saved-view-bar";
import { FilterMenu } from "@/components/data-table/filter-menu";
import { DataTable } from "@/components/data-table/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import {
  DollarSign,
  Download,
  FileWarning,
  Import,
  MoreVertical,
  Plus,
  TicketX,
  Users,
} from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useMemo, useState } from "react";

import { useFilteredRows } from "@/hooks/use-filtered-rows";
import { cn } from "@/lib/utils";
import { TONE_TEXT } from "@/lib/ui/tone";

import { computePilgrimKpis } from "@/lib/data/pilgrims";
import { usePilgrims } from "../pilgrims-store";
import {
  EMPTY_PILGRIM_FILTERS,
  PILGRIM_SAVED_VIEWS,
  type PilgrimFilters,
  type PilgrimListItem,
  type PilgrimSavedView,
} from "../types";
import {
  DEFAULT_PILGRIM_SORT,
  FLIGHT_STATUS_LABELS,
  JOURNEY_TYPE_LABELS,
  PAYMENT_STATUS_LABELS,
  ROOM_STATUS_LABELS,
  VISA_STATUS_LABELS,
  applySavedView,
  matchesPilgrimFilters,
  matchesPilgrimSearch,
  sortPilgrims,
  whatsappLink,
  type PilgrimSort,
} from "../utils";
import { buildPilgrimColumns } from "../pilgrims-table/pilgrims-columns";
import { downloadTextFile, pilgrimsToCsv, timestampedFilename } from "../csv";
import AddPilgrimDialog from "./add-pilgrim-dialog";
import { sendPaymentReminderAction } from "../actions";

const PilgrimsList = () => {
  const { pilgrims, currentStaffName, can } = usePilgrims();
  const router = useRouter();

  const [savedView, setSavedView] = useState<PilgrimSavedView>(
    "All Active Pilgrims",
  );
  const [quickFilter, setQuickFilter] = useState<
    | "documentsPending"
    | "visaIssues"
    | "paymentAttention"
    | "readyToTravel"
    | null
  >(null);
  const [addOpen, setAddOpen] = useState(false);

  const groupOptions = useMemo(
    () =>
      [...new Map(pilgrims.map((p) => [p.groupId, p.groupName])).entries()].map(
        ([value, label]) => ({ value, label }),
      ),
    [pilgrims],
  );
  const branchOptions = useMemo(
    () =>
      [...new Set(pilgrims.map((p) => p.branch).filter(Boolean))].map((b) => ({
        value: b,
        label: b,
      })),
    [pilgrims],
  );

  /**
   * The saved view and the quick filter both narrow the list from state the
   * hook cannot key its memos on, so they are applied before it sees the
   * rows. See the purity contract in `hooks/use-filtered-rows.ts`.
   */
  const scopedPilgrims = useMemo(() => {
    const viewed = applySavedView(pilgrims, savedView, currentStaffName);
    return viewed.filter((item) => {
      if (
        quickFilter === "documentsPending" &&
        item.documentsCompleted >= item.documentsRequired
      )
        return false;
      if (
        quickFilter === "visaIssues" &&
        !["REJECTED", "REWORK_REQUIRED"].includes(item.visaStatus)
      )
        return false;
      if (
        quickFilter === "paymentAttention" &&
        item.paymentStatus !== "OVERDUE" &&
        item.outstandingBalance <= 0
      )
        return false;
      if (
        quickFilter === "readyToTravel" &&
        item.journeyStatus !== "READY_TO_TRAVEL"
      )
        return false;
      return true;
    });
  }, [pilgrims, savedView, quickFilter, currentStaffName]);

  const list = useFilteredRows<PilgrimListItem, PilgrimFilters, PilgrimSort>({
    rows: scopedPilgrims,
    emptyFilters: EMPTY_PILGRIM_FILTERS,
    initialSort: DEFAULT_PILGRIM_SORT,
    searchPredicate: matchesPilgrimSearch,
    matches: matchesPilgrimFilters,
    sortRows: sortPilgrims,
  });

  const { filters, setFilter, sort, setSort } = list;
  const sorted = list.rows;
  const kpis = useMemo(() => computePilgrimKpis(sorted), [sorted]);

  const columns = useMemo(
    () =>
      buildPilgrimColumns(sort, (s) => setSort(s as PilgrimSort), {
        onOpen: (item) => router.push(`/pilgrims/${item.pilgrimId}`),
        onSendWhatsapp: (item) =>
          window.open(whatsappLink(item.whatsappNumber), "_blank"),
        onSendPaymentReminder: async (item) => {
          await sendPaymentReminderAction({
            pilgrimId: item.pilgrimId,
            departureGroupId: item.groupId,
            amountDue: item.outstandingBalance,
          });
          toast.add({
            title: "Reminder logged",
            description: `Recorded for ${item.fullName}.`,
          });
        },
      }),
    [sort, setSort, router],
  );

  const exportCsv = () => {
    downloadTextFile(timestampedFilename("pilgrims"), pilgrimsToCsv(sorted));
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={[
          { title: "Home", link: "/dashboard" },
          { title: "Pilgrims", link: "/pilgrims" },
        ]}
        title="Pilgrims"
        subTitle="Manage traveller records, documents, visas, payments, and journey readiness."
        action={
          <div className="flex items-center gap-2">
            {can.createPilgrim && (
              <Button onClick={() => setAddOpen(true)}>
                <Plus /> Add Pilgrim
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
                <DropdownMenuItem onClick={exportCsv}>
                  <Download /> Export CSV
                </DropdownMenuItem>
                {can.createPilgrim && (
                  <DropdownMenuItem
                    onClick={() =>
                      toast.add({
                        title: "Import Pilgrims",
                        description: "Coming soon — use Add Pilgrim for now.",
                      })
                    }
                  >
                    <Import /> Import Pilgrims
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <KpiRow>
        <KpiCard
          icon={<Users className="size-4 text-muted-foreground" />}
          title="Active Pilgrims"
          value={String(kpis.activePilgrims)}
          desc="Across active Hajj and Umrah groups"
          onSelect={() => setQuickFilter(null)}
          selected={quickFilter === null}
        />
        <KpiCard
          icon={<FileWarning className={cn("size-4", TONE_TEXT.warning)} />}
          title="Documents Pending"
          value={String(kpis.documentsPending)}
          desc="Requires action"
          onSelect={() =>
            setQuickFilter(
              quickFilter === "documentsPending" ? null : "documentsPending",
            )
          }
          selected={quickFilter === "documentsPending"}
        />
        <KpiCard
          title="Visa Issues"
          icon={<TicketX className="size-4 text-destructive" />}
          value={String(kpis.visaIssues)}
          desc="Pending, rejected, or rework required"
          onSelect={() =>
            setQuickFilter(quickFilter === "visaIssues" ? null : "visaIssues")
          }
          selected={quickFilter === "visaIssues"}
        />
        <KpiCard
          title="Payment Attention"
          icon={<DollarSign className="size-4 text-muted-foreground" />}
          value={String(kpis.paymentAttention)}
          desc="Overdue or below threshold"
          onSelect={() =>
            setQuickFilter(
              quickFilter === "paymentAttention" ? null : "paymentAttention",
            )
          }
          selected={quickFilter === "paymentAttention"}
        />
        {/* <KpiCard
          title="Ready to Travel"
          value={String(kpis.readyToTravel)}
          desc="Across upcoming groups"
          onSelect={() =>
            setQuickFilter(
              quickFilter === "readyToTravel" ? null : "readyToTravel",
            )
          }
          selected={quickFilter === "readyToTravel"}
        /> */}
      </KpiRow>

      <SavedViewBar
        views={PILGRIM_SAVED_VIEWS}
        active={savedView}
        onChange={setSavedView}
      />

      <div
        className={cn(
          "transition-opacity duration-150",
          list.isStale && "opacity-60 pointer-events-none",
        )}
      >
        <DataTable<PilgrimListItem>
          columns={columns}
          data={sorted}
          search={list.search}
          onSearchChange={list.setSearch}
          searchPlaceholder="Search by name, passport number, WhatsApp, email, pilgrim ID…"
          toolbar={
            <FilterMenu<keyof PilgrimFilters>
              groups={[
                {
                  key: "departureGroupId",
                  label: "Departure Group",
                  value: filters.departureGroupId,
                  options: groupOptions,
                },
                {
                  key: "journeyType",
                  label: "Journey Type",
                  value: filters.journeyType,
                  options: Object.entries(JOURNEY_TYPE_LABELS).map(
                    ([value, label]) => ({ value, label }),
                  ),
                },
                {
                  key: "documentStatus",
                  label: "Document Status",
                  value: filters.documentStatus,
                  options: [
                    { value: "COMPLETE", label: "Complete" },
                    { value: "MISSING", label: "Missing" },
                  ],
                },
                {
                  key: "visaStatus",
                  label: "Visa Status",
                  value: filters.visaStatus,
                  options: Object.entries(VISA_STATUS_LABELS).map(
                    ([value, label]) => ({ value, label }),
                  ),
                },
                {
                  key: "paymentStatus",
                  label: "Payment Status",
                  value: filters.paymentStatus,
                  options: Object.entries(PAYMENT_STATUS_LABELS).map(
                    ([value, label]) => ({ value, label }),
                  ),
                },
                {
                  key: "readiness",
                  label: "Readiness",
                  value: filters.readiness,
                  options: [
                    { value: "READY", label: "Ready" },
                    { value: "AT_RISK", label: "At Risk" },
                    { value: "BLOCKED", label: "Blocked" },
                  ],
                },
                {
                  key: "roomAssignment",
                  label: "Room Assignment",
                  value: filters.roomAssignment,
                  options: Object.entries(ROOM_STATUS_LABELS).map(
                    ([value, label]) => ({ value, label }),
                  ),
                },
                {
                  key: "flightStatus",
                  label: "Flight/Ticket Status",
                  value: filters.flightStatus,
                  options: Object.entries(FLIGHT_STATUS_LABELS).map(
                    ([value, label]) => ({ value, label }),
                  ),
                },
                {
                  key: "branch",
                  label: "Branch",
                  value: filters.branch,
                  options: branchOptions,
                },
              ]}
              onChange={setFilter}
              onClear={list.clearFilters}
            />
          }
          onRowClick={(item) => router.push(`/pilgrims/${item.pilgrimId}`)}
          getRowId={(item) => item.journeyId}
          resetPageToken={`${savedView}-${quickFilter}-${list.resetPageToken}`}
          sort={{ field: sort.field, direction: sort.direction }}
          sortFieldByColumnId={{
            pilgrim: "fullName",
            departureGroup: "departureDate",
            documents: "documentPercent",
            payments: "outstandingBalance",
          }}
        />
      </div>
      <AddPilgrimDialog open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
};

export default PilgrimsList;
