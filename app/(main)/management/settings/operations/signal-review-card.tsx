"use client";

import { Check, X } from "lucide-react";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import type { SignalForReview } from "@/lib/data/inbox-signal-review-repository";
import { SIGNAL_LABELS } from "@/lib/inbox/intelligence/rail-view";
import type { SignalCode } from "@/lib/inbox/intelligence/contracts";
import type {
  GateState,
  SignalPrecisionSummary,
} from "@/lib/inbox/risk/precision";

import { reviewInboxSignalAction } from "./signal-review-actions";

const signalName = (code: string) =>
  SIGNAL_LABELS[code as SignalCode] ?? code.toLowerCase().replaceAll("_", " ");

const GATE_TEXT: Record<GateState, string> = {
  NO_TARGET: "No target set",
  NEEDS_MORE_REVIEWS: "Needs more reviews",
  MET: "Target met",
  NOT_MET: "Below target",
};

/**
 * "Was Copilot right?" — MI4.1b. Copilot's risk checks run quietly at first (shadow mode), so staff never see them in a
 * conversation. This card is where a person judges them: one tap each, once per signal. The percentages below are what decide
 * whether a check is good enough to be switched on for the team.
 */
export function SignalReviewCard({
  precision,
  queue,
  canReview,
}: {
  precision: SignalPrecisionSummary[];
  queue: SignalForReview[];
  canReview: boolean;
}) {
  const [judged, setJudged] = useState<ReadonlySet<string>>(new Set());
  const [pending, startTransition] = useTransition();

  function judge(signalId: string, verdict: "CORRECT" | "WRONG") {
    startTransition(async () => {
      const result = await reviewInboxSignalAction({ signalId, verdict });
      if (!result.ok) {
        toast.add({
          title: "Could not save your verdict",
          description: result.error ?? "Please try again.",
        });
        return;
      }
      setJudged((current) => new Set(current).add(signalId));
    });
  }

  const waiting = queue.filter((signal) => !judged.has(signal.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Copilot accuracy check</CardTitle>
        <CardDescription>
          Tell us whether each warning Copilot raised was right. A check is only
          switched on for your team once enough of its warnings have been judged
          correct.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-2">
          <p className="text-sm font-semibold">How accurate each check is</p>
          {precision.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No warnings have been raised yet, so there is nothing to measure.
            </p>
          ) : (
            <ul className="space-y-2">
              {precision.map((row) => (
                <li
                  key={row.signalCode}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="font-medium">
                    {signalName(row.signalCode)}
                  </span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span className="tabular-nums">
                      {row.reviewed === 0
                        ? "Not judged yet"
                        : `${row.correct} of ${row.reviewed} correct (${Math.round((row.precision ?? 0) * 100)}%)`}
                    </span>
                    <Badge
                      variant={row.gate === "MET" ? "secondary" : "outline"}
                    >
                      {GATE_TEXT[row.gate]}
                      {row.gate === "NEEDS_MORE_REVIEWS"
                        ? ` · ${row.reviewsStillNeeded} more`
                        : ""}
                      {row.target
                        ? ` · target ${Math.round(row.target * 100)}%`
                        : ""}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <p className="text-sm font-semibold">
            Warnings waiting for your judgement
          </p>
          {waiting.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing is waiting. New warnings appear here as customers write
              in.
            </p>
          ) : (
            <ul className="space-y-3">
              {waiting.map((signal) => (
                <li
                  key={signal.id}
                  className="space-y-2 rounded-md border px-3 py-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {signalName(signal.signalCode)}
                    </span>
                    <Badge variant="outline">
                      {signal.detector === "MODEL"
                        ? `AI reading · ${Math.round(signal.confidence * 100)}% sure`
                        : "Keyword match"}
                    </Badge>
                  </div>
                  {signal.snippets.length > 0 ? (
                    <blockquote className="border-l-2 pl-3 text-muted-foreground">
                      {signal.snippets.map((snippet) => (
                        <p key={snippet}>{snippet}</p>
                      ))}
                    </blockquote>
                  ) : (
                    <p className="text-muted-foreground">
                      No quote was saved with this warning.
                    </p>
                  )}
                  {canReview && (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => judge(signal.id, "CORRECT")}
                      >
                        <Check className="size-3.5" />
                        Warning was right
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => judge(signal.id, "WRONG")}
                      >
                        <X className="size-3.5" />
                        Warning was wrong
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!canReview && (
            <p className="text-xs text-muted-foreground">
              Only Sales, Operations, Finance and admins can judge warnings.
            </p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
