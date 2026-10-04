/**
 * How fast customers get an answer, per channel (Phase 3 of
 * docs/modules/lead-retention-followups-implementation-plan.md). Computed from the messages themselves —
 * `leads.first_response_at` is only set when staff log a contact by hand, so it cannot be used.
 *
 * Definition: a customer "run" starts at the FIRST customer message nobody has answered yet and ends at the
 * next reply from the assistant or from staff. The wait is the time between those two. Several customer
 * messages in a row are one run (measured from the first), a reply by the assistant ends a run, and a
 * customer whose run has no reply yet is "waiting now" and is kept OUT of the medians. System notes are
 * ignored. Pure — the data layer hands in already-fetched rows.
 */

import { nearestRankPercentile } from "@/lib/agent/whatsapp/analytics";

export type ResponseActor = "CUSTOMER" | "AI" | "STAFF" | "SYSTEM";
export type Responder = "STAFF" | "AI";

export interface ResponseMessage {
  conversationId: string;
  channel: string;
  actorKind: ResponseActor;
  createdAt: string;
}

export interface ResponseTimeGroup {
  channel: string;
  responder: Responder;
  answered: number;
  medianMs: number | null;
  /** The wait that 90% of answers were faster than ("Slowest 10%" starts here). */
  slowestTenthMs: number | null;
  /** Share of answers that came within the target, 0–100; null with no answers. */
  withinTargetPercent: number | null;
}

export interface ResponseTimeStats {
  targetMinutes: number;
  groups: ResponseTimeGroup[];
  /** Customers whose latest message has no reply yet, per channel. */
  waitingNow: { channel: string; count: number }[];
}

export function buildResponseTimeStats(messages: ResponseMessage[], targetMinutes: number, now: Date = new Date()): ResponseTimeStats {
  const byConversation = new Map<string, ResponseMessage[]>();
  for (const message of messages) {
    const list = byConversation.get(message.conversationId);
    if (list) list.push(message);
    else byConversation.set(message.conversationId, [message]);
  }

  const waits = new Map<string, number[]>(); // key: channel|responder
  const waiting = new Map<string, number>();
  const targetMs = targetMinutes * 60_000;

  for (const list of byConversation.values()) {
    list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    let runStart: number | null = null;
    for (const message of list) {
      const at = new Date(message.createdAt).getTime();
      if (message.actorKind === "CUSTOMER") {
        if (runStart === null) runStart = at;
      } else if ((message.actorKind === "STAFF" || message.actorKind === "AI") && runStart !== null) {
        const key = `${message.channel}|${message.actorKind}`;
        const list = waits.get(key);
        const wait = Math.max(0, at - runStart);
        if (list) list.push(wait);
        else waits.set(key, [wait]);
        runStart = null;
      }
    }
    if (runStart !== null && runStart <= now.getTime()) {
      const channel = list[0].channel;
      waiting.set(channel, (waiting.get(channel) ?? 0) + 1);
    }
  }

  const groups: ResponseTimeGroup[] = [...waits.entries()]
    .map(([key, values]) => {
      const [channel, responder] = key.split("|") as [string, Responder];
      const sorted = [...values].sort((a, b) => a - b);
      return {
        channel,
        responder,
        answered: sorted.length,
        medianMs: nearestRankPercentile(sorted, 50),
        slowestTenthMs: nearestRankPercentile(sorted, 90),
        withinTargetPercent: (sorted.filter((wait) => wait <= targetMs).length / sorted.length) * 100,
      };
    })
    .sort((a, b) => a.channel.localeCompare(b.channel) || a.responder.localeCompare(b.responder));

  return {
    targetMinutes,
    groups,
    waitingNow: [...waiting.entries()].map(([channel, count]) => ({ channel, count })).sort((a, b) => a.channel.localeCompare(b.channel)),
  };
}
