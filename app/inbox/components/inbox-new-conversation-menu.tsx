"use client";

import { useState } from "react";
import { Mail, MessageSquarePlus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { InboxTemplate } from "../types";
import ComposeEmailDialog from "./compose-email-dialog";
import NewChatDialog from "./new-chat-dialog";

/**
 * The one way to start a conversation, at the top of the view rail where the main action belongs. It opens the same two
 * dialogs as before: a WhatsApp chat (which needs an approved template) or a new email.
 */
export function InboxNewConversationMenu({
  templates,
  emailMailboxReady,
  onConversationCreated,
}: {
  templates: InboxTemplate[];
  emailMailboxReady: boolean;
  onConversationCreated: (conversationId: string) => void;
}) {
  const [chatOpen, setChatOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Start a new conversation"
            />
          }
        >
          <Plus aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem onClick={() => setChatOpen(true)}>
            <MessageSquarePlus aria-hidden="true" />
            WhatsApp chat
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setEmailOpen(true)}>
            <Mail aria-hidden="true" />
            Email
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewChatDialog
        templates={templates}
        showTrigger={false}
        open={chatOpen}
        onOpenChange={setChatOpen}
        onConversationCreated={onConversationCreated}
      />
      <ComposeEmailDialog
        mailboxReady={emailMailboxReady}
        showTrigger={false}
        open={emailOpen}
        onOpenChange={setEmailOpen}
        onConversationCreated={onConversationCreated}
      />
    </>
  );
}
