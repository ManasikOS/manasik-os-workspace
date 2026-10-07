"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { InboxArrowDown, InboxIn } from "reicon-react";

import { Button } from "@/components/ui/button";
import {
  OPEN_INBOX_EVENT,
  type OpenInboxDetail,
} from "@/lib/inbox/open-inbox-event";
import { inboxPageHref } from "@/lib/inbox/page-request";

/** Opens the standalone Inbox workspace from the shared application header. */
export function HeaderInboxLauncher() {
  const router = useRouter();

  useEffect(() => {
    function handleOpenRequest(event: Event) {
      const { conversationId, view = "all" } = (
        event as CustomEvent<OpenInboxDetail>
      ).detail;
      router.push(
        inboxPageHref({ view, conversationId: conversationId ?? null }),
      );
    }

    window.addEventListener(OPEN_INBOX_EVENT, handleOpenRequest);
    return () =>
      window.removeEventListener(OPEN_INBOX_EVENT, handleOpenRequest);
  }, [router]);

  return (
    <Button
      variant="ghost"
      nativeButton={false}
      render={<a href="/inbox" target="_blank" rel="noopener noreferrer" />}
      className="rounded-full text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      aria-label="Open Inbox"
    >
      <InboxIn size={23} className="size-5" />
    </Button>
  );
}
