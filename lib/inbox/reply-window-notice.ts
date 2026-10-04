import type { ChannelPolicyState } from "@/lib/channels/policy-state";

/**
 * The reply-window banner in the words staff need: what they may do right now, for how long, and what it costs.
 * The rules themselves stay in `resolveChannelPolicyState`; this only chooses the wording, so a window that is about
 * to close is called out before it closes instead of after.
 */

export type ReplyWindowTone = "OPEN" | "CLOSING" | "CLOSED" | "HUMAN_ONLY" | "BLOCKED";

export interface ReplyWindowNotice {
  tone: ReplyWindowTone;
  headline: string;
  detail: string;
  /** True when the next step is picking an approved template. */
  needsTemplate: boolean;
}

/** Under this long left, the window is shown as closing. */
export const REPLY_WINDOW_CLOSING_MINUTES = 120;

/** "23h 42m", "1h 05m" or "42m". Never negative. */
export function formatTimeLeft(minutes: number): string {
  const whole = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest}m`;
  return `${hours}h ${String(rest).padStart(2, "0")}m`;
}

function minutesUntil(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return (at - now.getTime()) / 60_000;
}

export function replyWindowNoticeFor(input: {
  channel: string;
  policy: ChannelPolicyState;
  serviceWindowExpiresAt: string | null;
  humanAgentWindowExpiresAt: string | null;
  now: Date;
}): ReplyWindowNotice {
  const { policy, now } = input;

  // The column belongs to the shared conversation record and may contain a legacy timestamp.
  // Only Meta channels have a provider-enforced reply window; email must never inherit its UI.
  if (input.channel === "GMAIL") {
    return {
      tone: "OPEN",
      headline: "Email messaging available",
      detail: "You can send an email at any time.",
      needsTemplate: false,
    };
  }

  switch (policy.action) {
    case "FREE_FORM": {
      const left = minutesUntil(input.serviceWindowExpiresAt, now);
      // Channels with no window (email) have nothing to count down.
      if (left === null) return { tone: "OPEN", headline: "Reply window open", detail: "You can write a free-form reply.", needsTemplate: false };
      if (left <= REPLY_WINDOW_CLOSING_MINUTES) {
        return {
          tone: "CLOSING",
          headline: `Reply window closes in ${formatTimeLeft(left)}`,
          detail: "Send a response now. After that, only an approved template can reach this customer.",
          needsTemplate: false,
        };
      }
      return { tone: "OPEN", headline: "Reply window open", detail: `Free-form reply allowed for ${formatTimeLeft(left)}.`, needsTemplate: false };
    }
    case "APPROVED_TEMPLATE":
      return {
        tone: "CLOSED",
        headline: "Reply window closed",
        detail: "Choose an approved template to contact this customer. Meta charges may apply.",
        needsTemplate: true,
      };
    case "HUMAN_AGENT": {
      const left = minutesUntil(input.humanAgentWindowExpiresAt, now);
      return {
        tone: "HUMAN_ONLY",
        headline: left === null ? "Human support reply allowed" : `Human support reply allowed for ${formatTimeLeft(left)}`,
        detail: "This message must be written and sent by a staff member, not the assistant.",
        needsTemplate: false,
      };
    }
    case "BLOCKED":
      return { tone: "BLOCKED", headline: "Sending unavailable", detail: policy.notice, needsTemplate: false };
  }
}
