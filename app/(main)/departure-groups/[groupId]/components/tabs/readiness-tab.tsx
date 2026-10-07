"use client";

import SectionHeading from "@/components/section-heading";
import { useDepartureCapabilities } from "@/app/(main)/departure-groups/capabilities-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { type StaffRole } from "@/lib/access/departure-groups-access";
import { cn } from "@/lib/utils";
import {
  Ban,
  CheckCircle2,
  FileText,
  Loader2,
  Lock,
  MinusCircle,
  MoreHorizontal,
} from "lucide-react";
import React, { useMemo, useState, useTransition } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { updateReadinessItemAction } from "../../../actions";
import {
  EmptyState,
  PersonChip,
  ProgressBar,
  ReadinessItemStatusBadge,
} from "../../../components/status-badges";
import type {
  DepartureGroupReadinessItem,
  DepartureGroupReadinessSummary,
  ReadinessItemStatus,
} from "../../../types";
import {
  READINESS_ITEM_STATUS_LABELS,
  formatDate,
  percentTone,
  readinessTone,
} from "../../../utils";
import ReadinessItemDrawer from "../readiness-item-drawer";

interface ReadinessTabProps {
  items: DepartureGroupReadinessItem[];
  summary: DepartureGroupReadinessSummary;
  role: StaffRole;
}

const CATEGORY_LABELS: Record<string, string> = {
  FLIGHT: "Flight",
  HOTEL: "Hotel",
  TRANSPORT: "Transport",
  PAYMENT: "Payment",
  DOCUMENT: "Document",
  VISA: "Visa",
  ROOMING: "Rooming",
  GUIDE: "Guide",
  MANIFEST: "Manifest",
  CATERING: "Catering",
  OTHER: "Other",
};

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  OPERATIONS: "Operations",
  VISA: "Visa",
  FINANCE: "Finance",
  GUIDE: "Guide",
  MARKETING: "Marketing",
};

const STATUS_FILTERS: (ReadinessItemStatus | "ALL")[] = [
  "ALL",
  "BLOCKED",
  "AT_RISK",
  "IN_PROGRESS",
  "NOT_STARTED",
  "COMPLETE",
];

/**
 * The live version of the checklist copied from the Package Template. The score
 * is weighted, not a raw item count — a blocked hotel confirmation cannot be
 * offset by finished communication tasks.
 */
const ReadinessTab = ({ items, summary, role }: ReadinessTabProps) => {
  const can = useDepartureCapabilities(role);
  const [statusFilter, setStatusFilter] = useState<ReadinessItemStatus | "ALL">(
    "ALL",
  );
  const [selected, setSelected] = useState<DepartureGroupReadinessItem | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      statusFilter === "ALL"
        ? items
        : items.filter((item) => item.status === statusFilter),
    [items, statusFilter],
  );

  /**
   * The row menu's one-click verdicts. Anything that needs an owner, a date or
   * a URL opens the drawer instead — a dropdown is the wrong place to type.
   */
  const setStatus = (
    item: DepartureGroupReadinessItem,
    status: ReadinessItemStatus,
    successTitle: string,
  ) => {
    setBusyId(item.id);
    startTransition(async () => {
      const result = await updateReadinessItemAction({
        id: item.id,
        departureGroupId: item.departureGroupId,
        status,
        // Parking a required item is only meaningful together with clearing the
        // required flag, so the two travel as one edit.
        ...(status === "NOT_REQUIRED" ? { required: false } : {}),
      });
      setBusyId(null);

      if (!result.ok) {
        toast.add({
          title: "Could not update requirement",
          description: result.error,
        });
        return;
      }
      toast.add({ title: successTitle, description: result.label });
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <ReadinessItemDrawer
        item={selected}
        canEdit={can.manageReadiness}
        open={selected !== null}
        onClose={() => setSelected(null)}
      />

      {/* Score header */}
      <Card className="gap-4">
        <SectionHeading
          title="Departure readiness"
          act={
            <span className="text-xs text-muted-foreground">
              Weighted by category criticality
            </span>
          }
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-4xl font-bold tabular-nums text-foreground">
              {summary.score}%
            </span>
            <ProgressBar
              percent={summary.score}
              tone={
                summary.status === "NOT_STARTED"
                  ? "neutral"
                  : readinessTone(summary.status)
              }
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Blockers</span>
            <span
              className={cn(
                "text-2xl font-bold tabular-nums",
                summary.blockerCount > 0
                  ? "text-destructive"
                  : "text-foreground",
              )}
            >
              {summary.blockerCount}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Due today</span>
            <span className="text-2xl font-bold tabular-nums text-foreground">
              {summary.dueTodayCount}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">
              Due in next 7 days
            </span>
            <span className="text-2xl font-bold tabular-nums text-foreground">
              {summary.dueInSevenDaysCount}
            </span>
          </div>
        </div>

        {summary.categories.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 pt-2">
            {summary.categories.map((category) => (
              <div key={category.category} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-foreground">{category.label}</span>
                  <span className="tabular-nums font-semibold text-foreground">
                    {category.percent}%
                  </span>
                </div>
                <ProgressBar
                  percent={category.percent}
                  tone={percentTone(category.percent)}
                />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="gap-4">
        <SectionHeading
          title="Readiness checklist"
          act={
            <span className="text-xs text-muted-foreground">
              {items.length} requirement{items.length === 1 ? "" : "s"} copied
              from the package snapshot
            </span>
          }
        />

        <div
          role="group"
          aria-label="Filter readiness requirements"
          className="max-w-full overflow-x-auto no-scrollbar"
        >
          <Card className="flex w-max flex-row items-center px-1 py-1">
            {STATUS_FILTERS.map((status) => (
              <Button
                key={status}
                variant={statusFilter === status ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter(status)}
                className={cn(
                  statusFilter !== status && "text-muted-foreground",
                )}
              >
                {status === "ALL"
                  ? "All"
                  : READINESS_ITEM_STATUS_LABELS[status]}
              </Button>
            ))}
          </Card>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title={
              items.length === 0
                ? "No readiness checklist copied to this group"
                : "No requirements in this status"
            }
            description={
              items.length === 0
                ? "Re-create the group with the readiness checklist copy option enabled, or add requirements manually."
                : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto no-scrollbar">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-none!">
                  {[
                    "Requirement",
                    "Category",
                    "Owner",
                    "Due",
                    "Status",
                    "Evidence",
                    "",
                  ].map((label) => (
                    <TableHead
                      key={label}
                      className="h-10 px-3 text-xs font-medium text-muted-foreground"
                    >
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border/20">
                {rows.map((item) => (
                  <TableRow
                    key={item.id}
                    className="hover:bg-muted/50 cursor-pointer"
                    onClick={() => setSelected(item)}
                  >
                    <TableCell className="px-3 py-3">
                      <p className="text-sm text-foreground">{item.label}</p>
                      {!item.required && (
                        <span className="text-[11px] text-muted-foreground">
                          Optional
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <Badge
                        variant="outline"
                        className="text-[10px] text-muted-foreground"
                      >
                        {CATEGORY_LABELS[item.category]}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <div className="flex flex-col gap-1">
                        <PersonChip name={item.assignedToName} />
                        <span className="text-[11px] text-muted-foreground">
                          {ROLE_LABELS[item.responsibleRole]}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <span className="text-xs text-foreground">
                        {item.dueLabel}
                      </span>
                      {item.dueAt && (
                        <span className="block text-[11px] text-muted-foreground">
                          {formatDate(item.dueAt)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <div className="flex flex-col gap-1">
                        <ReadinessItemStatusBadge value={item.status} />
                        {item.autoSourceHint && (
                          <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                            <Lock className="size-3" /> Tracked from{" "}
                            {item.autoSourceHint}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      {item.evidenceUrl ? (
                        <a
                          href={item.evidenceUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                        >
                          <FileText className="size-3.5" /> View
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          onClick={(event) => event.stopPropagation()}
                          render={
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Actions for ${item.label}`}
                            >
                              {isPending && busyId === item.id ? (
                                <Loader2 className="animate-spin" />
                              ) : (
                                <MoreHorizontal />
                              )}
                            </Button>
                          }
                        />
                        <DropdownMenuContent
                          align="end"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <DropdownMenuItem onClick={() => setSelected(item)}>
                            Open Requirement
                          </DropdownMenuItem>
                          {can.manageReadiness && (
                            <>
                              <DropdownMenuSeparator />
                              {/* A derived item reports what the hotel, flight,
                                  payment or document rows actually say, so its
                                  status is not offered here — only the scoping
                                  decision and the drawer fields are. */}
                              {!item.autoSource &&
                                item.status !== "COMPLETE" && (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setStatus(
                                        item,
                                        "COMPLETE",
                                        "Requirement completed",
                                      )
                                    }
                                  >
                                    <CheckCircle2 /> Mark Complete
                                  </DropdownMenuItem>
                                )}
                              {!item.autoSource &&
                                item.status !== "BLOCKED" && (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      setStatus(
                                        item,
                                        "BLOCKED",
                                        "Requirement marked blocked",
                                      )
                                    }
                                  >
                                    <Ban /> Mark Blocked
                                  </DropdownMenuItem>
                                )}
                              {item.status !== "NOT_REQUIRED" && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    setStatus(
                                      item,
                                      "NOT_REQUIRED",
                                      "Requirement marked not required",
                                    )
                                  }
                                >
                                  <MinusCircle /> Mark Not Required
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              {/* Owner, due date and evidence all need typing,
                                  so they belong in the drawer, not a menu. */}
                              <DropdownMenuItem
                                onClick={() => setSelected(item)}
                              >
                                Assign Owner / Due Date / Evidence
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
};

export default ReadinessTab;
