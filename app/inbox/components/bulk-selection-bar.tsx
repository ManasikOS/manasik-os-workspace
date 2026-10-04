"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { BULK_ACTION_LIMIT } from "@/lib/inbox/bulk-actions";

import { bulkUpdateConversationsAction } from "../actions";
import type { InboxMentionableStaff } from "../types";
import { useInboxRefresh } from "./inbox-refresh-context";

const NO_OWNER = "no-owner";

/**
 * The bar shown while chats are being selected: how many are chosen, an owner to give them to, Close, Mark as spam (or Not spam,
 * in the Spam view) and Cancel. Spam changes ask first. It only sends the ids and the choice; the server checks each
 * conversation, skips the ones that cannot change, and says how many did. There is no bulk send, payment, or review action.
 */
export function BulkSelectionBar({
  selectedIds,
  staff,
  canAssign,
  canClose,
  inSpamView = false,
  onDone,
  onCancel,
}: {
  selectedIds: string[];
  staff: InboxMentionableStaff[];
  canAssign: boolean;
  canClose: boolean;
  /** In the Spam view the spam button restores chats instead of marking them. */
  inSpamView?: boolean;
  /** Called after a change went through, so the list clears its selection. */
  onDone: () => void;
  onCancel: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<
    "MARK_SPAM" | "UNMARK_SPAM" | null
  >(null);
  const refreshInbox = useInboxRefresh();
  const count = selectedIds.length;
  const overLimit = count > BULK_ACTION_LIMIT;

  function run(
    action:
      | { kind: "CLOSE" }
      | { kind: "MARK_SPAM" }
      | { kind: "UNMARK_SPAM" }
      | { kind: "ASSIGN"; assigneeId: string | null },
  ) {
    startTransition(async () => {
      const result = await bulkUpdateConversationsAction({
        conversationIds: selectedIds,
        action,
      });
      if (!result.ok) {
        toast.add({
          title: "Could not change the conversations",
          description: result.error,
        });
        return;
      }
      toast.add({
        title: result.changed > 0 ? "Done" : "Nothing changed",
        description: result.summary,
      });
      refreshInbox();
      onDone();
    });
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 border-t bg-card px-3 py-2"
      role="region"
      aria-label="Bulk actions"
    >
      <p className="text-xs font-medium" role="status">
        {count === 0 ? "Choose conversations" : `${count} selected`}
        {overLimit ? `. Choose at most ${BULK_ACTION_LIMIT}.` : ""}
      </p>
      {canAssign && (
        <Select
          onValueChange={(value) =>
            run({
              kind: "ASSIGN",
              assigneeId:
                typeof value !== "string" || value === NO_OWNER ? null : value,
            })
          }
          disabled={isPending || count === 0 || overLimit}
        >
          <SelectTrigger
            size="sm"
            className="w-40"
            aria-label="Give the selected conversations to"
          >
            <SelectValue placeholder="Give to…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_OWNER}>Unassigned</SelectItem>
            {staff.map((person) => (
              <SelectItem key={person.id} value={person.id}>
                {person.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {canClose && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={isPending || count === 0 || overLimit}
          onClick={() => run({ kind: "CLOSE" })}
        >
          Close
        </Button>
      )}
      {canClose && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={isPending || count === 0 || overLimit}
          onClick={() =>
            setConfirming(inSpamView ? "UNMARK_SPAM" : "MARK_SPAM")
          }
        >
          {inSpamView ? "Not spam" : "Mark as spam"}
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={isPending}
        onClick={onCancel}
      >
        Cancel
      </Button>

      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <DialogContent className="max-w-md! gap-4">
          <DialogHeader className="gap-2">
            <DialogTitle>
              {confirming === "UNMARK_SPAM"
                ? `Restore ${count} conversation${count === 1 ? "" : "s"} from spam?`
                : `Mark ${count} conversation${count === 1 ? "" : "s"} as spam?`}
            </DialogTitle>
            <DialogDescription>
              {confirming === "UNMARK_SPAM"
                ? "They go back to the lists they were in before. Nothing is sent. A chat whose lead is marked as spam stays in Spam until the lead's stage is changed."
                : "They leave the working lists and move to the Spam view, and Copilot stops reading them. Nothing is deleted or sent. Chats with a booking or an open review are left alone, and you can restore these from the Spam view."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline_without_border"
              onClick={() => setConfirming(null)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={confirming === "MARK_SPAM" ? "destructive" : "default"}
              disabled={isPending}
              onClick={() => {
                const kind = confirming;
                setConfirming(null);
                if (kind) run({ kind });
              }}
            >
              {confirming === "UNMARK_SPAM" ? "Restore" : "Mark as spam"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
