"use client";

/**
 * How the Copilot appears when it is named as an actor.
 *
 * The product decision behind this file: a pilgrim's file, a group's
 * activity trail and an approval card all carry a mix of human work and
 * Copilot work, and staff need to tell them apart at a glance without
 * reading. So the Copilot never renders as "just another name" — it gets
 * a mark, and the mark is the same one everywhere.
 *
 * Colour alone is not the signal (`ToneBadge`'s rule, applied here too):
 * the name is always spelled out, and the icon carries the meaning for
 * anyone who can't distinguish the tint.
 */

import { Sparkles } from "lucide-react";
import React from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { COPILOT_NAME, displayActorName, isCopilotActor } from "@/lib/agent/identity";

/**
 * The Copilot's avatar — the same footprint as `PersonChip`'s initials
 * circle, so a mixed list of people and Copilot entries keeps one baseline
 * and one column width.
 */
export function CopilotAvatar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-6 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0",
        className,
      )}
    >
      <Sparkles className="size-3" />
    </span>
  );
}

/**
 * A standalone "by the Copilot" badge, for a card header or a row that
 * has no other actor treatment.
 */
export function CopilotBadge({
  label = COPILOT_NAME,
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <Badge
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-3 rounded-sm text-xs font-normal border-none bg-primary/10 text-primary",
        className,
      )}
    >
      <Sparkles className="size-3" aria-hidden="true" />
      {label}
    </Badge>
  );
}

/**
 * One actor, rendered correctly whoever it is.
 *
 * Prefer this over `PersonChip` on any surface that can show both human
 * and Copilot work — activity feeds, task owners, decision trails. It
 * folds legacy agent names onto the current one (see
 * `displayActorName()`), so a row written before the rename still reads
 * and styles as the Copilot rather than as a stranger called "AI Agent".
 */
export function ActorChip({
  name,
  fallback = "Unassigned",
  /** Drops the avatar and renders inline — for running text like "X moved this to complete". */
  inline = false,
  className,
}: {
  name: string | null | undefined;
  fallback?: string;
  inline?: boolean;
  className?: string;
}) {
  if (!name) {
    return (
      <Badge className="bg-muted/60 text-muted-foreground border-none rounded-sm px-2 py-3 text-xs font-normal">
        {fallback}
      </Badge>
    );
  }

  const label = displayActorName(name);
  const isCopilot = isCopilotActor(name);

  if (inline) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 font-medium",
          isCopilot ? "text-primary" : "text-foreground",
          className,
        )}
      >
        {isCopilot && <Sparkles className="size-3 shrink-0" aria-hidden="true" />}
        {label}
      </span>
    );
  }

  const initials = label
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {isCopilot ? (
        <CopilotAvatar />
      ) : (
        <span className="size-6 rounded-full bg-muted-foreground/30 text-foreground flex items-center justify-center text-[10px] font-medium shrink-0">
          {initials}
        </span>
      )}
      <span
        className={cn(
          "text-xs font-medium truncate",
          isCopilot ? "text-primary" : "text-foreground",
        )}
      >
        {label}
      </span>
    </div>
  );
}
