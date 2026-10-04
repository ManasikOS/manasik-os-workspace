"use client";

import { FilterSelect } from "@/components/data-table/filter-select";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useDeferredValue, useMemo, useState } from "react";

import { toast } from "@/components/ui/toast";
import { SERVICE_KIND_LABELS } from "@/lib/data/operations-copy";

import { confirmSupplierServiceAction } from "../../actions";
import { useOperations } from "../../operations-store";
import {
  ALL,
  EMPTY_SUPPLIER_FILTERS,
  type OperationsSupplierRow,
  type SupplierFilters,
} from "../../types";
import { SUPPLIER_STATUS_LABELS, matchesSupplierFilters, matchesSupplierSearch, sortSupplierRows } from "../../utils";
import { buildSupplierColumns } from "../../operations-table/supplier-columns";
import { OperationsDataTable } from "../../operations-table/operations-data-table";
import RecordSupplierDetailsDialog from "../record-supplier-details-dialog";

/**
 * The operational supplier board — every promised service that must be
 * confirmed for active groups. Flights, Makkah/Madinah accommodation and
 * every transport route already have a schema home; Catering, Guide
 * services, Insurance and Other are not yet modelled (see the module's
 * implementation plan, F10) and do not appear here until they are.
 */
const SupplierConfirmationsTab = () => {
  const router = useRouter();
  const { snapshot, can } = useOperations();

  const [searchInput, setSearchInput] = useState("");
  const search = useDeferredValue(searchInput);
  const [filters, setFilters] = useState<SupplierFilters>(EMPTY_SUPPLIER_FILTERS);
  const [detailsTarget, setDetailsTarget] = useState<OperationsSupplierRow | null>(null);

  const setFilter = (key: keyof SupplierFilters, value: string) => setFilters((prev) => ({ ...prev, [key]: value }));

  const groupOptions = useMemo(
    () => [...new Map(snapshot.supplierRows.map((r) => [r.groupId, r.groupName])).entries()].map(([value, label]) => ({ value, label })),
    [snapshot.supplierRows],
  );

  const filtered = useMemo(
    () => snapshot.supplierRows.filter((r) => matchesSupplierFilters(r, filters) && matchesSupplierSearch(r, search)),
    [snapshot.supplierRows, filters, search],
  );
  const sorted = useMemo(() => sortSupplierRows(filtered), [filtered]);

  const columns = useMemo(
    () =>
      buildSupplierColumns(
        {
          onOpen: (row) => setDetailsTarget(row),
          onRecordDetails: (row) => setDetailsTarget(row),
          onConfirm: async (row) => {
            const result = await confirmSupplierServiceAction({ id: row.id, departureGroupId: row.groupId, serviceKind: row.serviceKind });
            if (!result.ok) {
              toast.add({ title: "Could not confirm", description: result.error });
              return;
            }
            toast.add({ title: "Supplier confirmed", description: row.serviceLabel });
          },
          onOpenGroup: (row) => router.push(`/departure-groups/${row.groupId}`),
        },
        can.confirmSupplier,
      ),
    [can.confirmSupplier, router],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label="Departure Group" value={filters.groupId} options={groupOptions} onChange={(v) => setFilter("groupId", v)} />
        <FilterSelect
          label="Service"
          value={filters.serviceKind}
          options={Object.entries(SERVICE_KIND_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(v) => setFilter("serviceKind", v)}
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          options={Object.entries(SUPPLIER_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(v) => setFilter("status", v)}
        />
        {Object.values(filters).some((v) => v !== ALL) && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setFilters(EMPTY_SUPPLIER_FILTERS)}>
            <X /> Clear filters
          </Button>
        )}
      </div>

      <OperationsDataTable
        columns={columns}
        data={sorted}
        getRowId={(row) => row.id}
        search={search}
        onSearchChange={setSearchInput}
        searchPlaceholder="Search service, supplier, reference, departure group…"
        onRowClick={(row) => setDetailsTarget(row)}
        resetPageToken={`${search}-${JSON.stringify(filters)}`}
      />

      <RecordSupplierDetailsDialog row={detailsTarget} open={detailsTarget !== null} onClose={() => setDetailsTarget(null)} />
    </div>
  );
};

export default SupplierConfirmationsTab;
