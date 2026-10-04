import type { ReactNode } from "react";
import { CircleAlert, Sparkles, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  ownershipStatusFor,
  type OwnershipTone,
} from "@/lib/inbox/ownership-status";
import type { ConversationState } from "@/lib/types/whatsapp";

export const OWNERSHIP_TONE_VARIANT: Record<
  OwnershipTone,
  "secondary" | "destructive" | "outline"
> = {
  calm: "secondary",
  owned: "secondary",
  action: "destructive",
  muted: "outline",
};

/**
 * The chips in the thread header: who owns the chat, and — only when it is not the usual assistant-handled case — who must act.
 * Status is never colour alone: each chip carries an icon and words.
 */
export function ConversationOwnershipBadges({
  state,
  assignedToName,
  assignedToId,
  currentStaffId,
  ownerControl = null,
}: {
  state: ConversationState;
  assignedToName: string | null;
  assignedToId: string | null;
  currentStaffId: string | null;
  /** Replaces the owner chip with a control when this person may assign conversations. */
  ownerControl?: ReactNode;
}) {
  const status = ownershipStatusFor({
    state,
    assignedToName,
    assignedToId,
    currentStaffId,
  });
  const StatusIcon =
    status.tone === "action"
      ? CircleAlert
      : status.tone === "calm"
        ? Sparkles
        : null;

  return (
    <div
      className="flex flex-nowrap items-center justify-end gap-1"
      role="group"
      aria-label="Who owns this conversation"
    >
      {ownerControl ?? (
        <Badge variant="outline" title={status.description}>
          <UserRound aria-hidden="true" />
          {status.ownerLabel}
        </Badge>
      )}
      {/* The usual case (the assistant is handling it) needs no badge; the description below still tells screen readers. */}
      {status.tone !== "calm" && (
        <Badge
          variant={OWNERSHIP_TONE_VARIANT[status.tone]}
          title={status.description}
        >
          {StatusIcon && <StatusIcon aria-hidden="true" />}
          {status.statusLabel}
        </Badge>
      )}
      <span className="sr-only">{status.description}</span>
    </div>
  );
}
