"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";

import { buildHistory, type HistoryEntry } from "@/lib/inbox/history";

import { loadInboxHistoryAction } from "../dialog-actions";

/**
 * "What happened": when the conversation started and every change of owner. It loads on its own so a slow read never
 * delays the panel, and reads again whenever the conversation changes (`version` is the row's last update), so a new
 * owner shows up without a reload. A failed read leaves the start line, never an error banner.
 */
export function ConversationHistoryBlock({
  conversationId,
  startedAt,
  version,
}: {
  conversationId: string;
  startedAt: string;
  version: string;
}) {
  const [entries, setEntries] = useState<{
    key: string;
    list: HistoryEntry[];
  } | null>(null);
  const key = `${conversationId}:${version}`;

  useEffect(() => {
    let cancelled = false;
    void loadInboxHistoryAction({ conversationId }).then((result) => {
      if (cancelled) return;
      setEntries({
        key,
        list: buildHistory({
          startedAt,
          events: result.ok ? result.data.events : [],
        }),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, key, startedAt]);

  // Until this conversation's own read arrives, show only the start line rather than another chat's history.
  const list =
    entries?.key === key
      ? entries.list
      : buildHistory({ startedAt, events: [] });

  return (
    <section className="space-y-2" aria-label="Conversation history">
      <p className="text-xs font-medium uppercase text-muted-foreground">
        History
      </p>
      <ol className="space-y-5">
        {list.map((entry) => (
          <li key={entry.id} className="text-sm">
            <span className="wrap-break-word">{entry.label}</span>
            <span className="block text-xs text-muted-foreground">
              {formatDistanceToNowStrict(new Date(entry.at), {
                addSuffix: true,
              })}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
