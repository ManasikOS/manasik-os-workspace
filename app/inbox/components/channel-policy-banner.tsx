import { CircleAlert, Clock3, UserRound } from "lucide-react";

import { Card } from "@/components/ui/card";
import type { ChannelPolicyState } from "@/lib/channels/policy-state";
import {
  replyWindowNoticeFor,
  type ReplyWindowTone,
} from "@/lib/inbox/reply-window-notice";
import { cn } from "@/lib/utils";

import { ClosingWindowDraftButton } from "./closing-window-draft-button";

const TONE_ICON: Record<ReplyWindowTone, typeof Clock3 | null> = {
  OPEN: null,
  CLOSING: Clock3,
  CLOSED: CircleAlert,
  HUMAN_ONLY: UserRound,
  BLOCKED: CircleAlert,
};

/** What staff may do on this channel right now and for how long. The icon and words carry the state; colour only backs them up. */
export function ChannelPolicyBanner({
  state,
  channel,
  serviceWindowExpiresAt,
  humanAgentWindowExpiresAt,
  now,
  conversationId = null,
  canDraft = false,
  actionWidget,
}: {
  /** With `canDraft`, a closing window offers a one-click Copilot draft. */
  conversationId?: string | null;
  canDraft?: boolean;
  state: ChannelPolicyState;
  channel: string;
  serviceWindowExpiresAt: string | null;
  humanAgentWindowExpiresAt: string | null;
  now: Date;
  actionWidget: React.ReactNode;
}) {
  const notice = replyWindowNoticeFor({
    channel,
    policy: state,
    serviceWindowExpiresAt,
    humanAgentWindowExpiresAt,
    now,
  });
  const ToneIcon = TONE_ICON[notice.tone];
  const urgent =
    notice.tone === "CLOSING" ||
    notice.tone === "CLOSED" ||
    notice.tone === "BLOCKED";

  return (
    <Card
      className={cn(
        "shadow-xs! flex border-b-transparent rounded-b-none  gap-1 bg-card px-4 py-3 text-xs",
        urgent && "border-destructive/40",
      )}
      role={state.action === "BLOCKED" ? "alert" : "status"}
    >
      <div className="flex flex-col gap-1">
        <p className="flex items-center gap-1.5 font-medium">
          {ToneIcon && <ToneIcon className="size-3.5" aria-hidden="true" />}
          {notice.headline}
        </p>
        <p className="text-muted-foreground">{notice.detail}</p>
        {notice.tone === "CLOSING" && canDraft && conversationId && (
          <ClosingWindowDraftButton conversationId={conversationId} />
        )}
        {state.projectedCharge && (
          <p className="mt-1 font-medium">
            Projected charge: {state.projectedCharge.currency}{" "}
            {state.projectedCharge.amount.toFixed(3)}
          </p>
        )}
      </div>
      <div>{actionWidget}</div>
    </Card>
  );
}
