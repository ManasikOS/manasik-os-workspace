"use client";

import { useTransition } from "react";
import { ChevronDown, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";

import { assignConversationAction } from "../actions";
import type { InboxMentionableStaff } from "../types";
import { useInboxRefresh } from "./inbox-refresh-context";

const NO_OWNER = "no-owner";

/**
 * Who owns this conversation, changeable in one step by staff allowed to assign. Choosing a person pauses the assistant
 * and makes them the one to reply; choosing "Unassigned" puts the chat back in the waiting-for-staff pile. The server
 * checks the person can take Inbox chats, so an unsuitable choice comes back as a plain message and nothing changes.
 */
export function ConversationOwnerSelect({
  conversationId,
  assignedToId,
  assignedToName,
  staff,
  currentStaffId,
}: {
  conversationId: string;
  assignedToId: string | null;
  assignedToName: string | null;
  staff: InboxMentionableStaff[];
  currentStaffId: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const refreshInbox = useInboxRefresh();

  // The current owner stays choosable even when the loaded staff list does not include them.
  const options = staff.some((person) => person.id === assignedToId) || !assignedToId
    ? staff
    : [{ id: assignedToId, name: assignedToName || "Current owner" }, ...staff];

  // The trigger shows the label of the chosen person rather than their raw staff id.
  const ownerItems = [
    { value: NO_OWNER, label: "Unassigned" },
    ...options.map((person) => ({ value: person.id, label: person.id === currentStaffId ? `${person.name} (you)` : person.name })),
  ];
  const selectedOwnerValue = assignedToId ?? NO_OWNER;
  const selectedOwnerLabel = ownerItems.find((item) => item.value === selectedOwnerValue)?.label ?? "Unassigned";

  function change(value: string | null) {
    const assigneeId = !value || value === NO_OWNER ? null : value;
    if (assigneeId === assignedToId) return;
    startTransition(async () => {
      const result = await assignConversationAction({ conversationId, assigneeId });
      if (!result.ok) {
        toast.add({ title: "Could not change the owner", description: result.error });
        return;
      }
      toast.add({ title: assigneeId ? "Owner changed" : "Owner removed" });
      refreshInbox();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={isPending}
        aria-label={`Conversation owner: ${selectedOwnerLabel}`}
        data-inbox-shortcut-trigger="OPEN_ASSIGNMENT"
        aria-keyshortcuts="a"
        render={<Button type="button" variant="outline" size="sm" className="w-44 justify-start px-2.5" />}
      >
        <UserRound className="size-3.5" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-start">{selectedOwnerLabel}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuRadioGroup value={selectedOwnerValue} onValueChange={(value: string) => change(value)}>
          <DropdownMenuRadioItem value={NO_OWNER}>Unassigned</DropdownMenuRadioItem>
          {options.length > 0 && <DropdownMenuSeparator />}
          {options.map((person) => (
            <DropdownMenuRadioItem key={person.id} value={person.id}>
              <span className="truncate">{person.id === currentStaffId ? `${person.name} (you)` : person.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
