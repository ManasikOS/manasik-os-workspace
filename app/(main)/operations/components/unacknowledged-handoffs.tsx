"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Handshake } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { acknowledgeConversationHandoffAction } from "@/app/inbox/actions";
import type { ConversationHandoffRecord } from "@/lib/data/conversation-handoff-repository";
import { handoffItemSentence } from "@/lib/inbox/handoff/build";

export function UnacknowledgedOperationsHandoffs({
  handoffs,
  canAcknowledge,
}: {
  handoffs: ConversationHandoffRecord[];
  canAcknowledge: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  if (handoffs.length === 0) return null;
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Handshake className="size-4" />
        Sales handoffs waiting for Operations
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {handoffs.map((handoff) => {
        const customer =
          (handoff.summary.customer as { name?: string } | undefined)?.name ??
          "Customer";
        const booking =
          (handoff.summary.booking as { reference?: string } | undefined)
            ?.reference ?? "Booking";
        return (
          <div key={handoff.id} className="space-y-3 border-t pt-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="font-medium">
                  {customer} · <span className="tabular-nums">{booking}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {!handoff.customerExpectations.items?.length
                    ? "No customer summary was written — read the conversation for the customer's wishes."
                    : handoff.customerExpectations.source === "LLM"
                      ? `AI summary · ${Math.round((handoff.customerExpectations.confidence ?? 0) * 100)}% confidence`
                      : "Rules-based summary"}
                </p>
                {handoff.customerExpectations.items?.map((item) => (
                  <p key={item} className="text-xs text-muted-foreground">
                    {item}
                  </p>
                ))}
                {handoff.openItems.map((item) => (
                  <p
                    key={`${item.kind}:${item.label}`}
                    className="text-xs text-muted-foreground"
                  >
                    {handoffItemSentence(item)}
                  </p>
                ))}
                {handoff.openItems.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No open readiness, document, or payment items.
                  </p>
                )}
              </div>
              {canAcknowledge && (
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setError(null);
                      const result = await acknowledgeConversationHandoffAction(
                        { handoffId: handoff.id },
                      );
                      if (!result.ok) setError(result.error);
                      else router.refresh();
                    })
                  }
                >
                  Acknowledge
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </Card>
  );
}
