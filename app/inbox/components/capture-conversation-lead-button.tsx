"use client";

import { useTransition } from "react";
import { UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

import { captureConversationLead } from "../actions";
import { useInboxRefresh } from "./inbox-refresh-context";

export default function CaptureConversationLeadButton({ conversationId }: { conversationId: string }) {
  const [isPending, startTransition] = useTransition();
  const refreshInbox = useInboxRefresh();
  return (
    <Button
      className="w-full"
      size="sm"
      type="button"
      disabled={isPending}
      onClick={() => startTransition(async () => {
        const result = await captureConversationLead(conversationId);
        if (result.ok) refreshInbox();
        toast.add({
          title: result.ok ? "Lead linked" : "Could not link lead",
          description: result.ok ? "This conversation is now connected to the sales pipeline." : result.error,
        });
      })}
    >
      <UserPlus />
      {isPending ? "Linking lead…" : "Link or create lead"}
    </Button>
  );
}
