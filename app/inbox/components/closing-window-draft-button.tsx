"use client";

import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

import { announceComposerSuggestRequest } from "./composer-draft-event";

/** Shown while a reply window is about to close: one click asks Copilot for a draft the person reviews and sends. */
export function ClosingWindowDraftButton({ conversationId }: { conversationId: string }) {
  return (
    <Button type="button" variant="secondary" size="sm" className="mt-1 w-fit" onClick={() => announceComposerSuggestRequest({ conversationId })}>
      <Sparkles aria-hidden="true" />
      Draft reply
    </Button>
  );
}
