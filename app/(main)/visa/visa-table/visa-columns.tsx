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
import { PersonChip, ProgressBar, ToneBadge } from "@/components/ui/tone-badge";
import { TONE_TEXT } from "@/lib/ui/tone";

import type { VisaListItem } from "../types";
import {
  JOURNEY_TYPE_LABELS,
  VALIDITY_STATE_LABELS,
  VISA_STATUS_LABELS,
  daysRemainingLabel,
  formatDate,
  validityTone,
  visaStatusTone,
  type VisaSort,
} from "../utils";

export interface VisaRowActions {
  onReview: (item: VisaListItem) => void;
  onAssign: (item: VisaListItem) => void;
  onOpenDocuments: (item: VisaListItem) => void;
  onStatusCheck: (item: VisaListItem) => void;
  onOpenBatch?: (item: VisaListItem) => void;
}

export function buildVisaColumns(
  sort: VisaSort,
  onSortChange: (sort: DataTableSort) => void,
  actions: VisaRowActions,
  canSelect: boolean,
): ColumnDef<VisaListItem>[] {
  const columns: ColumnDef<VisaListItem>[] = [];

  if (canSelect) {
    columns.push({
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={table.getIsSomePageRowsSelected()}
          onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked === true)}
          aria-label="Select all applications on this page"
        />
      ),
      cell: ({ row }) => (
        <span onClick={(event) => event.stopPropagation()} className="flex items-center">
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(checked) => row.toggleSelected(checked === true)}
            aria-label={`Select ${row.original.fullName}`}
          />
        </span>
      ),
      enableSorting: false,
    });
  }

  columns.push(
    {
      id: "pilgrim",
      header: sortableHeader("Pilgrim", "fullName", sort, onSortChange),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex flex-col gap-0.5">
            <PersonChip name={item.fullName} />
            <span className="text-[11px] text-muted-foreground pl-8">
              {item.pilgrimReference} · {item.passportMasked}
            </span>
          </div>
        );
      },
    },
    {
      id: "departureGroup",
      header: sortableHeader("Departure Group", "departureDate", sort, onSortChange),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">{item.groupName}</span>
            <span className="text-[11px] text-muted-foreground">{daysRemainingLabel(item.daysToDeparture)}</span>
          </div>
        );
      },
    },
    {
      id: "visaType",
      header: header("Visa Type"),
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-foreground">{row.original.visaType}</span>
          <span className="text-[11px] text-muted-foreground">{JOURNEY_TYPE_LABELS[row.original.journeyType] ?? row.original.journeyType}</span>
        </div>
      ),
    },
    {
      id: "status",
      header: header("Application Status"),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex flex-col gap-1">
            <ToneBadge tone={visaStatusTone(item.visaStatus)} label={VISA_STATUS_LABELS[item.visaStatus] ?? item.visaStatus} />
            {item.visaStatus === "APPROVED" && !item.verifiedAt && (
              <span className={`text-[11px] ${TONE_TEXT.warning}`}>Unverified</span>
            )}
          </div>
        );
      },
    },
    {
      id: "documentReadiness",
      header: header("Document Readiness"),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex flex-col gap-1 w-32">
            <span className="text-xs font-number text-foreground">
              {item.documentsCompleted} / {item.documentsRequired} verified
            </span>
            <ProgressBar percent={item.documentCompletionPercent} />
            {item.gatingOutstanding > 0 && (
              <span className="text-[11px] text-destructive">{item.gatingOutstanding} blocking</span>
            )}
          </div>
        );
      },
    },
    {
      id: "reference",
      header: header("Application Reference"),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-foreground">{item.applicationReference ?? "—"}</span>
            {item.batchReference && (
              <button
                type="button"
                className="text-[11px] text-primary hover:underline text-left"
                onClick={(event) => {
                  event.stopPropagation();
                  actions.onOpenBatch?.(item);
                }}
              >
                {item.batchReference} · Batch {item.batchSequence}
              </button>
            )}
          </div>
        );
      },
    },
    {
      id: "submitted",
      header: sortableHeader("Submitted", "submittedAt", sort, onSortChange),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-foreground">{formatDate(item.submittedAt)}</span>
            {item.daysSinceUpdate !== null && (
              <span className="text-[11px] text-muted-foreground">checked {item.daysSinceUpdate}d ago</span>
            )}
          </div>
        );
      },
    },
    {
      id: "validity",
      header: header("Visa Validity"),
      cell: ({ row }) => {
        const item = row.original;
        if (!item.visaId) return <span className="text-xs text-muted-foreground">Awaiting issue</span>;
        return (
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-foreground">
              {formatDate(item.issueDate)} → {formatDate(item.expiryDate)}
            </span>
            {item.validityState !== "NONE" && (
              <ToneBadge tone={validityTone(item.validityState)} label={VALIDITY_STATE_LABELS[item.validityState]} className="w-fit" />
            )}
          </div>
        );
      },
    },
    {
      id: "officer",
      header: header("Assigned Officer"),
      cell: ({ row }) => (
        <PersonChip name={row.original.assignedToName ?? row.original.groupVisaOwnerName} fallback="Unassigned" />
      ),
    },
    {
      id: "actions",
      header: header(""),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
            <Button variant="ghost" size="sm" onClick={() => actions.onReview(item)}>
              Review
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon"><MoreHorizontal className="size-4" /></Button>} />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => actions.onAssign(item)}>Assign officer</DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.onStatusCheck(item)}>Record status check</DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.onOpenDocuments(item)}>Open in Documents</DropdownMenuItem>
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
