"use client";

import { useTransition } from "react";
import { UserRound } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

  // The trigger shows the label of the chosen item; without the items list it would show the raw staff id until the menu had been opened.
  const ownerItems = [
    { value: NO_OWNER, label: "Unassigned" },
    ...options.map((person) => ({ value: person.id, label: person.id === currentStaffId ? `${person.name} (you)` : person.name })),
  ];

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
    <Select items={ownerItems} value={assignedToId ?? NO_OWNER} onValueChange={change} disabled={isPending}>
      <SelectTrigger
        size="sm"
        className="w-44"
        aria-label="Conversation owner"
        data-inbox-shortcut-trigger="OPEN_ASSIGNMENT"
        aria-keyshortcuts="a"
      >
        <UserRound className="size-3.5" aria-hidden="true" />
        <SelectValue placeholder="Unassigned" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_OWNER}>Unassigned</SelectItem>
        {options.map((person) => (
          <SelectItem key={person.id} value={person.id}>
            {person.id === currentStaffId ? `${person.name} (you)` : person.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
