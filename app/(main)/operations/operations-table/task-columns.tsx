"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";
import React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { header, sortableHeader } from "@/components/data-table/sortable-header";
import type { DataTableSort } from "@/components/data-table/data-table";
import { PersonChip, ToneBadge } from "@/components/ui/tone-badge";

import type { OperationsTaskItem } from "../types";
import {
  TASK_CATEGORY_LABELS,
  TASK_STATUS_LABELS,
  daysRemainingLabel,
  formatDateTime,
  taskPriorityLabel,
  taskPriorityTone,
  taskStatusTone,
  type TaskSort,
} from "../utils";

export interface TaskRowActions {
  onOpen: (item: OperationsTaskItem) => void;
  onComplete: (item: OperationsTaskItem) => void;
  onReassign: (item: OperationsTaskItem) => void;
}

export function buildTaskColumns(
  sort: TaskSort,
  onSortChange: (sort: DataTableSort) => void,
  actions: TaskRowActions,
  nowIso: string,
  canSelect: boolean,
): ColumnDef<OperationsTaskItem>[] {
  const columns: ColumnDef<OperationsTaskItem>[] = [];

  if (canSelect) {
    columns.push({
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={table.getIsSomePageRowsSelected()}
          onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked === true)}
          aria-label="Select all tasks on this page"
        />
      ),
      cell: ({ row }) => (
        <span onClick={(event) => event.stopPropagation()} className="flex items-center">
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(checked) => row.toggleSelected(checked === true)}
            aria-label={`Select ${row.original.title}`}
          />
        </span>
      ),
      enableSorting: false,
    });
  }

  columns.push(
    {
      id: "task",
      header: header("Task"),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex flex-col gap-0.5 max-w-64">
            <span className="text-sm font-medium text-foreground truncate">{item.title}</span>
            <span className="text-[11px] text-muted-foreground">{TASK_CATEGORY_LABELS[item.category] ?? item.category}</span>
          </div>
        );
      },
    },
    {
      id: "group",
      header: sortableHeader("Departure Group", "group", sort, onSortChange),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-foreground">{item.groupName}</span>
            <span className="text-[11px] text-muted-foreground">{daysRemainingLabel(item.daysUntilDeparture)}</span>
          </div>
        );
      },
    },
    {
      id: "owner",
      header: header("Owner"),
      cell: ({ row }) => <PersonChip name={row.original.ownerName} fallback="Unassigned" />,
    },
    {
      id: "due",
      header: sortableHeader("Due", "dueAt", sort, onSortChange),
      cell: ({ row }) => {
        const item = row.original;
        const overdue = item.status === "OVERDUE";
        return (
          <span className={overdue ? "text-sm text-destructive font-medium" : "text-sm text-foreground"}>
            {formatDateTime(item.dueAt)}
          </span>
        );
      },
    },
    {
      id: "priority",
      header: sortableHeader("Priority", "priority", sort, onSortChange),
      cell: ({ row }) => {
        const label = taskPriorityLabel(row.original, nowIso);
        return <ToneBadge tone={taskPriorityTone(label)} label={label} />;
      },
    },
    {
      id: "status",
      header: header("Status"),
      cell: ({ row }) => {
        const item = row.original;
        return <ToneBadge tone={taskStatusTone(item.status)} label={TASK_STATUS_LABELS[item.status] ?? item.status} />;
      },
    },
    {
      id: "linked",
      header: header("Linked Item"),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{row.original.linkedReadinessLabel ?? "—"}</span>
      ),
    },
    {
      id: "actions",
      header: header(""),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
            {item.status !== "COMPLETE" && (
              <Button variant="ghost" size="sm" onClick={() => actions.onComplete(item)}>
                Complete
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon"><MoreHorizontal className="size-4" /></Button>} />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => actions.onOpen(item)}>Open</DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.onReassign(item)}>Reassign</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
      enableSorting: false,
    },
  );

  return columns;
}
