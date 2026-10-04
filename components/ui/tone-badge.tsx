"use client";

import React from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TONE_BAR, TONE_CLASS, type Tone } from "@/lib/ui/tone";

import { ActorChip } from "@/components/ui/copilot-mark";
/**
 * One badge shape shared across modules: soft tinted background, no border,
 * small rounded corners. The label is always rendered, so state reads
 * correctly without relying on colour alone.
 */
export function ToneBadge({
  tone,
  label,
  icon,
  className,
}: {
  tone: Tone;
  label: string;
  /** Optional leading icon — kept out of `label` so it stays plain text for a11y. */
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <Badge
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-3 rounded-sm text-xs font-normal border-none",
        TONE_CLASS[tone],
        className,
      )}
    >
      {icon}
      {label}
    </Badge>
  );
}

export function ProgressBar({
  percent,
  tone,
  className,
}: {
  percent: number;
  tone?: Tone;
  className?: string;
}) {
  const resolved =
    tone ??
    (percent >= 90
      ? "success"
      : percent >= 60
        ? "info"
        : percent >= 30
          ? "warning"
          : "danger");
  return (
    <div
      className={cn(
        "w-full bg-muted h-1.5 rounded-full overflow-hidden",
        className,
      )}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          "h-full rounded-full transition-all duration-500",
          TONE_BAR[resolved],
        )}
        style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
      />
    </div>
  );
}

/**
 * Person / owner chip reused wherever a name needs a consistent avatar
 * treatment. Delegates to `ActorChip` so a name that turns out to be
 * Manasik Copilot gets the Copilot mark here too — no call site has to know
 * whether the owner it was handed is a person or the Copilot.
 */
export function PersonChip({
  name,
  fallback = "Unassigned",
}: {
  name: string | null;
  fallback?: string;
}) {
  return <ActorChip name={name} fallback={fallback} />;
}

/** Consistent empty state for tabs and tables. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon && <div className="text-muted-foreground/60">{icon}</div>}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground max-w-sm">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Shown instead of a section's contents when the role lacks the capability. */
export function PermissionDenied({ what }: { what: string }) {
  return (
    <EmptyState
      title="You do not have access to this section"
      description={`${what} is restricted to roles with the matching permission. Ask an administrator if you need access.`}
    />
  );
}
