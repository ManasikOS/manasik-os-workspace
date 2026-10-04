"use client";

import { useState, useTransition } from "react";
import { CalendarClock } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import { colomboDateTimeInput, colomboLocalDateTimeToIso } from "@/lib/date";
import { scheduleConversationFollowUp } from "../actions";
import { useInboxRefresh } from "./inbox-refresh-context";

export default function ConversationFollowUp({
  conversationId,
}: {
  conversationId: string;
}) {
  const [dueAt, setDueAt] = useState("");
  const [isPending, startTransition] = useTransition();
  const refreshInbox = useInboxRefresh();

  return (
    <div className="space-y-2">
      <InputGroup>
        <InputGroupAddon align="block-start">
          <InputGroupText>Follow-up time</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          type="datetime-local"
          value={dueAt}
          min={colomboDateTimeInput()}
          onChange={(event) => setDueAt(event.target.value)}
        />
      </InputGroup>
      <Button
        type="button"
        variant="outline_without_border"
        size="sm"
        className="w-full"
        disabled={!dueAt || isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await scheduleConversationFollowUp({
              conversationId,
              dueAt: colomboLocalDateTimeToIso(dueAt) ?? dueAt,
              type: "WHATSAPP_MESSAGE",
            });
            if (result.ok) refreshInbox();
            toast.add({
              title: result.ok
                ? "Follow-up scheduled"
                : "Could not schedule follow-up",
              description: result.ok
                ? "You are the assigned owner."
                : result.error,
            });
          })
        }
      >
        <CalendarClock />
        {isPending ? "Scheduling…" : "Schedule WhatsApp follow-up"}
      </Button>
    </div>
  );
}
