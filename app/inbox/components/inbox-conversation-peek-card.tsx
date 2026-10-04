"use client";

import { useState } from "react";
import { CircleAlert } from "lucide-react";

import { conversationPeek } from "@/lib/inbox/conversation-peek";
import { containsArabicScript } from "@/lib/inbox/arabic-script";
import { cn } from "@/lib/utils";

import type { InboxConversation } from "../types";

/**
 * The hover card on a chat row: the things staff usually open a chat to check, such as what was said last, who owns it,
 * whether the reply window is still open and which lead it belongs to. It reads only what the list already holds.
 */
export function InboxConversationPeekCard({
  conversation,
  currentStaffId,
}: {
  conversation: InboxConversation;
  currentStaffId: string | null;
}) {
  // Read once when the card opens, so the "2 hours ago" lines do not shift while it is on screen.
  const [now] = useState(() => new Date());
  const peek = conversationPeek(conversation, { now, currentStaffId });

  return (
    <div className="flex w-72 flex-col gap-3 text-left">
      <div className="min-w-0">
        <p
          className={cn(
            "truncate text-sm font-medium",
            containsArabicScript(peek.name) && "font-arabic",
          )}
        >
          {peek.name}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {peek.channelLabel}
          {peek.contactLine ? ` · ${peek.contactLine}` : ""}
        </p>
      </div>

      {peek.lastMessage && (
        <div className="space-y-0.5 rounded-md bg-muted/60 px-2.5 py-2">
          <p className="text-xs font-medium text-muted-foreground">
            {peek.lastMessage.sender} said
          </p>
          <p className="line-clamp-4 whitespace-pre-wrap wrap-break-word text-xs">
            {peek.lastMessage.text}
          </p>
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        {peek.facts.map((fact) => (
          <div key={fact.label} className="contents">
            <dt className="text-muted-foreground">{fact.label}</dt>
            <dd
              className={cn(
                "min-w-0 wrap-break-word",
                fact.attention && "flex items-start gap-1 font-medium",
              )}
            >
              {fact.attention && (
                <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              )}
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
