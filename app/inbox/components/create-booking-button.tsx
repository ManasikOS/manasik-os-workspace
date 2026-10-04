"use client";

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";

import { createBookingFromConversation } from "../actions";
import { useInboxRefresh } from "./inbox-refresh-context";

export default function CreateBookingButton({
  conversationId,
}: {
  conversationId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const refreshInbox = useInboxRefresh();

  return (
    <Button
      className="w-full"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await createBookingFromConversation(conversationId);
          if (result.ok) refreshInbox();
          toast.add({
            title: result.ok ? "Booking created" : "Could not create booking",
            description: result.ok
              ? "The lead is linked and seats are held."
              : result.error,
          });
        })
      }
    >
      {isPending ? "Creating booking…" : "Create booking"}
    </Button>
  );
}
