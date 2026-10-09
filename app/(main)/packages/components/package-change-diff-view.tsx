"use client";

import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { TONE_CLASS } from "@/lib/ui/tone";
import { diffRowsById, diffStringLists, diffWords, type ListRowDiff } from "@/lib/packages/change-diff";

/**
 * Shows what one package field was and what it would become, the way a code review shows a changed file: removed text in red, added text in green,
 * list rows marked added / removed / changed (TASK-043). Used by the comparison dialog before a save and by the approval view.
 */

const REMOVED_CLASS = cn(TONE_CLASS.danger, "line-through decoration-1");
const ADDED_CLASS = TONE_CLASS.success;

function isPlainText(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || typeof value === "string";
}

function isObjectList(value: unknown): value is { id?: string }[] {
  return Array.isArray(value) && value.every((item) => item !== null && typeof item === "object" && !Array.isArray(item));
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** A one-line description of a list row (payment milestone, requirement, itinerary day...). */
function describeRow(row: Record<string, unknown>): string {
  const name = [row.label, row.name, row.title, row.routeLabel].find((candidate) => typeof candidate === "string" && candidate.trim()) as string | undefined;
  const parts: string[] = [name ?? "Untitled"];
  if (typeof row.dayNumber === "number") parts.unshift(`Day ${row.dayNumber}`);
  if (row.amount !== undefined && row.amount !== "" && row.amount !== null) {
    parts.push(row.amountType === "Percentage" ? `${row.amount}%` : row.amountType === "Remaining Balance" ? "remaining balance" : String(row.amount));
  }
  if (typeof row.dueRule === "string") {
    parts.push(row.dueRule === "Days Before Departure" ? `${row.daysBeforeDeparture ?? "?"} days before departure` : row.dueRule === "Fixed Date" ? `on ${row.dueDate || "a fixed date"}` : "on booking");
  }
  if (typeof row.category === "string" && row.category) parts.push(String(row.category));
  if (typeof row.required === "boolean") parts.push(row.required ? "required" : "optional");
  return parts.join(" · ");
}

/** Which fields of a changed row differ, for the "changed" marker. */
function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null),
  );
}

function scalarText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function WordDiff({ before, after }: { before: string; after: string }) {
  const parts = diffWords(before, after);
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {parts.length === 0 ? <span className="text-muted-foreground">empty</span> : null}
      {parts.map((part, index) => (
        <span
          key={index}
          className={cn(part.type === "removed" && cn(REMOVED_CLASS, "rounded-xs px-0.5"), part.type === "added" && cn(ADDED_CLASS, "rounded-xs px-0.5"))}
        >
          {part.text}
        </span>
      ))}
    </p>
  );
}

function RowMarker({ type }: { type: ListRowDiff<unknown>["type"] }) {
  const label = { added: "Added", removed: "Removed", changed: "Changed", same: "Unchanged" }[type];
  const tone = { added: ADDED_CLASS, removed: REMOVED_CLASS, changed: TONE_CLASS.warning, same: "text-muted-foreground" }[type];
  return <span className={cn("inline-flex w-[4.5rem] shrink-0 justify-center rounded-xs px-1.5 py-0.5 text-[11px] font-medium", tone)}>{label}</span>;
}

function ObjectListDiff({ before, after }: { before: { id?: string }[]; after: { id?: string }[] }) {
  const rows = diffRowsById(before, after);
  const visible = rows.filter((row) => row.type !== "same");
  const unchanged = rows.length - visible.length;

  return (
    <div className="flex flex-col gap-1.5">
      {visible.length === 0 ? <p className="text-sm text-muted-foreground">Same rows, in a different order.</p> : null}
      {visible.map((row, index) => {
        const subject = (row.after ?? row.before) as Record<string, unknown>;
        return (
          <div key={index} className="flex items-start gap-2 rounded-sm border border-border/50 px-2.5 py-2">
            <RowMarker type={row.type} />
            <div className="min-w-0 flex-1 text-sm">
              {row.type === "changed" ? (
                <>
                  <p className={cn("rounded-xs px-1", REMOVED_CLASS)}>{describeRow(row.before as Record<string, unknown>)}</p>
                  <p className={cn("mt-1 rounded-xs px-1", ADDED_CLASS)}>{describeRow(row.after as Record<string, unknown>)}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Changed: {changedKeys(row.before as Record<string, unknown>, row.after as Record<string, unknown>).join(", ")}
                  </p>
                </>
              ) : (
                <p className={cn("rounded-xs px-1", row.type === "added" ? ADDED_CLASS : REMOVED_CLASS)}>{describeRow(subject)}</p>
              )}
            </div>
          </div>
        );
      })}
      {unchanged > 0 ? <p className="text-[11px] text-muted-foreground">{unchanged} unchanged row{unchanged === 1 ? "" : "s"} not shown.</p> : null}
    </div>
  );
}

function StringListDiff({ before, after }: { before: string[]; after: string[] }) {
  const rows = diffStringLists(before, after);
  return (
    <div className="flex flex-wrap gap-1.5">
      {rows.map((row, index) => (
        <span
          key={index}
          className={cn(
            "rounded-sm px-2 py-0.5 text-xs",
            row.type === "added" && ADDED_CLASS,
            row.type === "removed" && REMOVED_CLASS,
            row.type === "same" && "bg-muted text-muted-foreground",
          )}
        >
          {row.type === "added" ? "+ " : row.type === "removed" ? "− " : ""}
          {row.after ?? row.before}
        </span>
      ))}
      {rows.length === 0 ? <span className="text-sm text-muted-foreground">empty</span> : null}
    </div>
  );
}

export interface PackageChangeDiffViewProps {
  label: string;
  before: unknown;
  after: unknown;
  className?: string;
}

export default function PackageChangeDiffView({ label, before, after, className }: PackageChangeDiffViewProps) {
  let body: ReactNode;

  if (isPlainText(before) && isPlainText(after)) {
    body = <WordDiff before={before ?? ""} after={after ?? ""} />;
  } else if (isStringList(before) && isStringList(after)) {
    body = <StringListDiff before={before} after={after} />;
  } else if ((isObjectList(before) || (Array.isArray(before) && before.length === 0)) && (isObjectList(after) || (Array.isArray(after) && after.length === 0))) {
    body = <ObjectListDiff before={(before ?? []) as { id?: string }[]} after={(after ?? []) as { id?: string }[]} />;
  } else {
    body = (
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className={cn("rounded-xs px-1.5 py-0.5", REMOVED_CLASS)}>{scalarText(before)}</span>
        <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
        <span className={cn("rounded-xs px-1.5 py-0.5", ADDED_CLASS)}>{scalarText(after)}</span>
      </p>
    );
  }

  return (
    <section className={cn("flex flex-col gap-1.5", className)} aria-label={`${label}: before and after`}>
      <h4 className="text-xs font-medium text-muted-foreground">{label}</h4>
      {body}
    </section>
  );
}
