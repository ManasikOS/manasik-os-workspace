"use client";

import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import SearchInput from "@/components/ui/search-input";

interface DataTableSurfaceProps {
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  toolbar?: ReactNode;
  children: ReactNode;
  rowCount?: number;
}

/**
 * System table surface for screens whose rows need bespoke markup. It keeps
 * search and secondary controls in the same header used by DataTable.
 */
export function DataTableSurface({
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  toolbar,
  children,
  rowCount,
}: DataTableSurfaceProps) {
  return (
    <Card className="gap-0 overflow-hidden bg-card p-0">
      {(onSearchChange || toolbar) && (
        <div className="flex flex-col items-stretch justify-between gap-3 border-b border-border/40 px-4 py-3 sm:flex-row sm:items-center">
          {onSearchChange && (
            <div className="relative max-w-lg flex-1">
              <SearchInput
                value={search ?? ""}
                onChange={onSearchChange}
                placeholder={searchPlaceholder}
              />
            </div>
          )}
          {toolbar}
        </div>
      )}
      <div className="w-full overflow-auto no-scrollbar">{children}</div>
      {rowCount !== undefined && (
        <div className="flex items-center justify-end border-t border-border/40 bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
          <span className="font-number font-medium text-foreground">
            {rowCount} {rowCount === 1 ? "result" : "results"}
          </span>
        </div>
      )}
    </Card>
  );
}
