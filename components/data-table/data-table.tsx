"use client";

import React, { useState } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type RowSelectionState,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import SearchInput from "../ui/search-input";
import { Card } from "../ui/card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { cn } from "@/lib/utils";

/**
 * Every column header in this codebase is built with `header()` or
 * `sortableHeader()` from `sortable-header.tsx`, both of which stamp a
 * `displayName` of the shape `ColumnHeader(Label)` / `SortableColumnHeader
 * (Label)`. Reading it back out lets the mobile card view below show a
 * real field label for any table's columns without each table having to
 * declare one twice.
 */
function columnLabel<TData>(column: ColumnDef<TData>): string | null {
  const headerDef = column.header;
  if (typeof headerDef === "string") return headerDef;
  if (typeof headerDef === "function") {
    const name = (headerDef as { displayName?: string }).displayName;
    const match = name?.match(/^(?:Sortable)?ColumnHeader\((.*)\)$/);
    if (match) return match[1];
  }
  return null;
}

export interface DataTableSort {
  field: string;
  direction: "asc" | "desc";
}

interface DataTableProps<TData> {
  columns: ColumnDef<TData>[];
  /** The full filtered/sorted set — this table paginates it client-side. */
  data: TData[];
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  /** Rendered between the search box and the pagination footer. */
  toolbar?: React.ReactNode;
  emptyMessage?: string;
  onRowClick?: (row: TData) => void;
  getRowId?: (row: TData) => string;
  /**
   * Change this to send the table back to page one — used when a filter,
   * saved view, or sort changes, since the current page number no longer
   * refers to the same rows.
   */
  resetPageToken?: string;
  /** Current sort, used only to put `aria-sort` on the active column header. */
  sort?: DataTableSort;
  /** Column id → the sort field its header drives. */
  sortFieldByColumnId?: Record<string, string>;
  contextMenuContents?: (item: TData) => React.ReactNode | React.ReactNode;
  /**
   * Turns on `rowSelection` state on the underlying table instance. The
   * selection column itself (its checkbox header/cell) is still part of
   * `columns` — this only wires the state up and unlocks `bulkBar`.
   * Requires `getRowId`, so a selection survives a sort, a filter change or
   * a page turn instead of tracking whatever row now sits at that index.
   */
  enableRowSelection?: boolean;
  /** Rendered above the table once at least one row is selected. Requires `enableRowSelection`. */
  bulkBar?: (selected: TData[], clear: () => void) => React.ReactNode;
  /**
   * Makes each row a real keyboard target: focusable, `role="button"`, and
   * Enter/Space trigger `onRowClick` — not just a mouse click.
   */
  rowsAreButtons?: boolean;
  /** `aria-label` for a row, used only when `rowsAreButtons` is set. */
  rowAriaLabel?: (row: TData) => string;
}

/**
 * Generic table shell shared across modules (extracted from the Departure
 * Groups table). Search/filter/sort all happen upstream of this component —
 * it receives the already-filtered, already-sorted array and only owns
 * pagination, entirely client-side.
 */
export function DataTable<TData>({
  columns,
  data,
  search,
  onSearchChange,
  searchPlaceholder = "Search...",
  toolbar,
  emptyMessage,
  onRowClick,
  getRowId,
  resetPageToken,
  sort,
  sortFieldByColumnId,
  contextMenuContents,
  enableRowSelection = false,
  bulkBar,
  rowsAreButtons = false,
  rowAriaLabel,
}: DataTableProps<TData>) {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // Adjusting state during render rather than in an effect: React re-runs this
  // component before committing, so there is no extra paint and no cascade.
  const [seenPageToken, setSeenPageToken] = useState(resetPageToken);
  if (resetPageToken !== seenPageToken) {
    setSeenPageToken(resetPageToken);
    if (pagination.pageIndex !== 0) {
      setPagination((previous) => ({ ...previous, pageIndex: 0 }));
    }
  }

  const table = useReactTable({
    data,
    columns,
    state: { pagination, rowSelection },
    onPaginationChange: setPagination,
    onRowSelectionChange: enableRowSelection ? setRowSelection : undefined,
    enableRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
  });

  const totalRows = data.length;
  const { pageIndex, pageSize } = table.getState().pagination;

  // Clamp: a page index left over from a longer list would otherwise render an
  // empty table with a "51–60 of 12" footer.
  const lastPageIndex = Math.max(0, Math.ceil(totalRows / pageSize) - 1);
  if (pageIndex > lastPageIndex) {
    setPagination((previous) => ({ ...previous, pageIndex: lastPageIndex }));
  }

  const startRow = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const endRow = Math.min((pageIndex + 1) * pageSize, totalRows);

  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);
  const selectedRows = getRowId
    ? data.filter((row) => selectedIds.includes(getRowId(row)))
    : [];
  const clearSelection = () => setRowSelection({});

  return (
    <Card className="p-0 bg-card gap-0">
      {" "}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-4 py-3 border-b border-border/40">
        <div className="relative flex-1 max-w-lg">
          <SearchInput
            onChange={(e) => {
              onSearchChange(e);
              setPagination((p) => ({ ...p, pageIndex: 0 }));
            }}
            placeholder={searchPlaceholder}
            value={search}
          />
        </div>
        {toolbar}
      </div>
      {enableRowSelection && selectedRows.length > 0 && bulkBar && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-primary/5 border-b border-border/40">
          <span className="text-xs font-semibold text-primary">
            {selectedRows.length} selected
          </span>
          {bulkBar(selectedRows, clearSelection)}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-muted-foreground"
            onClick={clearSelection}
          >
            <X /> Clear
          </Button>
        </div>
      )}
      {/* Mobile: one card per row instead of a horizontally-scrolling table.
          The first non-selection column is the row's identity (name, code,
          …) and renders large; every other visible column renders as a
          label/value line below it, using the same cells the desktop table
          renders — no per-table config needed. */}
      <div className="flex flex-col divide-y divide-border/40 md:hidden">
        {table.getRowModel().rows.length ? (
          table.getRowModel().rows.map((row) => {
            const cells = row
              .getVisibleCells()
              .filter((cell) => cell.column.id !== "select");
            const [primary, ...rest] = cells;
            if (!primary) return null;

            return (
              <div
                key={row.id}
                role={onRowClick ? "button" : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        onRowClick(row.original);
                      }
                    : undefined
                }
                className={cn(
                  "flex flex-col gap-2.5 px-4 py-4",
                  onRowClick &&
                    "cursor-pointer hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring transition-colors",
                )}
              >
                <div className="text-sm font-medium text-foreground">
                  {flexRender(
                    primary.column.columnDef.cell,
                    primary.getContext(),
                  )}
                </div>
                {rest.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {rest.map((cell) => {
                      const label = columnLabel(cell.column.columnDef);
                      return (
                        <div
                          key={cell.id}
                          className="flex items-center justify-between gap-3 text-xs"
                        >
                          {label && (
                            <span className="text-muted-foreground shrink-0">
                              {label}
                            </span>
                          )}
                          <span className="text-foreground min-w-0 text-right">
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            {emptyMessage ??
              (search ? `No results matching "${search}"` : "No results found.")}
          </div>
        )}
      </div>

      <div
        className="hidden md:block overflow-auto no-scrollbar w-full"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <Table className="w-full text-left border-collapse">
          <TableHeader className="bg-card/70 sticky top-0 z-10 shadow-2xs border-b-transparent!">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow
                key={headerGroup.id}
                className="hover:bg-transparent border-none!"
              >
                {headerGroup.headers.map((header) => {
                  const sortField = sortFieldByColumnId?.[header.column.id];
                  const isSortedBy = !!sort && sort.field === sortField;

                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={
                        !sortField
                          ? undefined
                          : isSortedBy
                            ? sort!.direction === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                      }
                      className="h-11 px-4 text-xs font-medium tracking-tight text-muted-foreground whitespace-nowrap"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody className="divide-y divide-border/20 border-t-transparent">
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => {
                const rowProps = rowsAreButtons
                  ? {
                      tabIndex: 0,
                      role: "button" as const,
                      "aria-label": rowAriaLabel?.(row.original),
                      onKeyDown: (event: React.KeyboardEvent) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        // Only when the row itself has focus — a checkbox or
                        // menu inside it handles its own keys.
                        if (event.target !== event.currentTarget) return;
                        event.preventDefault();
                        onRowClick?.(row.original);
                      },
                    }
                  : {};

                return (
                  <ContextMenu key={row.id}>
                    <ContextMenuTrigger
                      key={row.id}
                      render={
                        <TableRow
                          key={row.id}
                          className={cn(
                            onRowClick
                              ? "hover:bg-muted/80 group hover:cursor-pointer transition-colors duration-200"
                              : "hover:bg-muted/80",
                            rowsAreButtons &&
                              "data-[state=selected]:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                          )}
                          data-state={
                            enableRowSelection && row.getIsSelected()
                              ? "selected"
                              : undefined
                          }
                          onClick={
                            onRowClick
                              ? () => onRowClick(row.original)
                              : undefined
                          }
                          {...rowProps}
                        />
                      }
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className="px-4 py-5 align-middle whitespace-nowrap"
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      ))}
                    </ContextMenuTrigger>
                    {contextMenuContents && (
                      <ContextMenuContent>
                        {typeof contextMenuContents === "function"
                          ? contextMenuContents(row.original)
                          : contextMenuContents}
                      </ContextMenuContent>
                    )}
                  </ContextMenu>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-32 text-center text-muted-foreground"
                >
                  {emptyMessage ??
                    (search
                      ? `No results matching "${search}"`
                      : "No results found.")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-end px-4 py-2.5 bg-muted/20 border-t border-border/40 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          {search && (
            <span className="text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded font-medium">
              Filtered
            </span>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger
              className="mr-2"
              render={
                <Button variant="ghost">
                  Rows {pageSize} <ChevronDown />
                </Button>
              }
            />
            <DropdownMenuContent
              side="top"
              align="end"
              sideOffset={4}
              className="w-20 p-1 space-y-1"
            >
              {[5, 10, 20, 50, 100].map((size) => (
                <DropdownMenuItem
                  key={size}
                  onClick={() =>
                    setPagination({ pageIndex: 0, pageSize: size })
                  }
                >
                  {size}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex items-center justify-between sm:justify-end gap-3 text-sm">
            <span className="font-medium text-foreground min-w-17.5 text-right font-number">
              {startRow}–{endRow} of {totalRows}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="bg-transparent! border-none!"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                title="Previous page"
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="bg-transparent! border-none!"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                title="Next page"
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
