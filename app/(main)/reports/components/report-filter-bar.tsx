"use client";

import React, { useCallback, useTransition } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { ALL_FILTER_VALUE, FilterSelect, type FilterOption } from "@/components/data-table/filter-select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import type { ComparisonMode, ReportFilters } from "../types";
import { formatShortDate } from "../utils";

const PERIOD_OPTIONS: FilterOption[] = [
  { value: "TODAY", label: "Today" },
  { value: "THIS_WEEK", label: "This Week" },
  { value: "THIS_MONTH", label: "This Month" },
  { value: "THIS_QUARTER", label: "This Quarter" },
  { value: "THIS_YEAR", label: "This Year" },
  { value: "LAST_MONTH", label: "Last Month" },
  { value: "LAST_QUARTER", label: "Last Quarter" },
  { value: "CUSTOM", label: "Custom Range" },
];

const COMPARE_OPTIONS: FilterOption[] = [
  { value: "PREVIOUS_PERIOD", label: "Previous Period" },
  { value: "SAME_PERIOD_LAST_YEAR", label: "Same Period Last Year" },
  { value: "NONE", label: "None" },
];

const JOURNEY_OPTIONS: FilterOption[] = [
  { value: "UMRAH", label: "Umrah" },
  { value: "HAJJ", label: "Hajj" },
  { value: "EARLY_REGISTRATION", label: "Early Registration" },
];

/**
 * The six global filter chips. Filter state lives in `searchParams`, never
 * in React state (plan D1) — a saved report, an export filename and a
 * dashboard drill-down are all just this filter set, so there is exactly one
 * mechanism for all three.
 *
 * `disabledFilters` lets a report override a chip it does not support (plan
 * F4 — Sales reports are not branch-scoped; Aging is always "as of now").
 */
export function ReportFilterBar({
  filters,
  branchOptions = [],
  packageOptions = [],
  groupOptions = [],
  showBranch = true,
  disabledFilters = [],
  disabledReason,
}: {
  filters: ReportFilters;
  branchOptions?: FilterOption[];
  packageOptions?: FilterOption[];
  groupOptions?: FilterOption[];
  showBranch?: boolean;
  disabledFilters?: (keyof ReportFilters)[];
  disabledReason?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /**
   * Reports genuinely filters on the server — the period-based aggregates
   * are computed in SQL, not narrowed from rows the browser already holds,
   * so unlike every other list screen this one has to navigate.
   *
   * `startTransition` is what keeps that from *looking* like a page load.
   * Without it, `router.replace` unmounts the route and Next renders
   * `app/(main)/reports/loading.tsx`, so every filter click flashed a
   * full-page skeleton. Inside a transition React keeps the current report
   * on screen until the new one is ready; `isPending` just dims it.
   */
  const [isPending, startTransition] = useTransition();

  const navigate = useCallback(
    (next: URLSearchParams) => {
      startTransition(() => {
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      });
    },
    [pathname, router],
  );

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value === null || value === ALL_FILTER_VALUE) next.delete(key);
      else next.set(key, value);
      navigate(next);
    },
    [navigate, searchParams],
  );

  const isDisabled = (key: keyof ReportFilters) => disabledFilters.includes(key);

  return (
    <div
      className={cn(
        "flex flex-col gap-2 transition-opacity duration-150",
        // The controls stay live and the report stays on screen; only the
        // opacity says "recomputing". Never a skeleton.
        isPending && "opacity-60",
      )}
      aria-busy={isPending}
    >
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Period"
          value={filters.period}
          options={PERIOD_OPTIONS}
          onChange={(v) => setParam("period", v === ALL_FILTER_VALUE ? "THIS_MONTH" : v)}
        />

        {filters.period === "CUSTOM" && (
          <Popover>
            <PopoverTrigger>
              <Button variant="outline_without_border" size="sm" className="gap-1.5 text-muted-foreground">
                <CalendarIcon className="size-3.5" />
                {filters.customFrom ? formatShortDate(filters.customFrom) : "From"} –{" "}
                {filters.customTo ? formatShortDate(filters.customTo) : "To"}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="range"
                selected={{
                  from: filters.customFrom ? new Date(filters.customFrom) : undefined,
                  to: filters.customTo ? new Date(filters.customTo) : undefined,
                }}
                onSelect={(range) => {
                  const next = new URLSearchParams(searchParams.toString());
                  if (range?.from) next.set("from", range.from.toISOString());
                  else next.delete("from");
                  if (range?.to) next.set("to", range.to.toISOString());
                  else next.delete("to");
                  navigate(next);
                }}
              />
            </PopoverContent>
          </Popover>
        )}

        <FilterSelect
          label="Compare With"
          value={filters.compare}
          options={COMPARE_OPTIONS}
          onChange={(v) => setParam("compare", v as ComparisonMode)}
        />

        {showBranch && (
          <div title={isDisabled("branch") ? disabledReason : undefined}>
            <FilterSelect
              label="Branch"
              value={isDisabled("branch") ? ALL_FILTER_VALUE : (filters.branch ?? ALL_FILTER_VALUE)}
              options={branchOptions}
              onChange={(v) => setParam("branch", v)}
            />
          </div>
        )}

        <div title={isDisabled("journey") ? disabledReason : undefined}>
          <FilterSelect
            label="Journey"
            value={isDisabled("journey") ? ALL_FILTER_VALUE : (filters.journey ?? ALL_FILTER_VALUE)}
            options={JOURNEY_OPTIONS}
            onChange={(v) => setParam("journey", v)}
          />
        </div>

        <div title={isDisabled("packageId") ? disabledReason : undefined}>
          <FilterSelect
            label="Package"
            value={isDisabled("packageId") ? ALL_FILTER_VALUE : (filters.packageId ?? ALL_FILTER_VALUE)}
            options={packageOptions}
            onChange={(v) => setParam("package", v)}
          />
        </div>

        <div title={isDisabled("departureGroupId") ? disabledReason : undefined}>
          <FilterSelect
            label="Departure Group"
            value={isDisabled("departureGroupId") ? ALL_FILTER_VALUE : (filters.departureGroupId ?? ALL_FILTER_VALUE)}
            options={groupOptions}
            onChange={(v) => setParam("group", v)}
          />
        </div>
      </div>
    </div>
  );
}
