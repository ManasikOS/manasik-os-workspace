"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useRef } from "react";

import { shouldRefreshThread } from "@/lib/inbox/quick-chat/live";
import { INBOX_REALTIME_EVENT_NAME, inboxConversationTopic } from "@/lib/inbox/realtime/contracts";
import { createClient } from "@/utils/supabase/client";

/**
 * Keeps the popup's thread current. Realtime is an invalidation signal only (docs/inbox/scaling.md §6): an event names a conversation,
 * and this asks the caller to read the thread again. One private subscription, for the open conversation only, removed when the
 * conversation changes or the popup closes.
 *
 * A hidden tab reads nothing and asks for one catch-up when it is shown again. A re-subscribe after a dropped connection, and the
 * browser coming back online, each ask for one catch-up as well. The caller's refresh is single-flight, so signals that arrive together
 * cost one read.
 */
export function useQuickChatLive({
  agencyId,
  conversationId,
  onChange,
}: {
  agencyId: string | null;
  conversationId: string | null;
  onChange: () => void;
}): void {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!agencyId || !conversationId) return;

    let stopped = false;
    let pendingWhileHidden = false;
    const refresh = () => {
      if (document.visibilityState === "hidden") {
        pendingWhileHidden = true;
        return;
      }
      onChangeRef.current();
    };
    const onVisible = () => {
      if (document.visibilityState === "hidden" || !pendingWhileHidden) return;
      pendingWhileHidden = false;
      onChangeRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);

    const supabase = createClient();
    let channel: RealtimeChannel | null = null;
    // A join made before the realtime socket has the user's token is refused and never retried, so the token is set first.
    void supabase.realtime
      .setAuth()
      .catch(() => undefined)
      .then(() => {
        if (stopped) return;
        channel = supabase
          .channel(inboxConversationTopic(agencyId, conversationId), { config: { private: true } })
          .on("broadcast", { event: INBOX_REALTIME_EVENT_NAME }, ({ payload }) => {
            if (shouldRefreshThread(payload, conversationId)) refresh();
          })
          .subscribe((status) => {
            // The first subscribe can finish after the initial read, and a later one means events were missed: either way, one catch-up.
            if (status === "SUBSCRIBED") refresh();
          });
      });

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [agencyId, conversationId]);
}
