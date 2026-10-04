"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import React from "react";

import { cn } from "@/lib/utils";
import type { DataTableSort } from "./data-table";

/** Plain, non-interactive column header label. */
export function header(label: string) {
  const ColumnHeader = () => (
    <span className="font-medium text-sm tracking-tight">{label}</span>
  );
  ColumnHeader.displayName = `ColumnHeader(${label})`;
  return ColumnHeader;
}

/**
 * Sortable header. The arrow is only rendered for the active column, and the
 * label carries `aria-sort` (set on the `<th>` by `DataTable`) so state is
 * announced rather than implied by the icon alone.
 */
export function sortableHeader(
  label: string,
  field: string,
  sort: DataTableSort,
  onSortChange: (sort: DataTableSort) => void,
) {
  const isActive = sort.field === field;

  const SortableColumnHeader = () => (
    <button
      type="button"
      onClick={() =>
        onSortChange(
          isActive
            ? { field, direction: sort.direction === "asc" ? "desc" : "asc" }
            : { field, direction: "asc" },
        )
      }
      aria-label={`Sort by ${label}${
        isActive
          ? sort.direction === "asc"
            ? ", currently ascending"
            : ", currently descending"
          : ""
      }`}
      className={cn(
        "group/sort inline-flex items-center gap-1 font-medium text-sm tracking-tight transition-colors",
        isActive ? "text-foreground" : "hover:text-foreground",
      )}
    >
      {label}
      {isActive ? (
        sort.direction === "asc" ? (
          <ArrowUp className="size-3.5 text-primary" />
        ) : (
          <ArrowDown className="size-3.5 text-primary" />
        )
      ) : (
        <ArrowUpDown className="size-3.5 opacity-0 transition-opacity group-hover/sort:opacity-60" />
      )}
    </button>
  );

  SortableColumnHeader.displayName = `SortableColumnHeader(${label})`;
  return SortableColumnHeader;
}
