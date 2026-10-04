"use client";

import { useMemo } from "react";

import type { InboxView } from "@/lib/inbox/views";

import { InboxWorkspaceController } from "./inbox-workspace-controller";

/**
 * The Inbox as a page: the same workspace the header overlay shows, given the whole screen for staff who work in it for
 * hours. It has no state of its own. A new address (another chat or queue) is a new request, so the workspace reloads for it.
 */
export function InboxFullPage({ conversationId, view }: { conversationId: string | null; view: InboxView }) {
  const request = useMemo(() => ({ conversationId, view }), [conversationId, view]);

  return (
    <div className="h-dvh min-h-128 w-full">
      <h1 className="sr-only">Manasik Inbox</h1>
      <InboxWorkspaceController open initialRequest={request} fullPage />
    </div>
  );
}
