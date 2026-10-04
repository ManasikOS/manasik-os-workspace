"use client";

import { useTransition, type ComponentProps } from "react";
import { Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";

type PendingActionButtonProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  /** Runs inside a transition — may call a Server Action and await it. */
  onAction: () => void | Promise<void>;
  /** Label shown while the action is running. Defaults to the normal children. */
  pendingLabel?: string;
};

/**
 * A `Button` that reacts in the same frame it is clicked: it disables itself
 * and swaps in a spinner until `onAction` settles, so a slow Server Action
 * never looks like a dead button or invites a double submit.
 */
export function PendingActionButton({
  onAction,
  pendingLabel,
  children,
  disabled,
  ...buttonProps
}: PendingActionButtonProps) {
  const [isActionPending, startActionTransition] = useTransition();

  return (
    <Button
      {...buttonProps}
      disabled={disabled || isActionPending}
      aria-busy={isActionPending}
      onClick={() => startActionTransition(async () => { await onAction(); })}
    >
      {isActionPending && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
      {isActionPending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
