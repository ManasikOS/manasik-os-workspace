"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      className,
      checked = false,
      onCheckedChange,
      disabled,
      onClick,
      ...props
    },
    ref,
  ) => {
    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled) return;
      onCheckedChange?.(!checked);
      onClick?.(e);
    };

    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        ref={ref}
        disabled={disabled}
        onClick={handleClick}
        className={cn(
          "peer inline-flex h-5.5 w-10 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-primary" : "bg-muted-foreground/30 dark:bg-input/40",
          className,
        )}
        {...props}
      >
        <span
          className={cn(
            "pointer-events-none block size-4.5 rounded-full bg-white shadow-md ring-0 transition-transform",
            checked ? "translate-x-4.5 bg-white" : "translate-x-0",
          )}
        />
      </button>
    );
  },
);
Switch.displayName = "Switch";

export { Switch };
