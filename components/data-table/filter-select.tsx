"use client";

import { ChevronDown } from "lucide-react";
import React from "react";

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

export const ALL_FILTER_VALUE = "ALL";

export interface FilterOption {
  value: string;
  label: string;
}

/** One filter chip, shared shape across every module's filter row. */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}) {
  const active = value !== ALL_FILTER_VALUE;
  const selected = options.find((option) => option.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline_without_border"
            size="sm"
            className={cn(
              "gap-1.5 text-muted-foreground bg-transparent dark:bg-transparent shadow-none!",
              active && "bg-primary/10! text-primary",
            )}
          >
            {active ? `${label}: ${selected?.label}` : label}
            <ChevronDown />
          </Button>
        }
      />
      {/* Capped and scrollable: an owner or package filter can list every
          staff member or template in the agency, which otherwise runs off
          the bottom of the viewport. Ported from the Leads module's own
          copy of this component when the two were merged. */}
      <DropdownMenuContent
        align="start"
        className="min-w-48 max-h-80 overflow-y-auto"
      >
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onChange(ALL_FILTER_VALUE)}>
          All
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
