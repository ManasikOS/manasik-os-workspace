"use client";

import { Check, Circle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  leadCompletenessFor,
  nextQuestionDraft,
  type LeadCompletenessInput,
} from "@/lib/inbox/lead-completeness";

import { announceComposerDraft } from "./composer-draft-event";

/**
 * "4 of 5 details collected", with each detail named and the next question one click away. The question lands in the
 * message box as editable text: staff read it and send it, or change it. Nothing is sent from here.
 */
export function LeadCompletenessBlock({
  conversationId,
  lead,
}: {
  conversationId: string;
  lead: LeadCompletenessInput;
}) {
  const completeness = leadCompletenessFor(lead);

  function askNextQuestion() {
    if (!completeness.next) return;
    announceComposerDraft({
      conversationId,
      text: nextQuestionDraft(completeness.next.key),
    });
    toast.add({
      title: "Question added to the message box",
      description: "Read it and edit it before you send.",
    });
  }

  return (
    <section className="space-y-3" aria-label="Details collected">
      <div>
        <p className="text-xs font-medium text-muted-foreground">
          Details collected
        </p>
        <p className="mt-1 text-sm font-medium">
          {completeness.collectedCount} of {completeness.totalCount} details
          collected
        </p>
      </div>
      <ul className="space-y-1.5">
        {completeness.items.map((item) => (
          <li key={item.key} className="flex items-center gap-2 text-sm">
            {item.collected ? (
              <Check className="size-4 text-primary" aria-hidden="true" />
            ) : (
              <Circle
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
            )}
            <span
              className={item.collected ? undefined : "text-muted-foreground"}
            >
              {item.label}
            </span>
            <span className="sr-only">
              {item.collected ? "collected" : "still needed"}
            </span>
          </li>
        ))}
      </ul>
      {completeness.next && (
        <Button
          type="button"
          variant="outline_without_border"
          className="w-full"
          onClick={askNextQuestion}
        >
          Ask about {completeness.next.label.toLowerCase()}
        </Button>
      )}
    </section>
  );
}
