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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, ChevronLeft, ChevronRight, Search, X } from "lucide-react";

import type { DataTableSort } from "@/components/data-table/data-table";

interface OperationsDataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  getRowId: (row: TData) => string;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  onRowClick?: (item: TData) => void;
  toolbar?: React.ReactNode;
  bulkBar?: (selected: TData[], clear: () => void) => React.ReactNode;
  resetPageToken?: string;
  sort?: DataTableSort;
  sortFieldByColumnId?: Record<string, string>;
  emptyMessage?: string;
}

/** Forked from `visa/visa-table/visa-data-table.tsx` — the shared
 *  `components/data-table/data-table.tsx` has no row selection, and the
 *  Operational Tasks table's Bulk Assign / Bulk Update needs it. Generic
 *  over the row type so both tasks and supplier rows can use it. */
export function OperationsDataTable<TData>({
  columns,
  data,
  getRowId,
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  onRowClick,
  toolbar,
  bulkBar,
  resetPageToken,
  sort,
  sortFieldByColumnId,
  emptyMessage,
}: OperationsDataTableProps<TData>) {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

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
    getRowId,
    state: { pagination, rowSelection },
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const totalRows = data.length;
  const { pageIndex, pageSize } = table.getState().pagination;

  const lastPageIndex = Math.max(0, Math.ceil(totalRows / pageSize) - 1);
  if (pageIndex > lastPageIndex) {
    setPagination((previous) => ({ ...previous, pageIndex: lastPageIndex }));
  }

  const startRow = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const endRow = Math.min((pageIndex + 1) * pageSize, totalRows);

  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);
  const rowById = new Map(data.map((row) => [getRowId(row), row]));
  const selectedItems = selectedIds.map((id) => rowById.get(id)).filter((r): r is TData => !!r);
  const clearSelection = () => setRowSelection({});

  return (
    <div className="rounded-md bg-card/60 dark:bg-gray-950/10 border border-muted/50 backdrop-blur-lg shadow-lg overflow-hidden flex flex-col gap-0">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-4 py-3 border-b border-border/40">
        <div className="relative flex-1 max-w-md">
          <InputGroup className="w-full shadow-xs">
            <InputGroupAddon>
              <InputGroupText>
                <Search className="size-4 text-muted-foreground" />
              </InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label="Search"
            />
            {search && (
              <InputGroupAddon>
                <Button variant="ghost" size="icon" className="size-6 p-0 hover:bg-muted text-muted-foreground" onClick={() => onSearchChange("")} aria-label="Clear search">
                  <X className="size-3.5" />
                </Button>
              </InputGroupAddon>
            )}
          </InputGroup>
        </div>
        {toolbar}
      </div>

      {selectedItems.length > 0 && bulkBar && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-primary/5 border-b border-border/40">
          <span className="text-xs font-semibold text-primary">{selectedItems.length} selected</span>
          {bulkBar(selectedItems, clearSelection)}
          <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={clearSelection}>
            <X /> Clear
          </Button>
        </div>
      )}

      <div className="overflow-auto no-scrollbar w-full" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
        <Table className="w-full text-left border-collapse">
          <TableHeader className="bg-card/70 sticky top-0 z-10 shadow-2xs border-b-transparent!">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent border-none!">
                {headerGroup.headers.map((tableHeader) => {
                  const sortField = sortFieldByColumnId?.[tableHeader.column.id];
                  const isSortedBy = !!sortField && sort?.field === sortField;
                  return (
                    <TableHead
                      key={tableHeader.id}
                      aria-sort={!sortField ? undefined : isSortedBy ? (sort!.direction === "asc" ? "ascending" : "descending") : "none"}
                      className="h-11 px-4 text-xs font-medium tracking-tight text-muted-foreground whitespace-nowrap"
                    >
                      {tableHeader.isPlaceholder ? null : flexRender(tableHeader.column.columnDef.header, tableHeader.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody className="divide-y divide-border/20 border-t-transparent">
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={
                    onRowClick
                      ? "hover:bg-muted/80 group hover:cursor-pointer transition-colors duration-200 data-[state=selected]:bg-muted/60"
                      : "hover:bg-muted/80 data-[state=selected]:bg-muted/60"
                  }
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="px-4 py-5 align-middle whitespace-nowrap">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center text-muted-foreground">
                  {emptyMessage ?? (search ? `No results matching "${search}"` : "No results found.")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end px-4 py-2.5 bg-muted/20 border-t border-border/40 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          {search && <span className="text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded font-medium">Filtered</span>}
          <DropdownMenu>
            <DropdownMenuTrigger className="mr-2" render={<Button variant="ghost">Rows {pageSize} <ChevronDown /></Button>} />
            <DropdownMenuContent side="top" align="end" sideOffset={4} className="w-20 p-1 space-y-1">
              {[5, 10, 20, 50, 100].map((size) => (
                <DropdownMenuItem key={size} onClick={() => setPagination({ pageIndex: 0, pageSize: size })}>
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
              <Button variant="outline" size="icon" className="bg-transparent! border-none!" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} title="Previous page" aria-label="Previous page">
                <ChevronLeft className="size-4" />
              </Button>
              <Button variant="outline" size="icon" className="bg-transparent! border-none!" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} title="Next page" aria-label="Next page">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
