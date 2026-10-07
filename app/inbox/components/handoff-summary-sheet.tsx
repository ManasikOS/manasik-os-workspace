"use client";

import { useState, useTransition } from "react";
import { ArrowRightLeft, CheckCircle2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { ConversationHandoffRecord } from "@/lib/data/conversation-handoff-repository";
import { handoffItemSentence } from "@/lib/inbox/handoff/build";
import { createConversationHandoffAction } from "../actions";
import { useInboxRefresh } from "./inbox-refresh-context";

/** What Operations did with a handoff, in words a salesperson understands. */
function handoffStatusLine(handoff: ConversationHandoffRecord): string {
  return handoff.acknowledgedAt
    ? `Operations acknowledged this on ${new Date(handoff.acknowledgedAt).toLocaleDateString()}.`
    : "Waiting for Operations to acknowledge.";
}

/** Creates the auditable snapshot, or reopens the one already made, and shows exactly what Operations received. */
export function HandoffSummarySheet({
  conversationId,
  existingHandoff,
}: {
  conversationId: string;
  existingHandoff: ConversationHandoffRecord | null;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdHandoff, setCreatedHandoff] =
    useState<ConversationHandoffRecord | null>(null);
  const refreshInbox = useInboxRefresh();
  // A handoff made in this session wins; otherwise the one the server already stored for this conversation.
  const handoff = createdHandoff ?? existingHandoff;

  function createHandoff() {
    setError(null);
    startTransition(async () => {
      const result = await createConversationHandoffAction({ conversationId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCreatedHandoff(result.handoff);
      setOpen(true);
      refreshInbox();
    });
  }

  const customer = handoff?.summary.customer as { name?: string } | undefined;
  const booking = handoff?.summary.booking as
    | { reference?: string }
    | undefined;
  const selection = handoff?.summary.selection as
    | {
        groupName?: string;
        departureDate?: string | null;
        returnDate?: string | null;
      }
    | undefined;
  const noExpectations = !handoff?.customerExpectations.items?.length;
  // A stored handoff without its prose can be completed by pressing the button again while nobody has acknowledged it.
  const canRetryNarration = Boolean(
    handoff && !handoff.acknowledgedAt && noExpectations,
  );

  return (
    <>
      {handoff ? (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="size-3.5" />
            Handed to Operations · {handoffStatusLine(handoff)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline_without_border"
              onClick={() => setOpen(true)}
            >
              View handoff
            </Button>
            {canRetryNarration && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={createHandoff}
              >
                {pending ? "Adding summary…" : "Add customer summary"}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline_without_border"
          disabled={pending}
          onClick={createHandoff}
        >
          <ArrowRightLeft className="size-3.5" />
          {pending ? "Preparing handoff…" : "Hand to Operations"}
        </Button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Operations handoff</SheetTitle>
            <SheetDescription>
              This snapshot is saved with the booking so Operations can
              acknowledge the exact details Sales handed over.
            </SheetDescription>
          </SheetHeader>
          {handoff && (
            <div className="space-y-6 overflow-y-auto px-4 pb-4">
              <section className="space-y-2">
                <p className="text-sm font-semibold">Customer and booking</p>
                <p className="text-sm">
                  {customer?.name ?? "Customer"} ·{" "}
                  <span className="tabular-nums">
                    {booking?.reference ?? "Booking"}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {selection?.groupName ?? "Selected departure"}
                  {selection?.departureDate
                    ? ` · ${selection.departureDate}`
                    : ""}
                  {selection?.returnDate ? ` to ${selection.returnDate}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {handoffStatusLine(handoff)}
                </p>
              </section>
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Customer expectations</p>
                  {handoff.customerExpectations.source && !noExpectations && (
                    <Badge variant="outline">
                      {handoff.customerExpectations.source === "LLM"
                        ? `AI summary · ${Math.round((handoff.customerExpectations.confidence ?? 0) * 100)}% confidence`
                        : "Rules-based summary"}
                    </Badge>
                  )}
                </div>
                {!noExpectations ? (
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {handoff.customerExpectations.items?.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No customer summary was written for this handoff
                    {handoff.customerExpectations.note
                      ? ` (${handoff.customerExpectations.note})`
                      : ""}
                    . Operations should read the conversation for the
                    customer&apos;s wishes.
                  </p>
                )}
                {handoff.sentiment && (
                  <p className="text-xs text-muted-foreground">
                    Customer sentiment: {handoff.sentiment.toLowerCase()}
                  </p>
                )}
              </section>
              <section className="space-y-2">
                <p className="text-sm font-semibold">Open items</p>
                {handoff.openItems.length ? (
                  <ul className="space-y-2">
                    {handoff.openItems.map((item) => (
                      <li
                        key={`${item.kind}:${item.label}`}
                        className="rounded-md border px-3 py-2 text-sm"
                      >
                        {handoffItemSentence(item)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No open readiness, document, or payment items were found.
                  </p>
                )}
              </section>
            </div>
          )}
          <SheetFooter>
            <Button type="button" onClick={() => setOpen(false)}>
              Done
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
