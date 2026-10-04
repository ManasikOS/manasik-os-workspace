"use client";

import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QUEUE_CATALOGUE, railCountLabel } from "@/lib/inbox/queues";
import { INBOX_VIEWS, VIEW_QUEUE, type InboxView } from "@/lib/inbox/views";

import type { InboxTemplate } from "../types";
import ComposeEmailDialog from "./compose-email-dialog";
import { LEGACY_RAIL_VIEWS } from "./inbox-view-navigation";
import NewChatDialog from "./new-chat-dialog";

/**
 * The view rail's job on a screen too narrow to dock it: switch queue, start a chat, write an email, and get back to the
 * CRM. It sits above the chat list below the `lg` breakpoint, where the rail is hidden.
 */
export function InboxCompactQueueBar({
  viewCounts,
  activeView,
  queuesV2,
  templates,
  canStartChat,
  emailMailboxReady,
  onSelectView,
  onConversationCreated,
}: {
  viewCounts: Record<InboxView, number> | null;
  activeView: InboxView;
  queuesV2: boolean;
  templates: InboxTemplate[];
  canStartChat: boolean;
  emailMailboxReady: boolean;
  onSelectView: (view: InboxView) => void;
  onConversationCreated: (conversationId: string) => void;
}) {
  const views = queuesV2 ? INBOX_VIEWS : LEGACY_RAIL_VIEWS.map((view) => view.id);
  const labelOf = (view: InboxView) => QUEUE_CATALOGUE[VIEW_QUEUE[view]].label;
  const optionLabel = (view: InboxView) => {
    const count = railCountLabel(viewCounts?.[view]);
    return count ? `${labelOf(view)} (${count})` : labelOf(view);
  };

  return (
    <div className="flex items-center gap-2 border-b border-muted px-3 py-2 lg:hidden [&_[data-slot=button]]:mt-0">
      <Button
        variant="ghost"
        size="icon-sm"
        nativeButton={false}
        render={<a href="/dashboard" />}
        aria-label="Back to the CRM"
      >
        <ArrowLeft aria-hidden="true" />
      </Button>
      <Select value={activeView} onValueChange={(value) => value && onSelectView(value as InboxView)}>
        <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Choose a queue">
          <SelectValue>{optionLabel(activeView)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {views.map((view) => (
            <SelectItem key={view} value={view}>
              {optionLabel(view)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {canStartChat && <NewChatDialog templates={templates} collapsed onConversationCreated={onConversationCreated} />}
      {canStartChat && (
        <ComposeEmailDialog collapsed mailboxReady={emailMailboxReady} onConversationCreated={onConversationCreated} />
      )}
    </div>
  );
}
