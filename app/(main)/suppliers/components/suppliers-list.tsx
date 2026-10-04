"use client";

import PageHeader from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { KpiCard, KpiRow } from "@/components/data-table/kpi-card";
import { SavedViewBar } from "@/components/data-table/saved-view-bar";
import { FilterSelect } from "@/components/data-table/filter-select";
import { DataTable } from "@/components/data-table/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertCircle,
  BookAIcon,
  BookAlert,
  ChevronDown,
  Command,
  DollarSign,
  Download,
  GitBranch,
  MoreVertical,
  Plus,
  SlidersHorizontal,
  Truck,
  X,
} from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useMemo, useState } from "react";

import { useFilteredRows } from "@/hooks/use-filtered-rows";
import { cn } from "@/lib/utils";
import { TONE_TEXT } from "@/lib/ui/tone";

import {
  RELIABILITY_LABELS,
  SERVICE_CATEGORY_LABELS,
  SUPPLIER_TYPE_LABELS,
} from "@/lib/data/suppliers-copy";
import { computeSupplierKpis, largestCurrencyDue } from "@/lib/data/suppliers";
import { useSuppliers } from "../suppliers-store";
import {
  EMPTY_SUPPLIER_FILTERS,
  SUPPLIER_SAVED_VIEWS,
  type SupplierFilters,
  type SupplierListItem,
  type SupplierQuickFilter,
  type SupplierSavedView,
} from "../types";
import {
  DEFAULT_SUPPLIER_SORT,
  activeFilterCount,
  applySavedView,
  formatMoney,
  matchesSupplierFilters,
  matchesSupplierSearch,
  sortSuppliers,
  type SupplierSort,
} from "../utils";
import { buildSupplierColumns } from "../suppliers-table/suppliers-columns";
import { downloadTextFile, suppliersToCsv, timestampedFilename } from "../csv";
import AddSupplierSheet from "./add-supplier-sheet";
import SetReliabilityDialog from "./set-reliability-dialog";
import CreateCommitmentSheet from "./create-commitment-sheet";
import ImportSuppliersDialog from "./import-suppliers-dialog";

const SuppliersList = () => {
  const { suppliers, groupOptions, nowIso, can } = useSuppliers();
  const router = useRouter();

  const [savedView, setSavedView] =
    useState<SupplierSavedView>("All Suppliers");
  const [quickFilter, setQuickFilter] = useState<SupplierQuickFilter | null>(
    null,
  );
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [reliabilityTarget, setReliabilityTarget] =
    useState<SupplierListItem | null>(null);
  const [commitmentTarget, setCommitmentTarget] =
    useState<SupplierListItem | null>(null);

  const locationOptions = useMemo(
    () =>
      [
        ...new Set(
          suppliers.map((s) => s.city).filter((c): c is string => Boolean(c)),
        ),
      ].map((c) => ({
        value: c,
        label: c,
      })),
    [suppliers],
  );

  /**
   * The saved view and the quick filter both narrow the list from state the
   * hook cannot key its memos on, so they are applied before it sees the
   * rows. See the purity contract in `hooks/use-filtered-rows.ts`.
   */
  const scopedSuppliers = useMemo(() => {
    return applySavedView(suppliers, savedView).filter((item) => {
      if (quickFilter === "confirmationsPending" && item.pendingCount === 0)
        return false;
      if (quickFilter === "issues" && item.issueCount === 0) return false;
      if (quickFilter === "paymentsDue" && item.outstandingAmount <= 0)
        return false;
      return true;
    });
  }, [suppliers, savedView, quickFilter]);

  const list = useFilteredRows<SupplierListItem, SupplierFilters, SupplierSort>({
    rows: scopedSuppliers,
    emptyFilters: EMPTY_SUPPLIER_FILTERS,
    initialSort: DEFAULT_SUPPLIER_SORT,
    searchPredicate: matchesSupplierSearch,
    matches: matchesSupplierFilters,
    sortRows: sortSuppliers,
  });

  const { filters, setFilter, sort, setSort } = list;
  const sorted = list.rows;
  const kpis = useMemo(
    () => computeSupplierKpis(sorted, nowIso),
    [sorted, nowIso],
  );
  const paymentsDue = useMemo(
    () => largestCurrencyDue(kpis.paymentsDueByCurrency),
    [kpis],
  );

  const columns = useMemo(
    () =>
      buildSupplierColumns(
        {
          onOpen: (item) => router.push(`/suppliers/${item.id}`),
          onAddCommitment: (item) => setCommitmentTarget(item),
          onSetReliability: (item) => setReliabilityTarget(item),
        },
        nowIso,
        can.viewCosts,
        can.createCommitment,
        sort,
        (next) => setSort(next as SupplierSort),
      ),
    [router, nowIso, can.viewCosts, can.createCommitment, sort, setSort],
  );

  const exportCsv = () => {
    downloadTextFile(timestampedFilename("suppliers"), suppliersToCsv(sorted));
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={[
          { title: "Home", link: "/dashboard" },
          { title: "Operations", link: "/operations" },
          { title: "Suppliers", link: "/suppliers" },
        ]}
        title="Suppliers"
        subTitle="Manage hotels, brokers, transport providers, catering partners, and service confirmations."
        action={
          <div className="flex items-center gap-2">
            {can.createSupplier && (
              <Button variant="secondary" onClick={() => setAddOpen(true)}>
                <Plus /> Add Supplier
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline_without_border">
                    <MoreVertical />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>More</DropdownMenuLabel>
                {can.createSupplier && can.importExport && (
                  <DropdownMenuItem onClick={() => setImportOpen(true)}>
                    Import Suppliers
                  </DropdownMenuItem>
                )}
                {can.importExport && (
                  <DropdownMenuItem onClick={exportCsv}>
                    <Download /> Export Directory
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <KpiRow>
        <KpiCard
          icon={<Truck className="size-4 text-muted-foreground" />}
          title="Active Suppliers"
          value={String(kpis.activeSuppliers)}
          desc="Available for current operations"
        />
        <KpiCard
          icon={<GitBranch className="size-4 text-muted-foreground" />}
          title="Active Commitments"
          value={String(kpis.activeCommitments)}
          desc="Across active Departure Groups"
        />
        <button
          className="text-left"
          onClick={() =>
            setQuickFilter(
              quickFilter === "confirmationsPending"
                ? null
                : "confirmationsPending",
            )
          }
        >
          <KpiCard
            title="Confirmations Pending"
            icon={<BookAlert className={cn("size-4", TONE_TEXT.warning)} />}
            value={String(kpis.confirmationsPending)}
            desc="Requires supplier follow-up"
          />
        </button>
        {can.viewCosts && (
          <button
            className="text-left"
            onClick={() =>
              setQuickFilter(
                quickFilter === "paymentsDue" ? null : "paymentsDue",
              )
            }
          >
            <KpiCard
              title="Supplier Payments Due"
              icon={<DollarSign className="size-4 text-muted-foreground" />}
              value={
                paymentsDue.currency
                  ? formatMoney(paymentsDue.amount, paymentsDue.currency)
                  : "—"
              }
              desc={
                paymentsDue.otherCount > 0
                  ? `Next 14 days · +${paymentsDue.otherCount} more currencies`
                  : "Next 14 days"
              }
            />
          </button>
        )}
        <button
          className="text-left"
          onClick={() =>
            setQuickFilter(quickFilter === "issues" ? null : "issues")
          }
        >
          <KpiCard
            title="Supplier Issues"
            icon={<AlertCircle className="size-4 text-destructive" />}
            value={String(kpis.supplierIssues)}
            desc="Late, disputed, or incomplete commitments"
          />
        </button>
      </KpiRow>

      <SavedViewBar
        views={SUPPLIER_SAVED_VIEWS}
        active={savedView}
        onChange={setSavedView}
      />

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Supplier Type"
          value={filters.supplierType}
          options={Object.entries(SUPPLIER_TYPE_LABELS).map(
            ([value, label]) => ({ value, label }),
          )}
          onChange={(v) => setFilter("supplierType", v)}
        />
        <FilterSelect
          label="Service Category"
          value={filters.serviceCategory}
          options={Object.entries(SERVICE_CATEGORY_LABELS).map(
            ([value, label]) => ({ value, label }),
          )}
          onChange={(v) => setFilter("serviceCategory", v)}
        />
        <FilterSelect
          label="Location"
          value={filters.location}
          options={locationOptions}
          onChange={(v) => setFilter("location", v)}
        />
        <FilterSelect
          label="Active Status"
          value={filters.activeStatus}
          options={[
            { value: "ACTIVE", label: "Active" },
            { value: "INACTIVE", label: "Inactive" },
          ]}
          onChange={(v) => setFilter("activeStatus", v)}
        />
        <Button
          variant="outline_without_border"
          size="sm"
          className="gap-1.5 text-muted-foreground bg-transparent dark:bg-transparent shadow-none!"
          onClick={() => setShowMoreFilters((v) => !v)}
        >
          <SlidersHorizontal className="size-3.5" /> More Filters{" "}
          <ChevronDown />
        </Button>
        {activeFilterCount(filters) > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={list.clearFilters}
          >
            <X /> Clear filters
          </Button>
        )}
      </div>

      {showMoreFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            label="Commitment Status"
            value={filters.commitmentStatus}
            options={[
              { value: "PENDING", label: "Has Pending" },
              { value: "CONFIRMED", label: "Has Confirmed" },
              { value: "ISSUES", label: "Has Issues" },
            ]}
            onChange={(v) => setFilter("commitmentStatus", v)}
          />
          <FilterSelect
            label="Reliability"
            value={filters.reliability}
            options={Object.entries(RELIABILITY_LABELS).map(
              ([value, label]) => ({ value, label }),
            )}
            onChange={(v) => setFilter("reliability", v)}
          />
          {can.viewCosts && (
            <FilterSelect
              label="Payment Status"
              value={filters.paymentStatus}
              options={[
                { value: "DUE", label: "Payment Due" },
                { value: "CLEAR", label: "Up to Date" },
              ]}
              onChange={(v) => setFilter("paymentStatus", v)}
            />
          )}
        </div>
      )}

      <div className={cn("transition-opacity duration-150", list.isStale && "opacity-60 pointer-events-none")}>
      <DataTable<SupplierListItem>
        columns={columns}
        data={sorted}
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search supplier name, contact, hotel, city, service…"
        onRowClick={(item) => router.push(`/suppliers/${item.id}`)}
        getRowId={(item) => item.id}
        resetPageToken={`${savedView}-${quickFilter}-${list.resetPageToken}`}
        sort={{ field: sort.field, direction: sort.direction }}
        sortFieldByColumnId={{
          supplier: "name",
          activeGroups: "activeGroupCount",
          paymentStatus: "outstandingAmount",
          reliability: "reliability",
        }}
      />

      </div>
      <AddSupplierSheet open={addOpen} onClose={() => setAddOpen(false)} />
      <ImportSuppliersDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        existingCodes={suppliers.map((s) => s.supplierCode)}
      />
      <SetReliabilityDialog
        supplier={
          reliabilityTarget
            ? {
                id: reliabilityTarget.id,
                name: reliabilityTarget.name,
                reliability: reliabilityTarget.reliability,
              }
            : null
        }
        onClose={() => setReliabilityTarget(null)}
      />
      <CreateCommitmentSheet
        supplier={
          commitmentTarget
            ? {
                id: commitmentTarget.id,
                name: commitmentTarget.name,
                currency: commitmentTarget.currency,
              }
            : null
        }
        groupOptions={groupOptions}
        canViewCosts={can.viewCosts}
        open={commitmentTarget !== null}
        onClose={() => setCommitmentTarget(null)}
      />
    </div>
  );
};

export default SuppliersList;
