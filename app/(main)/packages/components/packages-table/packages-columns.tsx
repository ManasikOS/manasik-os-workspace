"use client";

import type { ColumnDef } from "@tanstack/react-table";
import {
  Copy,
  Eye,
  MoreHorizontal,
  Pencil,
  PlusCircle,
  Send,
  Star,
  Archive,
  ArchiveRestore,
  Trash2,
} from "lucide-react";
import React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProgressBar, ToneBadge } from "@/components/ui/tone-badge";
import {
  header,
  sortableHeader,
} from "@/components/data-table/sortable-header";
import type { DataTableSort } from "@/components/data-table/data-table";
import type { PackageCapabilities } from "@/lib/access/packages-access";
import type { PackageListItem } from "@/lib/types/packages";

import {
  JourneyTypeBadge,
  PackageStatusBadge,
  VisibilityBadge,
} from "../package-status-badges";

export interface PackageRowActions {
  onOpen: (pkg: PackageListItem) => void;
  onEdit: (pkg: PackageListItem) => void;
  onDuplicate: (pkg: PackageListItem) => void;
  onCreateGroup: (pkg: PackageListItem) => void;
  onPublish: (pkg: PackageListItem) => void;
  onUnpublish: (pkg: PackageListItem) => void;
  onReopen: (pkg: PackageListItem) => void;
  onToggleFeatured: (pkg: PackageListItem) => void;
  onArchive: (pkg: PackageListItem) => void;
  onRestore: (pkg: PackageListItem) => void;
  onDelete: (pkg: PackageListItem) => void;
}

export const PACKAGE_COLUMN_SORT_FIELDS: Record<string, string> = {
  pkg: "title",
  duration: "duration",
  status: "status",
  groups: "groups",
  completeness: "completeness",
  updated: "updatedAt",
};

export function buildPackageColumns(
  can: PackageCapabilities,
  actions: PackageRowActions,
  sort: DataTableSort,
  onSortChange: (sort: DataTableSort) => void,
  /** Packages with a change waiting for approval. */
  pendingPackageIds: ReadonlySet<string> = new Set(),
): ColumnDef<PackageListItem>[] {
  return [
    {
      id: "pkg",
      header: sortableHeader("Package", "title", sort, onSortChange),
      cell: ({ row }) => {
        const p = row.original;
        return (
          <div className="flex flex-col min-w-0 gap-1 py-1">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-[16px] group-hover:text-primary transition-all duration-300 tracking-tight text-foreground truncate">
                {p.title}
              </span>
              {p.featured && (
                <Star className="size-3.5 fill-primary text-primary shrink-0" />
              )}
              {pendingPackageIds.has(p.id) && <ToneBadge tone="warning" label="Change awaiting approval" className="py-0.5 text-[10px]" />}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge
                variant="outline"
                className="text-muted-foreground text-[10px] tabular-nums"
              >
                {p.code}
              </Badge>
            </div>
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
      id: "duration",
      header: sortableHeader("Duration", "duration", sort, onSortChange),
      cell: ({ row }) => {
        const p = row.original;
        return (
          <div className="flex flex-col gap-0.5 text-xs">
            <span className="font-medium text-foreground">
              {p.durationDays}D / {p.durationNights}N
            </span>
            <span className="text-muted-foreground">
              {p.itineraryDays} itinerary day{p.itineraryDays === 1 ? "" : "s"}
            </span>
          </div>
        );
      },
    },
    {
      id: "status",
      header: sortableHeader("Status", "status", sort, onSortChange),
      cell: ({ row }) => (
        <div className="flex flex-col gap-1.5">
          <PackageStatusBadge value={row.original.status} />
          <VisibilityBadge value={row.original.visibility} />
        </div>
      ),
    },
    {
      id: "groups",
      header: sortableHeader("Groups", "groups", sort, onSortChange),
      cell: ({ row }) => {
        const p = row.original;
        const filled =
          p.seatsCapacity > 0
            ? Math.round((p.seatsBooked / p.seatsCapacity) * 100)
            : 0;
        return (
          <div className="flex flex-col gap-1.5 min-w-28">
            <span className="text-sm font- text-foreground tabular-nums">
              {p.liveGroupCount} live · {p.seatsBooked}/{p.seatsCapacity} seats
            </span>
            <ProgressBar percent={filled} tone="brand" className="h-1" />
          </div>
        );
      },
    },
    {
      id: "completeness",
      header: sortableHeader(
        "Completeness",
        "completeness",
        sort,
        onSortChange,
      ),
      cell: ({ row }) => {
        const p = row.original;
        return (
          <div className="flex flex-col gap-1.5 min-w-28">
            <span className="text-xs font-semibold text-foreground tabular-nums">
              {p.completeness}%
            </span>
            <ProgressBar percent={p.completeness} className="h-1" />
          </div>
        );
      },
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => {
        const p = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              onClick={(event) => event.stopPropagation()}
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Package actions"
                >
                  <MoreHorizontal />
                </Button>
              }
            />
            <DropdownMenuContent
              align="end"
              onClick={(event) => event.stopPropagation()}
            >
              <DropdownMenuLabel>{p.code}</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => actions.onOpen(p)}>
                <Eye /> Open Package
              </DropdownMenuItem>
              {can.editPackage && (
                <DropdownMenuItem onClick={() => actions.onEdit(p)}>
                  <Pencil /> Edit Details
                </DropdownMenuItem>
              )}
              {can.duplicatePackage && (
                <DropdownMenuItem onClick={() => actions.onDuplicate(p)}>
                  <Copy /> Duplicate
                </DropdownMenuItem>
              )}
              {can.createGroupFromPackage && p.status === "Open for Sale" && (
                <DropdownMenuItem onClick={() => actions.onCreateGroup(p)}>
                  <PlusCircle /> Create Departure Group
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {can.publishPackage && p.status === "Draft" && (
                <DropdownMenuItem onClick={() => actions.onPublish(p)}>
                  <Send /> Publish
                </DropdownMenuItem>
              )}
              {can.publishPackage && p.status === "Open for Sale" && (
                <DropdownMenuItem onClick={() => actions.onUnpublish(p)}>
                  <Send /> Unpublish
                </DropdownMenuItem>
              )}
              {can.publishPackage && p.status === "Sales Closed" && (
                <DropdownMenuItem onClick={() => actions.onReopen(p)}>
                  <Send /> Reopen for Sale
                </DropdownMenuItem>
              )}
              {can.toggleFeatured && (
                <DropdownMenuItem onClick={() => actions.onToggleFeatured(p)}>
                  <Star /> {p.featured ? "Unfeature" : "Feature"}
                </DropdownMenuItem>
              )}
              {can.archiveOrRestorePackage && (
                <>
                  <DropdownMenuSeparator />
                  {p.archived ? (
                    <DropdownMenuItem onClick={() => actions.onRestore(p)}>
                      <ArchiveRestore /> Restore
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={() => actions.onArchive(p)}>
                      <Archive /> Archive
                    </DropdownMenuItem>
                  )}
                </>
              )}
              {can.deletePackage && (
                <DropdownMenuItem
                  variant="destructive"
                  disabled={p.groupCount > 0 || !(p.archived || p.status === "Draft")}
                  onClick={() => actions.onDelete(p)}
                >
                  <Trash2 />
                  {p.groupCount > 0
                    ? `Delete (used by ${p.groupCount})`
                    : p.archived || p.status === "Draft"
                      ? "Delete Package"
                      : "Delete (archive it first)"}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}
