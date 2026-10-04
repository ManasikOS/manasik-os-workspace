"use client";

import { useMemo, useState } from "react";
import { LifeBuoy, TriangleAlert } from "lucide-react";

import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import { FilterMenu } from "@/components/data-table/filter-menu";
import { KpiCard } from "@/components/data-table/kpi-card";
import { Tabs, TabsList, TabsTrigger } from "@/components/animate-ui/components/animate/tabs";
import { EmptyState, ToneBadge } from "@/components/ui/tone-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { formatDateTime } from "@/app/(main)/departure-groups/utils";
import { updateSupportRequestStatusAction } from "@/app/(main)/pilgrims/actions";
import type { CrossPilgrimSupportRow } from "@/lib/data/support-repository";
import type {
  PilgrimSupportCategory,
  PilgrimSupportPriority,
  PilgrimSupportStatus,
} from "@/lib/types/pilgrims";
import { TONE_TEXT, type Tone } from "@/lib/ui/tone";

import {
  filterSupportCases,
  isSupportCaseOverdue,
  summariseSupportCases,
  type SupportCasePriorityFilter,
  type SupportCaseStatusFilter,
} from "../../support-cases";

const CATEGORY_LABELS: Record<PilgrimSupportCategory, string> = {
  MOBILITY: "Mobility",
  MEDICAL: "Medical",
  DIETARY: "Dietary",
  FLIGHT: "Flight",
  ROOMING: "Rooming",
  DOCUMENT: "Document",
  PAYMENT: "Payment",
  COMPLAINT: "Complaint",
  OTHER: "Other",
};

const PRIORITY_LABELS: Record<PilgrimSupportPriority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};

const PRIORITY_TONE: Record<PilgrimSupportPriority, Tone> = {
  LOW: "neutral",
  NORMAL: "info",
  HIGH: "warning",
  URGENT: "danger",
};

const STATUS_LABELS: Record<PilgrimSupportStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  RESOLVED: "Resolved",
  CANCELLED: "Cancelled",
};

const STATUS_TONE: Record<PilgrimSupportStatus, Tone> = {
  OPEN: "danger",
  IN_PROGRESS: "warning",
  RESOLVED: "success",
  CANCELLED: "neutral",
};

interface SupportCasesQueueProps {
  requests: CrossPilgrimSupportRow[];
  canManage: boolean;
}

/**
 * Cross-pilgrim support case triage. Cases are raised and detailed on each
 * pilgrim's own Support tab; this queue only reads across them and changes a
 * case's status through the existing `updateSupportRequestStatusAction`, which
 * enforces its own permission check.
 */
export default function SupportCasesQueue({ requests, canManage }: SupportCasesQueueProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<SupportCaseStatusFilter>("OPEN_ALL");
  const [priority, setPriority] = useState<SupportCasePriorityFilter>("ALL");
  const [now] = useState(() => Date.now());

  const filtered = useMemo(
    () => filterSupportCases(requests, { search, status, priority }),
    [requests, search, status, priority],
  );
  const summary = useMemo(() => summariseSupportCases(requests, now), [requests, now]);

  const changeStatus = async (row: CrossPilgrimSupportRow, next: PilgrimSupportStatus) => {
    const result = await updateSupportRequestStatusAction({
      pilgrimId: row.pilgrimId,
      requestId: row.id,
      status: next,
    });
    if (!result.ok) {
      toast.add({ title: "Could not update case", description: result.error });
      return;
    }
    toast.add({ title: `Case marked ${STATUS_LABELS[next].toLowerCase()}` });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <KpiCard title="Open" value={String(summary.open)} />
        <KpiCard
          title="Urgent, unresolved"
          value={String(summary.urgentUnresolved)}
          desc={
            summary.urgentUnresolved > 0 ? (
              <span className="flex items-center gap-1 text-destructive">
                <TriangleAlert className="size-3" /> Needs immediate attention
              </span>
            ) : undefined
          }
        />
        <KpiCard title="In progress" value={String(summary.inProgress)} />
        <KpiCard title="Resolved" value={String(summary.resolved)} />
        <KpiCard
          title="Overdue (SLA)"
          value={String(summary.overdue)}
          desc={
            summary.overdue > 0 ? (
              <span className="flex items-center gap-1 text-destructive">
                <TriangleAlert className="size-3" /> Past their SLA due date
              </span>
            ) : undefined
          }
        />
      </div>

      <Tabs value={status} onValueChange={(value) => setStatus(value as SupportCaseStatusFilter)}>
        <TabsList>
          {(["OPEN_ALL", "OPEN", "IN_PROGRESS", "RESOLVED", "CANCELLED", "ALL"] as const).map((key) => (
            <TabsTrigger key={key} value={key}>
              {key === "OPEN_ALL" ? "Open + In Progress" : key === "ALL" ? "All" : STATUS_LABELS[key]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DataTableSurface
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search title, pilgrim, or group…"
        rowCount={filtered.length}
        toolbar={
          <FilterMenu
            groups={[{
              key: "priority",
              label: "Priority",
              value: priority,
              options: (["URGENT", "HIGH", "NORMAL", "LOW"] as const).map((value) => ({ value, label: PRIORITY_LABELS[value] })),
            }]}
            onChange={(_key, value) => setPriority(value as SupportCasePriorityFilter)}
            onClear={() => setPriority("ALL")}
          />
        }
      >
        {filtered.length === 0 ? (
          <EmptyState
            icon={<LifeBuoy className="size-8" />}
            title="No cases found"
            description="Try a different search or filter."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-none!">
                {["Case", "Pilgrim", "Group", "Category", "Priority", "SLA", "Status", ...(canManage ? [""] : [])].map(
                  (label) => (
                    <TableHead key={label} className="h-9 px-3 text-xs font-medium text-muted-foreground">
                      {label}
                    </TableHead>
                  ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-border/20">
              {filtered.map((r) => (
                <TableRow
                  key={r.id}
                  className="hover:bg-muted/40 cursor-pointer"
                  onClick={() => router.push(`/pilgrims/${r.pilgrimId}?tab=support`)}
                >
                  <TableCell className="px-3 py-3">
                    <p className="text-sm text-foreground">{r.title}</p>
                    {r.raisedByPortal && (
                      <p className="text-[11px] text-muted-foreground">Raised via pilgrim portal</p>
                    )}
                    {r.escalatedToRole && (
                      <p className={`text-[11px] ${TONE_TEXT.warning}`}>Escalated to {r.escalatedToRole}</p>
                    )}
                    {r.supplierName && (
                      <p className="text-[11px] text-muted-foreground">Supplier: {r.supplierName}</p>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-sm text-foreground">{r.pilgrimName}</TableCell>
                  <TableCell className="px-3 py-3 text-xs text-foreground">
                    {r.groupName ? (
                      <>
                        {r.groupName} <span className="text-muted-foreground">· {r.groupCode}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs text-foreground">{CATEGORY_LABELS[r.category]}</TableCell>
                  <TableCell className="px-3 py-3">
                    <ToneBadge tone={PRIORITY_TONE[r.priority]} label={PRIORITY_LABELS[r.priority]} />
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs">
                    {r.slaDueAt ? (
                      <span className={isSupportCaseOverdue(r, now) ? "text-destructive" : "text-foreground"}>
                        {formatDateTime(r.slaDueAt)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-3">
                    <ToneBadge tone={STATUS_TONE[r.status]} label={STATUS_LABELS[r.status]} />
                  </TableCell>
                  {canManage && (
                    <TableCell className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      {r.status !== "RESOLVED" && r.status !== "CANCELLED" && (
                        <Select
                          value={r.status}
                          onValueChange={(value) => changeStatus(r, value as PilgrimSupportStatus)}
                        >
                          <SelectTrigger className="h-8 w-36 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="OPEN">Open</SelectItem>
                            <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                            <SelectItem value="RESOLVED">Resolved</SelectItem>
                            <SelectItem value="CANCELLED">Cancelled</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DataTableSurface>
    </div>
  );
}
