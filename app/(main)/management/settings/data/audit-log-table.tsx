"use client";

import { useMemo, useState } from "react";

import { ALL_FILTER_VALUE, FilterSelect } from "@/components/data-table/filter-select";
import { DataTable } from "@/components/data-table/data-table";
import { AUDIT_SOURCE_LABELS } from "@/lib/data/settings-copy";
import type { AuditLogRow } from "@/lib/types/settings";

import { auditLogColumns } from "./audit-columns";

import { displayActorName } from "@/lib/agent/identity";
const SOURCE_OPTIONS = [
  { value: ALL_FILTER_VALUE, label: "All sources" },
  ...Object.entries(AUDIT_SOURCE_LABELS).map(([value, label]) => ({ value, label })),
];

export function AuditLogTable({ rows }: { rows: AuditLogRow[] }) {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState(ALL_FILTER_VALUE);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (source !== ALL_FILTER_VALUE && row.source !== source) return false;
      if (!query) return true;
      return (
        displayActorName(row.actor_name_snapshot).toLowerCase().includes(query) ||
        row.action.toLowerCase().includes(query) ||
        row.entity_label.toLowerCase().includes(query)
      );
    });
  }, [rows, search, source]);

  return (
    <DataTable
      columns={auditLogColumns}
      data={filtered}
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="Search by user, action or entity..."
      emptyMessage="No audit activity yet."
      resetPageToken={source}
      toolbar={<FilterSelect label="Source" value={source} options={SOURCE_OPTIONS} onChange={setSource} />}
    />
  );
}
