"use client";

import { format } from "date-fns";
import type { ReactNode } from "react";

import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** A labelled input with its error or hint underneath. */
export function Field({
  label,
  required,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <InputGroup>
        <InputGroupAddon align="block-start">
          <InputGroupText>
            {label}
            {required && <span className="text-destructive"> *</span>}
          </InputGroupText>
        </InputGroupAddon>
        {children}
      </InputGroup>
      {error ? (
        <span role="alert" className="text-[11px] text-destructive">
          {error}
        </span>
      ) : hint ? (
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

export function SelectMenu({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="w-full">
        <InputGroupInput
          value={selected?.label ?? "Select..."}
          readOnly
          className="w-full cursor-pointer"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        {options.map((option) => (
          <DropdownMenuItem key={option.value} onClick={() => onChange(option.value)}>
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A date shown as text that opens a calendar. */
export function DateField({
  label,
  required,
  value,
  onSelect,
  disabledBefore,
}: {
  label: string;
  required?: boolean;
  value: Date;
  onSelect: (date: Date) => void;
  disabledBefore?: Date;
}) {
  return (
    <Popover>
      <PopoverTrigger>
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>
              {label}
              {required && <span className="text-destructive"> *</span>}
            </InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            readOnly
            className="cursor-pointer"
            value={format(value, "PPP")}
          />
        </InputGroup>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(date) => {
            if (date) onSelect(date);
          }}
          defaultMonth={value}
          disabled={disabledBefore ? { before: disabledBefore } : undefined}
        />
      </PopoverContent>
    </Popover>
  );
}
