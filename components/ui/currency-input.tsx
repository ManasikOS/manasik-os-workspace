"use client";

import React, { useRef, useLayoutEffect, useState } from "react";
import { InputGroupInput } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

export interface CurrencyInputProps extends Omit<
  React.ComponentProps<typeof InputGroupInput>,
  "value" | "onChange"
> {
  value: number | "" | undefined | null;
  onValueChange: (val: number | "") => void;
}

export const formatCurrency = (val: number | "" | undefined | null): string => {
  if (val === "" || val === undefined || val === null || isNaN(Number(val)))
    return "";
  return Number(val).toLocaleString("en-US");
};

export const parseCurrency = (input: string): number | "" => {
  const stripped = input.replace(/,/g, "");
  if (stripped === "") return "";
  if (!/^\d*\.?\d*$/.test(stripped)) return "";
  const num = parseFloat(stripped);
  return isNaN(num) ? "" : num;
};

export const CurrencyInput = React.forwardRef<
  HTMLInputElement,
  CurrencyInputProps
>(({ value, onValueChange, className, ...props }, ref) => {
  const localRef = useRef<HTMLInputElement | null>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const [, setTick] = useState(0);

  const displayValue = formatCurrency(value);

  // Sync internal ref with forwarded ref
  const setRef = (node: HTMLInputElement | null) => {
    localRef.current = node;
    if (typeof ref === "function") {
      ref(node);
    } else if (ref) {
      (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
    }
  };

  useLayoutEffect(() => {
    if (pendingCaretRef.current !== null && localRef.current) {
      const targetPos = pendingCaretRef.current;
      localRef.current.setSelectionRange(targetPos, targetPos);
      pendingCaretRef.current = null;
    }
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputEl = e.target;
    const caret = inputEl.selectionStart ?? 0;
    const rawVal = inputEl.value;
    const digitsBeforeCaret = (rawVal.slice(0, caret).match(/\d/g) || [])
      .length;

    const parsed = parseCurrency(rawVal);
    const newFormatted = formatCurrency(parsed);

    let targetPos = 0;
    let count = 0;
    for (let i = 0; i < newFormatted.length; i++) {
      if (/\d/.test(newFormatted[i])) {
        count++;
      }
      if (count === digitsBeforeCaret) {
        targetPos = i + 1;
        break;
      }
    }

    if (digitsBeforeCaret === 0) {
      targetPos = 0;
    } else if (count < digitsBeforeCaret) {
      targetPos = newFormatted.length;
    }

    pendingCaretRef.current = targetPos;
    onValueChange(parsed);
    setTick((t) => t + 1);
  };

  return (
    <InputGroupInput
      ref={setRef}
      type="text"
      inputMode="numeric"
      value={displayValue}
      onChange={handleChange}
      className={cn("tabular-nums", className)}
      {...props}
    />
  );
});

CurrencyInput.displayName = "CurrencyInput";
