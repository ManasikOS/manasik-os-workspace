"use client";

import { Calendar } from "@/components/ui/calendar";
import { ButtonGroup } from "@/components/ui/button-group";
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
import { format } from "date-fns";
import { Clock } from "lucide-react";
import React, { useState } from "react";

/**
 * Shared date/date-time picker primitives used across the departure-group
 * detail dialogs (flights, accommodation, transport, readiness, documents).
 * Originally lived inside add-edit-flight-dialog.tsx — pulled out because
 * unrelated dialogs importing UI primitives from the largest, most volatile
 * feature file meant any flight-dialog edit risked breaking them.
 */

/** "2026-09-20T14:30:00.000Z" -> "2026-09-20T14:30" in the browser's local time. */
export function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const value = Date.parse(iso);
  if (Number.isNaN(value)) return "";
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/**
 * Calendar + time input combined into one popover. Fixes the previous
 * date-only picker that silently defaulted time to midnight — critical here
 * because layover chronology depends on minute-precise timestamps.
 */
export function DateTimePicker({
  label,
  required,
  value,
  onChange,
  placeholder = "Pick date & time",
  disabled,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dateOnly = value ? new Date(value) : undefined;
  const timeOnly = value ? value.slice(11, 16) : "";
  const display = value ? format(new Date(value), "PP · p") : placeholder;

  const pad = (n: number) => String(n).padStart(2, "0");

  const handleDate = (d: Date | undefined) => {
    if (!d) {
      onChange("");
      return;
    }
    const t = timeOnly || "09:00";
    onChange(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${t}`,
    );
  };

  const handleTime = (t: string) => {
    if (!value) {
      const today = new Date();
      onChange(
        `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}T${t || "09:00"}`,
      );
      return;
    }
    onChange(`${value.slice(0, 10)}T${t || "00:00"}`);
  };

  return (
    <InputGroup className="cursor-pointer">
      <InputGroupAddon align="block-start">
        <InputGroupText>
          {label} {required && <span className="text-destructive">*</span>}
        </InputGroupText>
      </InputGroupAddon>
      <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
        <PopoverTrigger disabled={disabled} className="w-full">
          <ButtonGroup className="w-full items-center cursor-pointer">
            <InputGroupInput
              readOnly
              disabled={disabled}
              value={display}
              className={
                value
                  ? "cursor-pointer"
                  : "cursor-pointer text-muted-foreground"
              }
            />
          </ButtonGroup>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={dateOnly}
            onSelect={handleDate}
            defaultMonth={dateOnly}
          />
          <div className="border-t p-3 flex items-center gap-2">
            <InputGroup>
              <Clock className="size-4 text-muted-foreground shrink-0" />
              <InputGroupInput
                type="time"
                value={timeOnly}
                onChange={(e) => handleTime(e.target.value)}
                className="tabular-nums"
                step={60}
              />
            </InputGroup>
          </div>
        </PopoverContent>
      </Popover>
    </InputGroup>
  );
}

export function DatePicker({
  label,
  required,
  value,
  onChange,
  placeholder = "Pick date",
  disabled,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dateOnly = value ? new Date(value) : undefined;
  const display = value ? format(new Date(value), "PP") : placeholder;

  const pad = (n: number) => String(n).padStart(2, "0");

  const handleDate = (d: Date | undefined) => {
    if (!d) {
      onChange("");
      return;
    }
    onChange(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  };

  return (
    <InputGroup className="cursor-pointer">
      <InputGroupAddon align="block-start">
        <InputGroupText>
          {label} {required && <span className="text-destructive">*</span>}
        </InputGroupText>
      </InputGroupAddon>
      <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
        <PopoverTrigger disabled={disabled} className="w-full">
          <ButtonGroup className="w-full items-center cursor-pointer">
            <InputGroupInput
              readOnly
              disabled={disabled}
              value={display}
              className={
                value
                  ? "cursor-pointer"
                  : "cursor-pointer text-muted-foreground"
              }
            />
          </ButtonGroup>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={dateOnly}
            onSelect={handleDate}
            defaultMonth={dateOnly}
          />
        </PopoverContent>
      </Popover>
    </InputGroup>
  );
}
