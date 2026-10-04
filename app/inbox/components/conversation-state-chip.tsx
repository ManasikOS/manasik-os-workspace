import { CircleAlert, Sparkles, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ownershipStatusFor } from "@/lib/inbox/ownership-status";
import type { ConversationState } from "@/lib/types/whatsapp";

import { OWNERSHIP_TONE_VARIANT } from "./conversation-ownership-badges";

/**
 * Who must act on a chat, in words, on its row in the list. It uses the same wording and tone as the thread header
 * (`ownershipStatusFor`), so "Staff action needed" reads the same everywhere. A closed chat shows nothing: its queue says so.
 */
export function ConversationStateChip({ state }: { state: ConversationState }) {
  if (state === "CLOSED") return null;
  const status = ownershipStatusFor({
    state,
    assignedToName: null,
    assignedToId: null,
    currentStaffId: null,
  });
  const StatusIcon =
    status.tone === "action"
      ? CircleAlert
      : status.tone === "calm"
        ? Sparkles
        : UserRound;

  return (
    <Badge
      variant={OWNERSHIP_TONE_VARIANT[status.tone]}
      title={status.description}
      className="font-normal bg-transparent!"
    >
      <StatusIcon aria-hidden="true" />
      {status.statusLabel}
    </Badge>
  );
}
