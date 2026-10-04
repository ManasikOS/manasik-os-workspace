"use client";

import { AlertTriangle } from "lucide-react";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import type { RailIntervention } from "@/lib/inbox/intelligence/rail-view";

import { updateInterventionAction } from "../actions";
import { useInboxRefresh } from "./inbox-refresh-context";

/**
 * "Human review required." A compact card for something a person must look at before the conversation goes further: what
 * happened, what to do about it, who owns it, and how to close it. A blocking review also stops the words it guards from being
 * sent (the server enforces that; this card only explains it). Closing a review needs a note, so it is a decision someone
 * answers for, never a dismissed banner.
 */
function InterventionRow({
  review,
  conversationId,
}: {
  review: RailIntervention;
  conversationId: string;
}) {
  const [closing, setClosing] = useState<"RESOLVE" | "DISMISS" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const refreshInbox = useInboxRefresh();

  function decide(decision: "ACKNOWLEDGE" | "RESOLVE" | "DISMISS") {
    setError(null);
    startTransition(async () => {
      const result = await updateInterventionAction({
        conversationId,
        interventionId: review.id,
        decision,
        note,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      refreshInbox();
      toast.add({
        title:
          decision === "ACKNOWLEDGE"
            ? "Review acknowledged"
            : decision === "RESOLVE"
              ? "Review resolved"
              : "Review dismissed",
      });
    });
  }

  return (
    <Card className="gap-2 border-destructive/2!   p-4 bg-destructive/3! ">
      <div className="flex items-start gap-2">
        <AlertTriangle
          className="mt-0.5 size-4 shrink-0 text-destructive"
          aria-hidden
        />
        <div className="min-w-0 space-y-1">
          <p className="wrap-break-word text-sm font-semibold">
            {review.headline}
          </p>
          <div className="flex flex-wrap gap-x-2 mt-1 gap-y-2">
            {review.blocking && (
              <Badge variant="destructive">Do not confirm yet</Badge>
            )}
            {review.acknowledged && (
              <Badge variant="outline">Someone is on it</Badge>
            )}
            {review.ownerLabel && (
              <Badge variant="ghost">{review.ownerLabel}</Badge>
            )}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        <span className="font-medium text-foreground">Why: </span>
        {review.guidance}
      </p>
      <p className="text-xs mt-2">
        <span className="font-medium">What to do: </span>
        {review.actionLabel}
      </p>
      {review.closeHint && (
        <p className="text-xs text-muted-foreground">{review.closeHint}</p>
      )}

      {closing ? (
        <div className="space-y-2 mt-2">
          <InputGroup>
            <InputGroupAddon align="block-start">
              <InputGroupText>
                {closing === "RESOLVE"
                  ? "What did you find? (required)"
                  : "Why is this not a problem? (required)"}
              </InputGroupText>
            </InputGroupAddon>
            <InputGroupTextarea
              value={note}
              maxLength={1000}
              disabled={pending}
              onChange={(event) => setNote(event.target.value)}
            />
          </InputGroup>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending || note.trim().length === 0}
              onClick={() => decide(closing)}
            >
              {closing === "RESOLVE" ? "Resolve" : "Dismiss"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setClosing(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 mt-2">
          {!review.acknowledged && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => decide("ACKNOWLEDGE")}
            >
              I am on it
            </Button>
          )}
          <Button
            type="button"
            variant={"secondary"}
            disabled={pending}
            onClick={() => setClosing("RESOLVE")}
          >
            Resolve
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => setClosing("DISMISS")}
          >
            Dismiss
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </Card>
  );
}

export default function ConversationInterventionCard({
  reviews,
  conversationId,
}: {
  reviews: RailIntervention[];
  conversationId: string;
}) {
  if (reviews.length === 0) return null;
  return (
    <section aria-label="Human review required" className="space-y-2">
      <p className="text-xs font-medium uppercase text-destructive">
        Human review required
      </p>
      {reviews.map((review) => (
        <InterventionRow
          key={review.id}
          review={review}
          conversationId={conversationId}
        />
      ))}
    </section>
  );
}
