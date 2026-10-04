"use client";

import { Check, Filter, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { ALL_FILTER_VALUE, type FilterOption } from "./filter-select";

export interface FilterMenuGroup<TKey extends string = string> {
  key: TKey;
  label: string;
  value: string;
  options: FilterOption[];
}

interface FilterMenuProps<TKey extends string> {
  groups: FilterMenuGroup<TKey>[];
  onChange: (key: TKey, value: string) => void;
  onClear: () => void;
  label?: string;
  allLabel?: string;
  /** Active filters controlled outside the menu, such as KPI quick filters. */
  additionalActiveCount?: number;
  className?: string;
}

/**
 * Compact, reusable filter control for a DataTable toolbar. Each filter group
 * opens as a submenu so screens with many filters do not need a second row of
 * controls beneath their tabs.
 */
export function FilterMenu<TKey extends string>({
  groups,
  onChange,
  onClear,
  label = "Filters",
  allLabel = "All",
  additionalActiveCount = 0,
  className,
}: FilterMenuProps<TKey>) {
  const activeCount =
    groups.filter((group) => group.value !== ALL_FILTER_VALUE).length +
    additionalActiveCount;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            className={cn(
              "h-10 gap-2 bg-background shadow-xs",
              activeCount > 0 && "border-primary/40 text-primary",
              className,
            )}
          >
            <Filter className="size-4" />
            <span>{label}</span>
            {activeCount > 0 && (
              <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                {activeCount}
              </span>
            )}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel>Filter by</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {groups.map((group) => {
          const selected = group.options.find(
            (option) => option.value === group.value,
          );

          return (
            <DropdownMenuSub key={group.key}>
              <DropdownMenuSubTrigger>
                <span className="flex-1">{group.label}</span>
                {selected && (
                  <span className="max-w-28 truncate text-xs text-primary">
                    {selected.label}
                  </span>
                )}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-52 max-h-80 overflow-y-auto">
                <DropdownMenuItem
                  onClick={() => onChange(group.key, ALL_FILTER_VALUE)}
                >
                  {allLabel}
                  <Check
                    className={cn(
                      "size-4",
                      group.value !== ALL_FILTER_VALUE && "invisible",
                    )}
                  />
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {group.options.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={() => onChange(group.key, option.value)}
                  >
                    {option.label}
                    <Check
                      className={cn(
                        "size-4",
                        group.value !== option.value && "invisible",
                      )}
                    />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}
        {activeCount > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onClear}>
              <RotateCcw className="size-4" />
              Clear all filters
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
