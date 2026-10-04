"use client";

import { useState } from "react";
import {
  CircleAlert,
  Info,
  PencilLine,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import {
  pickComposerNotice,
  type ComposerNotice,
  type ComposerNoticeKind,
} from "@/lib/inbox/pick-composer-notice";
import { cn } from "@/lib/utils";

const NOTICE_ICON: Record<ComposerNoticeKind, LucideIcon> = {
  ERROR: CircleAlert,
  BLOCKED: Info,
  PRESENCE: PencilLine,
  OWNERSHIP: UserRound,
};

function ComposerNoticeLine({ notice }: { notice: ComposerNotice }) {
  const Icon = NOTICE_ICON[notice.kind];
  const isError = notice.kind === "ERROR";
  return (
    <p
      role={isError ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
        isError
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-dashed bg-muted/30 text-muted-foreground",
      )}
    >
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{notice.message}</span>
    </p>
  );
}

/**
 * The composer's heads-ups, one at a time. The most important stays in view; the others wait behind "+N more" so the
 * message box keeps its room. Nothing is dropped: expanding shows every notice.
 */
export function ComposerNoticeStrip({
  candidates,
}: {
  candidates: ReadonlyArray<ComposerNotice | null | false | undefined>;
}) {
  const [expanded, setExpanded] = useState(false);
  const { primary, others } = pickComposerNotice(candidates);
  if (!primary) return null;

  return (
    <div className="space-y-1.5 px-3 pt-3">
      <ComposerNoticeLine notice={primary} />
      {others.length > 0 && (
        <>
          {expanded &&
            others.map((notice) => (
              <ComposerNoticeLine key={notice.kind} notice={notice} />
            ))}
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
            className="rounded-sm px-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline_without_border-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {expanded
              ? "Show less"
              : `${others.length} more ${others.length === 1 ? "note" : "notes"}`}
          </button>
        </>
      )}
    </div>
  );
}
