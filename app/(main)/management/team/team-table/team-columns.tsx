"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";
import React from "react";

import type { DataTableSort } from "@/components/data-table/data-table";
import { header, sortableHeader } from "@/components/data-table/sortable-header";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PersonChip, ToneBadge } from "@/components/ui/tone-badge";

import {
  ACCOUNT_STATUS_LABELS,
  ROLE_LABELS,
  accountStatusTone,
  branchLabel,
  effectiveAccountStatus,
  formatLastActive,
  isSeasonalExpired,
  workloadBand,
  workloadTone,
} from "../utils";
import type { TeamCapabilities, TeamMemberListItem } from "../types";

export interface TeamRowActions {
  onOpen: (row: TeamMemberListItem) => void;
  onEdit: (row: TeamMemberListItem) => void;
  onAssignGroup: (row: TeamMemberListItem) => void;
  onChangeRole: (row: TeamMemberListItem) => void;
  onExtendAccess: (row: TeamMemberListItem) => void;
  onDeactivate: (row: TeamMemberListItem) => void;
  onReactivate: (row: TeamMemberListItem) => void;
}

export function buildTeamColumns(
  actions: TeamRowActions,
  nowIso: string,
  can: TeamCapabilities,
  sort: DataTableSort,
  onSortChange: (sort: DataTableSort) => void,
): ColumnDef<TeamMemberListItem>[] {
  const columns: ColumnDef<TeamMemberListItem>[] = [
    {
      id: "teamMember",
      header: sortableHeader("Team Member", "fullName", sort, onSortChange),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex flex-col gap-1">
            <PersonChip name={item.fullName} />
            <span className="text-[11px] text-muted-foreground pl-8">{item.whatsapp || item.email}</span>
          </div>
        );
      },
    },
    {
      id: "role",
      header: sortableHeader("Role", "role", sort, onSortChange),
      cell: ({ row }) => <ToneBadge tone="neutral" label={ROLE_LABELS[row.original.role]} />,
    },
    {
      id: "branch",
      header: header("Branch"),
      cell: ({ row }) => <span className="text-sm text-foreground">{branchLabel(row.original.branch)}</span>,
    },
    {
      id: "status",
      header: header("Status"),
      cell: ({ row }) => {
        const status = effectiveAccountStatus(row.original, nowIso);
        return <ToneBadge tone={accountStatusTone(status)} label={ACCOUNT_STATUS_LABELS[status]} />;
      },
    },
    {
      id: "assignedGroups",
      header: header("Assigned Groups"),
      cell: ({ row }) => {
        const item = row.original;
        if (item.assignedGroupCount === 0) return <span className="text-sm text-muted-foreground">—</span>;
        const names = item.primaryGroups.map((g) => g.groupName).slice(0, 2).join(", ");
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-foreground">
              {item.assignedGroupCount} Departure Group{item.assignedGroupCount === 1 ? "" : "s"}
            </span>
            <span className="text-[11px] text-muted-foreground truncate max-w-52">{names}</span>
          </div>
        );
      },
    },
    {
      id: "openTasks",
      header: sortableHeader("Open Tasks", "openTaskCount", sort, onSortChange),
      cell: ({ row }) => {
        const item = row.original;
        const band = workloadBand(item.openTaskCount);
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-foreground">{item.openTaskCount} tasks</span>
            <span className="text-[11px] text-muted-foreground">
              {item.overdueTaskCount > 0 ? (
                <span className="text-destructive">{item.overdueTaskCount} overdue</span>
              ) : item.dueTodayCount > 0 ? (
                `${item.dueTodayCount} due today`
              ) : band !== "LOW" ? (
                <ToneBadge tone={workloadTone(band)} label={band === "OVERLOADED" ? "Overloaded" : band} className="px-1.5 py-0.5" />
              ) : (
                "On track"
              )}
            </span>
          </div>
        );
      },
    },
    {
      id: "lastActive",
      header: sortableHeader("Last Active", "lastActiveAt", sort, onSortChange),
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatLastActive(row.original, nowIso)}</span>,
    },
    {
      id: "actions",
      header: () => null,
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon" className="size-8">
                    <MoreHorizontal className="size-4" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => actions.onOpen(item)}>Open profile</DropdownMenuItem>
                {can.editProfile && <DropdownMenuItem onClick={() => actions.onEdit(item)}>Edit</DropdownMenuItem>}
                {can.assignGroups && (
                  <DropdownMenuItem onClick={() => actions.onAssignGroup(item)}>Assign group</DropdownMenuItem>
                )}
                {can.changeRole && (
                  <DropdownMenuItem onClick={() => actions.onChangeRole(item)}>Change role</DropdownMenuItem>
                )}
                {can.editProfile && isSeasonalExpired(item, nowIso) && (
                  <DropdownMenuItem onClick={() => actions.onExtendAccess(item)}>Extend access</DropdownMenuItem>
                )}
                {can.deactivateStaff && item.status !== "DEACTIVATED" && (
                  <DropdownMenuItem onClick={() => actions.onDeactivate(item)} className="text-destructive">
                    Deactivate
                  </DropdownMenuItem>
                )}
                {can.deactivateStaff && item.status === "DEACTIVATED" && (
                  <DropdownMenuItem onClick={() => actions.onReactivate(item)}>Reactivate</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  return columns;
}
