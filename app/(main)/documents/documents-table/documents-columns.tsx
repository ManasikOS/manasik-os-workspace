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

import type { DocumentListItem } from "../types";
import {
  AI_VERDICT_LABELS,
  AI_VERDICT_TONES,
  STAGE_LABELS,
  STATUS_LABELS,
  daysRemainingLabel,
  documentTypeLabel,
  formatDate,
  formatRelativeUpdated,
  statusToneFor,
  type DocumentSort,
} from "../utils";

export interface DocumentRowActions {
  onReview: (item: DocumentListItem) => void;
  onSendWhatsapp: (item: DocumentListItem) => void;
  onAssign: (item: DocumentListItem) => void;
}

export const DOCUMENT_COLUMN_SORT_FIELDS: Record<string, string> = {
  pilgrim: "fullName",
  departureGroup: "departureDate",
  due: "dueAt",
  updated: "lastActivityAt",
};

export function buildDocumentColumns(
  sort: DocumentSort,
  onSortChange: (sort: DataTableSort) => void,
  nowIso: string,
  actions: DocumentRowActions,
): ColumnDef<DocumentListItem>[] {
  return [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={table.getIsSomePageRowsSelected()}
          onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked === true)}
          aria-label="Select all documents on this page"
        />
      ),
      cell: ({ row }) => (
        <span onClick={(event) => event.stopPropagation()} className="flex items-center">
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(checked) => row.toggleSelected(checked === true)}
            aria-label={`Select ${row.original.name} for ${row.original.fullName}`}
          />
        </span>
      ),
      enableSorting: false,
    },
    {
      id: "pilgrim",
      header: sortableHeader("Pilgrim", "fullName", sort, onSortChange),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex flex-col gap-0.5">
            <PersonChip name={item.fullName} />
            <span className="text-[11px] text-muted-foreground pl-8">{item.pilgrimReference}</span>
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
      id: "requirement",
      header: header("Document Requirement"),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex flex-col gap-0.5 max-w-52">
            <span className="text-sm text-foreground truncate">{item.name}</span>
            <span className="text-[11px] text-muted-foreground">
              {documentTypeLabel(item.documentType)} · {STAGE_LABELS[item.requiredByStage] ?? item.requiredByStage}
            </span>
          </div>
        );
      },
    },
    {
      id: "status",
      header: header("Status"),
      cell: ({ row }) => {
        const item = row.original;
        return <ToneBadge tone={statusToneFor(item)} label={STATUS_LABELS[item.status] ?? item.status} />;
      },
    },
    {
      id: "aiResult",
      header: header("AI Result"),
      cell: ({ row }) => {
        const item = row.original;
        if (!item.aiVerdict) return <span className="text-xs text-muted-foreground">Not scanned</span>;
        return (
          <div className="flex flex-col gap-0.5">
            <ToneBadge tone={AI_VERDICT_TONES[item.aiVerdict] ?? "neutral"} label={AI_VERDICT_LABELS[item.aiVerdict] ?? item.aiVerdict} />
            {item.aiConfidence !== null && (
              <span className="text-[11px] text-muted-foreground">{item.aiConfidence}% confidence</span>
            )}
          </div>
        );
      },
    },
    {
      id: "due",
      header: sortableHeader("Expiry / Deadline", "dueAt", sort, onSortChange),
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="flex flex-col gap-0.5">
            {item.expiresAt && <span className="text-xs text-foreground">Expires: {formatDate(item.expiresAt)}</span>}
            {item.dueAt && (
              <span className={item.isOverdue ? "text-[11px] text-destructive" : "text-[11px] text-muted-foreground"}>
                Due: {formatDate(item.dueAt)}
              </span>
            )}
            {!item.expiresAt && !item.dueAt && <span className="text-xs text-muted-foreground">—</span>}
          </div>
        );
      },
    },
    {
      id: "assigned",
      header: header("Assigned To"),
      cell: ({ row }) => <PersonChip name={row.original.assignedToName} fallback="Unassigned" />,
    },
    {
      id: "updated",
      header: sortableHeader("Updated", "lastActivityAt", sort, onSortChange),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{formatRelativeUpdated(row.original.lastActivityAt, nowIso)}</span>
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
                <DropdownMenuItem onClick={() => actions.onSendWhatsapp(item)}>Send WhatsApp</DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.onAssign(item)}>Assign reviewer</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
      enableSorting: false,
    },
  ];
}
