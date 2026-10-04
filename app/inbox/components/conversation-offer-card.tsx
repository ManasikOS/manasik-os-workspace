"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import type { RailOffer } from "@/lib/inbox/intelligence/rail-view";
import { offerCardModeFor } from "@/lib/inbox/offer-card-mode";
import { offerMatchReasons } from "@/lib/inbox/offer-match-reasons";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

import { createQuoteFromConversation, openDepartureGroupFromConversation, prepareOfferMessageAction } from "../actions";
import { announceComposerDraft } from "./composer-draft-event";

/**
 * The best departure Copilot found for this customer: seats, price, what is included, what to be careful about and
 * the runners-up, with the four things staff do next. Every figure comes from the live departure group, and the card
 * says plainly when the price or seats have moved since it was worked out — it never hands out a stale number.
 * The actions re-read the offer on the server; this component only names the conversation.
 */
export default function ConversationOfferCard({ offer, conversationId }: { offer: RailOffer; conversationId: string }) {
  const [isPending, startTransition] = useTransition();

  function putDraftInBox(kind: "REPLY" | "FOLLOW_UP") {
    startTransition(async () => {
      const result = await prepareOfferMessageAction({ conversationId, kind });
      if (!result.ok) {
        toast.add({ title: kind === "REPLY" ? "Could not draft a reply" : "Nothing to ask", description: result.error });
        return;
      }
      announceComposerDraft({ conversationId, text: result.text });
      toast.add({ title: "Draft added to the message box", description: "Read it and edit it before you send." });
    });
  }

  function openGroup(departureGroupId?: string) {
    startTransition(async () => {
      const result = await openDepartureGroupFromConversation({ conversationId, departureGroupId });
      if (!result.ok) {
        toast.add({ title: "Could not open the group", description: result.error });
        return;
      }
      window.open(result.href, "_blank", "noopener");
    });
  }

  function createQuote() {
    startTransition(async () => {
      const result = await createQuoteFromConversation({ conversationId });
      toast.add({
        title: result.ok ? "Draft quote created" : "Could not create the quote",
        description: result.ok ? `${result.reference} is saved as a draft on the lead. Nothing was sent.` : result.error,
      });
    });
  }

  const { check } = offer;
  const mode = offerCardModeFor(offer);
  const reasons = offerMatchReasons(offer);
  const checkedAgo = formatDistanceToNowStrict(new Date(offer.asOf), { addSuffix: true });
  const heading = mode === "REVIEW_REQUIRED" ? "Human review required" : mode === "NEEDS_DETAILS" ? "Best departure so far" : "Best departure";

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase text-muted-foreground">{heading}</p>
      <Card className="gap-3 bg-transparent! p-3 shadow-none!">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="wrap-break-word text-sm font-semibold">{offer.title}</p>
            {offer.fitLabel && <Badge variant="secondary">{offer.fitLabel}</Badge>}
          </div>
          {offer.departureLabel && <p className="text-xs text-muted-foreground">{offer.departureLabel}</p>}
        </div>

        {check.message && (
          <p role="alert" className="rounded-md border border-destructive/40 px-2 py-1.5 text-xs text-destructive">
            {check.message}
            {mode === "REVIEW_REQUIRED" && " Do not confirm this departure to the customer."}
          </p>
        )}

        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Price</dt>
            <dd className="wrap-break-word text-sm">{offer.priceLabel}</dd>
            {offer.roomLabel && <dd className="text-xs text-muted-foreground">{offer.roomLabel}</dd>}
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Seats</dt>
            <dd className="text-sm">{offer.seatsLabel}</dd>
          </div>
          {offer.totalLabel && (
            <div className="col-span-2 min-w-0">
              <dt className="text-xs text-muted-foreground">Total</dt>
              <dd className="wrap-break-word text-sm">{offer.totalLabel}</dd>
            </div>
          )}
        </dl>

        <Accordion>
          <AccordionItem value="why-this-matches">
            <AccordionTrigger className="py-1.5 text-xs">{reasons.heading}</AccordionTrigger>
            <AccordionContent>
              {reasons.lines.length > 0 ? (
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                  {reasons.lines.map((line) => (
                    <li key={line} className="wrap-break-word">
                      {line}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Copilot has little to go on yet. Check the group yourself before you recommend it.</p>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {offer.inclusions.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground">Includes</p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-sm">
              {offer.inclusions.map((line) => (
                <li key={line} className="wrap-break-word">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}

        {offer.constraints.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground">Be aware</p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-sm">
              {offer.constraints.map((line) => (
                <li key={line} className="wrap-break-word">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}

        {offer.missing.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground">Not known yet</p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-sm">
              {offer.missing.map((line) => (
                <li key={line} className="wrap-break-word">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}

        {offer.alternatives.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground">Other options</p>
            <ul className="mt-1 space-y-1.5">
              {offer.alternatives.map((option) => (
                <li key={option.departureGroupId} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="wrap-break-word text-sm">{option.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {option.priceLabel} · {option.seatsLabel}
                    </p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => openGroup(option.departureGroupId)}>
                    Open
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {mode === "REVIEW_REQUIRED" ? (
          // Nothing here may be quoted or confirmed, so those actions are not offered at all.
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={isPending} onClick={() => openGroup()}>
              Open group
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={isPending} onClick={() => putDraftInBox("FOLLOW_UP")}>
              Ask follow-up
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === "NEEDS_DETAILS" ? "secondary" : "default"}
              disabled={isPending}
              onClick={() => putDraftInBox("REPLY")}
            >
              Draft reply
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={isPending}
              onClick={createQuote}
              data-inbox-shortcut-trigger="START_QUOTE"
              aria-keyshortcuts="q"
            >
              Create quote
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={isPending} onClick={() => openGroup()}>
              Open group
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "NEEDS_DETAILS" ? "default" : "secondary"}
              disabled={isPending}
              onClick={() => putDraftInBox("FOLLOW_UP")}
            >
              {mode === "NEEDS_DETAILS" ? "Ask for missing details" : "Ask follow-up"}
            </Button>
          </div>
        )}

        <p className="text-xs text-muted-foreground">Worked out {checkedAgo}. Seats and prices are checked again each time you open this.</p>
        {offer.ageNote && <p className="text-xs text-muted-foreground">{offer.ageNote}</p>}
      </Card>
    </div>
  );
}
