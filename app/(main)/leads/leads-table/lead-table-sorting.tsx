"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  Check,
  ChevronDown,
} from "lucide-react";
import React from "react";

import {
  DEFAULT_LEAD_SORT,
  LEAD_SORT_OPTIONS,
  type LeadSort,
  type LeadSortField,
} from "../utils";

interface LeadTableSortingProps {
  sort: LeadSort;
  onChange: (sort: LeadSort) => void;
}

/**
 * The table's sort control. Field and direction share one menu because the
 * direction wording only makes sense against a chosen field ("Soonest first"
 * vs "Lowest first").
 *
 * This replaces the two decorative "All stages" / "Trip type" dropdowns that
 * used to sit here: they rendered menu items whose only handler was
 * `stopPropagation`, so clicking one did nothing at all.
 */
const LeadTableSorting = ({ sort, onChange }: LeadTableSortingProps) => {
  const active =
    LEAD_SORT_OPTIONS.find((option) => option.field === sort.field) ??
    LEAD_SORT_OPTIONS[0];

  const isDefault =
    sort.field === DEFAULT_LEAD_SORT.field &&
    sort.direction === DEFAULT_LEAD_SORT.direction;

  const chooseField = (field: LeadSortField) => {
    const option = LEAD_SORT_OPTIONS.find((entry) => entry.field === field);
    // Adopt the direction that field is most useful in, not the current one.
    onChange({ field, direction: option?.defaultDirection ?? "asc" });
  };

  const flip = () =>
    onChange({
      field: sort.field,
      direction: sort.direction === "asc" ? "desc" : "asc",
    });

  const directionLabel =
    sort.direction === "asc" ? active.ascLabel : active.descLabel;

  return (
    <div className="flex gap-1 items-center">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              className={cn(
                "font-normal",
                isDefault ? "text-muted-foreground" : "text-foreground",
              )}
            >
              Sort: {active.label}
              <ChevronDown />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          {LEAD_SORT_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.field}
              onClick={() => chooseField(option.field)}
            >
              <span className="flex-1">{option.label}</span>
              {option.field === sort.field && (
                <Check className="size-3.5 text-primary" />
              )}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Order</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => onChange({ field: sort.field, direction: "asc" })}
          >
            <ArrowUpNarrowWide />
            <span className="flex-1">{active.ascLabel}</span>
            {sort.direction === "asc" && (
              <Check className="size-3.5 text-primary" />
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onChange({ field: sort.field, direction: "desc" })}
          >
            <ArrowDownNarrowWide />
            <span className="flex-1">{active.descLabel}</span>
            {sort.direction === "desc" && (
              <Check className="size-3.5 text-primary" />
            )}
          </DropdownMenuItem>

          {!isDefault && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onChange(DEFAULT_LEAD_SORT)}>
                Reset to next follow-up
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Quick flip without reopening the menu. */}
      <Button
        variant="ghost"
        size="icon"
        onClick={flip}
        title={directionLabel}
        aria-label={`Change sort order — currently ${directionLabel}`}
      >
        {sort.direction === "asc" ? (
          <ArrowUpNarrowWide className="size-4 text-muted-foreground" />
        ) : (
          <ArrowDownNarrowWide className="size-4 text-muted-foreground" />
        )}
      </Button>
    </div>
  );
};

export default LeadTableSorting;
