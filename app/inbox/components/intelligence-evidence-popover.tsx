"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { RailEvidence } from "@/lib/inbox/intelligence/rail-view";

/** The id each message bubble carries in the conversation panel, so a fact can point at where it came from. */
export function inboxMessageDomId(messageId: string): string {
  return `inbox-message-${messageId}`;
}

/** Scrolls the thread to a message and briefly rings it. Returns false when that message is not on screen. */
export function showMessageInConversation(messageId: string): boolean {
  const target = document.getElementById(inboxMessageDomId(messageId));
  if (!target) return false;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("ring-2", "ring-primary");
  window.setTimeout(
    () => target.classList.remove("ring-2", "ring-primary"),
    2000,
  );
  return true;
}

/**
 * "Why?" on a fact in the rail: the words Copilot read, and a button that jumps to that message in the thread.
 * Every fact the rail states links to its source message (Architecture §5.8) — this is that link.
 */
export default function IntelligenceEvidencePopover({
  factLabel,
  evidence,
}: {
  factLabel: string;
  evidence: RailEvidence[];
}) {
  const [notLoaded, setNotLoaded] = useState(false);
  const shown = evidence.filter(
    (item) => item.snippet.length > 0 || item.messageId,
  );
  if (shown.length === 0) return null;

  return (
    <Popover onOpenChange={() => setNotLoaded(false)}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="h-auto px-1.5 py-0.5 text-xs text-muted-foreground"
            aria-label={`Why Copilot says this: ${factLabel}`}
          />
        }
      >
        Why?
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-3">
        <p className="text-xs font-medium uppercase text-muted-foreground">
          Based on this message
        </p>
        {shown.map((item, index) => (
          <div
            key={`${item.messageId ?? "none"}-${index}`}
            className="space-y-2"
          >
            {item.snippet && (
              <blockquote className="wrap-break-word border-l-2 pl-3 text-sm">
                {item.snippet}
              </blockquote>
            )}
            {item.messageId && (
              <Button
                variant="outline_without_border"
                size="sm"
                onClick={() =>
                  setNotLoaded(
                    !showMessageInConversation(item.messageId as string),
                  )
                }
              >
                Show in conversation
              </Button>
            )}
          </div>
        ))}
        {notLoaded && (
          <p role="status" className="text-xs text-muted-foreground">
            That message is older than the ones loaded in this conversation.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
