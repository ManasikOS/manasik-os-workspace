"use client";

import { useState, useTransition } from "react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  buildOffersAction,
  selectOfferAction,
} from "@/app/(main)/leads/copilot-actions";
import {
  copilotReadinessFor,
  FLEXIBLE_DATES_DRAFT,
  missingDetailsDraft,
  type CopilotReadinessInput,
} from "@/lib/inbox/copilot-readiness";

import { announceComposerDraft } from "./composer-draft-event";

type SuggestedOffer = {
  id: string;
  packageName: string;
  groupName: string;
  currency: string;
  totalPrice: number;
  isRecommended: boolean;
};

/**
 * Copilot's departure suggestions, in the state the lead is really in: still missing details (ask for them),
 * ready to search, showing matches, or searched with nothing available. It never offers to suggest a package
 * before the details that decide the match are known.
 */
export default function InboxCopilot({
  leadId,
  conversationId,
  lead,
  hasDepartureChoice = false,
}: {
  leadId: string;
  conversationId: string;
  lead: CopilotReadinessInput;
  /** A group is already chosen or booked, so the search is a "look at other options" step, not the first one. */
  hasDepartureChoice?: boolean;
}) {
  const router = useRouter();
  const [offers, setOffers] = useState<SuggestedOffer[]>([]);
  const [searched, setSearched] = useState(false);
  const [isPending, startTransition] = useTransition();
  const readiness = copilotReadinessFor(lead);

  function putDraftInBox(text: string) {
    announceComposerDraft({ conversationId, text });
    toast.add({
      title: "Draft added to the message box",
      description: "Read it and edit it before you send.",
    });
  }

  function buildOffers() {
    startTransition(async () => {
      const result = await buildOffersAction({ leadId, mode: "BUILD" });
      if (!result.ok) {
        toast.add({
          title: "Could not build package suggestions",
          description: result.error,
        });
        return;
      }
      setSearched(true);
      setOffers(
        result.result.offers.slice(0, 3).map((offer) => ({
          id: offer.id,
          packageName: offer.packageName,
          groupName: offer.groupName,
          currency: offer.currency,
          totalPrice: offer.totalPrice,
          isRecommended: offer.isRecommended,
        })),
      );
    });
  }

  function selectOffer(offerId: string) {
    startTransition(async () => {
      const result = await selectOfferAction({
        leadId,
        offerId,
        applyRoomType: true,
      });
      if (!result.ok) {
        toast.add({
          title: "Could not select package",
          description: result.error,
        });
        return;
      }
      toast.add({ title: "Package selected", description: result.groupName });
      router.refresh();
    });
  }

  const requestedSummary = [
    lead.desiredPackageName,
    lead.preferredPeriod,
    lead.adults + lead.children > 0
      ? `${lead.adults + lead.children} traveller${lead.adults + lead.children === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="space-y-2" aria-label="Departure suggestions">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 text-primary" aria-hidden="true" />
        Departure suggestions
      </div>

      {!readiness.ready ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Copilot suggests departures once these are known:
          </p>
          <ul className="list-disc space-y-0.5 pl-4 text-sm">
            {readiness.stillNeeded.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline_without_border"
            className="w-full"
            onClick={() =>
              putDraftInBox(missingDetailsDraft(readiness.stillNeeded))
            }
          >
            Ask for missing details
          </Button>
        </div>
      ) : offers.length === 0 && !searched ? (
        <Button
          type="button"
          variant="outline_without_border"
          className="w-full"
          disabled={isPending}
          onClick={buildOffers}
        >
          <Sparkles />
          {isPending
            ? "Finding options…"
            : hasDepartureChoice
              ? "Look for other departures"
              : "Find matching departures"}
        </Button>
      ) : offers.length === 0 ? (
        <div className="space-y-2" role="status">
          <p className="text-sm font-medium">
            No matching departure is available right now
          </p>
          {requestedSummary && (
            <p className="text-xs text-muted-foreground">
              Requested: {requestedSummary}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline_without_border"
              size="sm"
              onClick={() => putDraftInBox(FLEXIBLE_DATES_DRAFT)}
            >
              Ask about flexible dates
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={buildOffers}
            >
              {isPending ? "Checking…" : "Check again"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {offers.map((offer) => (
            <button
              key={offer.id}
              type="button"
              className="w-full rounded-md border p-2 text-left text-xs hover:bg-muted focus-visible:outline_without_border-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled={isPending}
              onClick={() => selectOffer(offer.id)}
            >
              <span className="block font-medium">
                {offer.packageName}
                {offer.isRecommended ? " · Recommended" : ""}
              </span>
              <span className="block text-muted-foreground">
                {offer.groupName} · {offer.currency}{" "}
                {offer.totalPrice.toLocaleString()}
              </span>
            </button>
          ))}
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={isPending}
            onClick={buildOffers}
          >
            Refresh suggestions
          </Button>
        </div>
      )}
    </section>
  );
}
