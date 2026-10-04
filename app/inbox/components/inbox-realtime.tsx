"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef } from "react";

import {
  INBOX_REALTIME_EVENT_NAME,
  inboxConversationTopic,
  inboxListTopic,
} from "@/lib/inbox/realtime/contracts";
import {
  createInboxEventBatcher,
  type InboxEventBatcher,
  type InboxSyncPlan,
} from "@/lib/inbox/realtime/inbox-sync-plan";
import { createClient } from "@/utils/supabase/client";

/**
 * Realtime is intentionally an invalidation mechanism, not a second data source (docs/inbox/scaling.md §6, §8). The
 * events carry ids, never content; each is parsed against the contract, folded with its neighbours into one plan, and the
 * plan names the few scoped reads that are actually needed. Postgres stays authoritative, so a missed, duplicated or
 * out-of-order event only ever costs one bounded reconciliation.
 *
 * Two topics: the agency list topic (the list, counts) and — only while a conversation is open — that conversation's own
 * topic (thread, notes, presence, context, intelligence). Switching conversations removes the old subscription.
 *
 * A hidden tab reads nothing and reconciles once when shown. A re-subscribe after a dropped connection, and the browser
 * coming back online, each ask for one reconciliation, and simultaneous signals collapse into one.
 */
/**
 * Both topics are private: the server lets a person join only their own agency's topics, and decides that from the signed-in user's token.
 * A join made before the browser client has given its realtime socket that token is refused as "Unauthorized" and never retried, so every
 * subscription first sets the token. Returns a function that stops the subscription, whether or not it had started yet.
 */
function subscribeToPrivateTopic(
  supabase: ReturnType<typeof createClient>,
  open: () => RealtimeChannel,
): () => void {
  let stopped = false;
  let channel: RealtimeChannel | null = null;
  void supabase.realtime
    .setAuth()
    .catch(() => undefined)
    .then(() => {
      if (stopped) return;
      channel = open();
    });
  return () => {
    stopped = true;
    if (channel) void supabase.removeChannel(channel);
  };
}

export default function InboxRealtime({
  agencyId,
  activeConversationId,
  onPlan,
}: {
  agencyId: string | null;
  activeConversationId: string | null;
  onPlan: (plan: InboxSyncPlan) => void;
}) {
  // The latest callback without re-subscribing channels whenever the parent re-renders.
  const onPlanRef = useRef(onPlan);
  useEffect(() => {
    onPlanRef.current = onPlan;
  }, [onPlan]);

  const batcherRef = useRef<InboxEventBatcher | null>(null);

  // The batcher and the list topic live as long as the agency does.
  useEffect(() => {
    if (!agencyId) return;

    const batcher = createInboxEventBatcher({ onFlush: (plan) => onPlanRef.current(plan) });
    batcherRef.current = batcher;
    batcher.setVisible(document.visibilityState !== "hidden");

    const onVisibilityChange = () => batcher.setVisible(document.visibilityState !== "hidden");
    const onOnline = () => batcher.requestReconcile();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);

    const supabase = createClient();
    let hasSubscribed = false;
    const stopListTopic = subscribeToPrivateTopic(supabase, () =>
      supabase
        .channel(inboxListTopic(agencyId), { config: { private: true } })
        .on("broadcast", { event: INBOX_REALTIME_EVENT_NAME }, ({ payload }) => batcher.push(payload))
        .subscribe((status) => {
          if (status !== "SUBSCRIBED") return;
          // The first subscribe is covered by the initial load; a later one means events may have been missed.
          if (hasSubscribed) batcher.requestReconcile();
          hasSubscribed = true;
        }),
    );

    return () => {
      batcherRef.current = null;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
      batcher.dispose();
      stopListTopic();
    };
  }, [agencyId]);

  // The open conversation's topic follows the selection: one subscription, replaced when the person switches chats.
  useEffect(() => {
    batcherRef.current?.setActiveConversation(activeConversationId);
    if (!agencyId || !activeConversationId) return;

    const supabase = createClient();
    let hasSubscribed = false;
    return subscribeToPrivateTopic(supabase, () =>
      supabase
        .channel(inboxConversationTopic(agencyId, activeConversationId), { config: { private: true } })
        .on("broadcast", { event: INBOX_REALTIME_EVENT_NAME }, ({ payload }) => batcherRef.current?.push(payload))
        .subscribe((status) => {
          if (status !== "SUBSCRIBED") return;
          // A later subscribe means events may have been missed: reconcile everything. The FIRST subscribe is not covered by the
          // chat's initial read (that read can finish before the channel is listening), so it always asks for one catch-up of
          // the newer messages and notes.
          if (hasSubscribed) batcherRef.current?.requestReconcile();
          else batcherRef.current?.requestOpenChatCatchUp();
          hasSubscribed = true;
        }),
    );
  }, [agencyId, activeConversationId]);

  return null;
}
