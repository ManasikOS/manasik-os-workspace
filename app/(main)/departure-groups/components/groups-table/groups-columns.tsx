"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DepartureGroupCapabilities } from "@/lib/access/departure-groups-access";
import type { ColumnDef } from "@tanstack/react-table";
import {
  header,
  sortableHeader,
} from "@/components/data-table/sortable-header";
import type { DataTableSort } from "@/components/data-table/data-table";
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  MoreHorizontal,
} from "lucide-react";
import {
  GroupActionMenuItems,
  type MenuSlots,
} from "./group-action-menu-items";
import { Calendar4 } from "reicon-react";
import type { DepartureGroupListItem } from "../../types";
import {
  GroupStatusBadge,
  JourneyTypeBadge,
  PersonChip,
  ProgressBar,
  ReadinessStatusBadge,
  SalesStatusBadge,
} from "../status-badges";
import {
  departureCountdown,
  formatShortDate,
  readinessTone,
  type GroupSort,
  type GroupSortField,
} from "../../utils";
import { TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

/** Dropdown-flavoured slots for the shared GroupActionMenuItems. */
const DROPDOWN_SLOTS: MenuSlots = {
  MenuItem: DropdownMenuItem,
  MenuSeparator: DropdownMenuSeparator,
};

export { DROPDOWN_SLOTS };

export interface GroupRowActions {
  onOpen: (group: DepartureGroupListItem) => void;
  onEdit: (group: DepartureGroupListItem) => void;
  onAddBooking: (group: DepartureGroupListItem) => void;
  onCompareTemplate: (group: DepartureGroupListItem) => void;
  onCloseSales: (group: DepartureGroupListItem) => void;
  onCancel: (group: DepartureGroupListItem) => void;
  onArchive: (group: DepartureGroupListItem) => void;
}

/**
 * Which sort field each column header drives. Kept next to the column defs and
 * handed to the table so it can put `aria-sort` on the right `<th>` — the sort
 * state has to be announced on the column header, not on the button inside it.
 */
export const GROUP_COLUMN_SORT_FIELDS: Record<string, GroupSortField> = {
  group: "groupName",
  dates: "departureDate",
  capacity: "occupancyRate",
  salesStatus: "salesStatus",
  groupStatus: "groupStatus",
  readiness: "readinessScore",
  blocker: "readinessRisk",
};

export function buildGroupColumns(
  can: DepartureGroupCapabilities,
  actions: GroupRowActions,
  sort: GroupSort,
  onSortChange: (sort: DataTableSort) => void,
): ColumnDef<DepartureGroupListItem>[] {
  return [
    {
      id: "group",
      header: sortableHeader("Group Info", "groupName", sort, onSortChange),
      cell: ({ row }) => {
        const group = row.original;
        return (
          <div className="flex flex-col min-w-0 gap-1 py-1">
            <span className="font-medium group-hover:text-primary transition-all duration-300 tracking-tight text-sm text-foreground truncate">
              {group.groupName}
            </span>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge
                variant="outline"
                className="text-muted-foreground text-[10px] font-number"
              >
                {group.groupCode}
              </Badge>
              <span className="truncate max-w-55">
                From: {group.packageTemplateName}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      id: "dates",
      header: sortableHeader(
        "Travel Dates",
        "departureDate",
        sort,
        onSortChange,
      ),
      cell: ({ row }) => {
        const group = row.original;
        const imminent =
          group.daysUntilDeparture >= 0 && group.daysUntilDeparture <= 14;
        return (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <Calendar4 className="size-3.5 text-muted-foreground" />
              {formatShortDate(group.departureDate)} –{" "}
              {formatShortDate(group.returnDate)}
            </span>
            <span
              className={
                imminent
                  ? cn("text-[11px] font-medium", TONE_TEXT.warning)
                  : "text-[11px] text-muted-foreground"
              }
            >
              {departureCountdown(group.daysUntilDeparture)}
            </span>
          </div>
        );
      },
    },
    {
      id: "journey",
      header: header("Journey"),
      cell: ({ row }) => <JourneyTypeBadge value={row.original.journeyType} />,
    },
    {
      id: "capacity",
      header: sortableHeader("Capacity", "occupancyRate", sort, onSortChange),
      cell: ({ row }) => {
        const group = row.original;
        const bookedPct =
          group.capacity === 0
            ? 0
            : Math.min(100, (group.bookedSeats / group.capacity) * 100);
        const heldPct =
          group.capacity === 0
            ? 0
            : Math.min(
                100 - bookedPct,
                (group.heldSeats / group.capacity) * 100,
              );
        return (
          <div className="flex flex-col gap-1.5 min-w-28">
            <span className="text-xs font-medium text-foreground font-number">
              {group.bookedSeats} / {group.capacity}
            </span>
            <div
              className="w-full bg-muted h-1 rounded-full overflow-hidden border border-muted-foreground/2 flex"
              role="progressbar"
              aria-valuenow={Math.round(bookedPct + heldPct)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full bg-primary"
                style={{ width: `${bookedPct}%` }}
              />
              {heldPct > 0 && (
                <div
                  className="h-full bg-primary/40"
                  style={{ width: `${heldPct}%` }}
                />
              )}
            </div>
            <span className="text-[11px] text-muted-foreground">
              {group.availableSeats === 0
                ? "Full"
                : `${group.availableSeats} seats left`}
              {group.heldSeats > 0 ? ` · ${group.heldSeats} on hold` : ""}
            </span>
          </div>
        );
      },
    },
    {
      id: "salesStatus",
      header: sortableHeader("Sales Status", "salesStatus", sort, onSortChange),
      cell: ({ row }) => <SalesStatusBadge value={row.original.salesStatus} />,
    },
    {
      id: "groupStatus",
      header: sortableHeader(
        "Operations Status",
        "groupStatus",
        sort,
        onSortChange,
      ),
      cell: ({ row }) => <GroupStatusBadge value={row.original.groupStatus} />,
    },
    {
      id: "readiness",
      header: sortableHeader("Readiness", "readinessScore", sort, onSortChange),
      cell: ({ row }) => {
        const group = row.original;
        return (
          <div className="flex flex-col gap-1.5 min-w-28">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground font-number">
                {group.readinessScore}%
              </span>
              <ReadinessStatusBadge value={group.readinessStatus} />
            </div>
            <ProgressBar
              percent={group.readinessScore}
              tone={
                group.readinessStatus === "NOT_STARTED"
                  ? "neutral"
                  : readinessTone(group.readinessStatus)
              }
              className="h-1"
            />
          </div>
        );
      },
    },
    {
      id: "blocker",
      header: sortableHeader(
        "Primary Blocker",
        "readinessRisk",
        sort,
        onSortChange,
      ),
      cell: ({ row }) => {
        const blocker = row.original.primaryBlocker;
        const clear = blocker === "All clear";
        return (
          <span
            className={`text-xs flex items-center gap-1.5 max-w-55 truncate ${
              clear ? "text-muted-foreground" : "text-foreground"
            }`}
            title={blocker}
          >
            {clear ? (
              <CircleCheck
                className={cn("size-3.5 shrink-0", TONE_TEXT.success)}
              />
            ) : (
              <CircleAlert className="size-3.5 text-destructive shrink-0" />
            )}
            {blocker}
          </span>
        );
      },
    },
    {
      id: "guide",
      header: header("Guide"),
      cell: ({ row }) => <PersonChip name={row.original.primaryGuideName} />,
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => {
        const group = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              onClick={(event) => event.stopPropagation()}
              render={
                <Button variant="ghost" size="icon" aria-label="Group actions">
                  <MoreHorizontal />
                </Button>
              }
            />
            <DropdownMenuContent
              align="end"
              onClick={(event) => event.stopPropagation()}
            >
              <GroupActionMenuItems
                group={group}
                can={can}
                actions={actions}
                slots={DROPDOWN_SLOTS}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}

/** Small inline "open" affordance reused by empty states. */
export function OpenGroupLink({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="link" size="sm" onClick={onClick}>
      Open group <ArrowRight className="size-3.5" />
    </Button>
  );
}
