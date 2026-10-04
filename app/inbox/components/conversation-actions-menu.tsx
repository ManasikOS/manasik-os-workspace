"use client";

import { useState, useTransition } from "react";
import { Bot, CircleX, Ellipsis, Hand, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { InboxCapabilities } from "@/lib/access/inbox-access";

import { closeConversation, deleteConversationAction, releaseToAi, takeControl } from "../actions";
import type { InboxConversation } from "../types";
import { useInboxConversationRemoved, useInboxRefresh } from "./inbox-refresh-context";

/**
 * One tidy menu for everything staff can do to a conversation: take control,
 * hand it back to the assistant, close it, or (administrators only) delete it
 * for good. Only the actions that apply to the current state and the person's
 * permissions are listed.
 */
export default function ConversationActionsMenu({
  conversation,
  capabilities,
}: {
  conversation: InboxConversation;
  capabilities: InboxCapabilities;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const refreshInbox = useInboxRefresh();
  const leaveDeletedConversation = useInboxConversationRemoved();

  const canTakeControl =
    capabilities.takeControl &&
    (conversation.state === "AI_ACTIVE" ||
      conversation.state === "AI_RESUMED" ||
      conversation.state === "HUMAN_REQUESTED");
  const canReleaseToAi =
    capabilities.releaseToAi && conversation.state === "HUMAN_ACTIVE";
  const canClose =
    capabilities.closeConversation && conversation.state !== "CLOSED";
  const canDelete = capabilities.deleteConversation;

  function runConversationAction(
    action: () => Promise<{ ok: boolean; error?: string }>,
    done: { title: string; description?: string },
  ) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        refreshInbox();
        toast.add(done);
      } else {
        toast.add({
          title: "Could not update the conversation",
          description: result.error ?? "Something went wrong. Try again.",
        });
      }
    });
  }

  if (!canTakeControl && !canReleaseToAi && !canClose && !canDelete) return null;

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={isPending}
              aria-label="Conversation actions"
            />
          }
        >
          <Ellipsis />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {canTakeControl && (
            <DropdownMenuItem
              onClick={() =>
                runConversationAction(() => takeControl(conversation.id), {
                  title: "You are now handling this chat",
                  description: "Copilot will not reply while you own it.",
                })
              }
            >
              <Hand />
              Take control
            </DropdownMenuItem>
          )}
          {canReleaseToAi && (
            <DropdownMenuItem
              onClick={() =>
                runConversationAction(() => releaseToAi(conversation.id), {
                  title: "Handed back to Copilot",
                  description: "Copilot can reply to the customer again.",
                })
              }
            >
              <Bot />
              Hand back to AI
            </DropdownMenuItem>
          )}
          {(canClose || canDelete) && (canTakeControl || canReleaseToAi) && (
            <DropdownMenuSeparator />
          )}
          {canClose && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setConfirmingClose(true)}
            >
              <CircleX />
              Close conversation
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 />
              Delete conversation
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={confirmingClose} onOpenChange={setConfirmingClose}>
        <DialogContent className="max-w-md! gap-4">
          <DialogHeader className="gap-2">
            <DialogTitle>Close this conversation?</DialogTitle>
            <DialogDescription>
              It moves to Closed and Copilot stops replying. Nothing is deleted.
              If the customer writes again, it comes back to the inbox.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline_without_border"
              onClick={() => setConfirmingClose(false)}
            >
              Keep open
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirmingClose(false);
                runConversationAction(
                  () => closeConversation(conversation.id),
                  { title: "Conversation closed" },
                );
              }}
            >
              Close conversation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent className="max-w-md! gap-4">
          <DialogHeader className="gap-2">
            <DialogTitle>Delete this conversation?</DialogTitle>
            <DialogDescription>
              The whole chat is deleted for good: every message, note and
              attachment. This cannot be undone. Leads and bookings made from it
              are kept. If the customer writes again, a new conversation starts.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline_without_border"
              onClick={() => setConfirmingDelete(false)}
            >
              Keep conversation
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                setConfirmingDelete(false);
                startTransition(async () => {
                  const result = await deleteConversationAction(conversation.id);
                  if (result.ok) {
                    leaveDeletedConversation();
                    toast.add({ title: "Conversation deleted" });
                  } else {
                    toast.add({
                      title: "Could not delete the conversation",
                      description: result.error,
                    });
                  }
                });
              }}
            >
              Delete conversation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
