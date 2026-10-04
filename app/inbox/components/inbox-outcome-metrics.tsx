"use client";

import { useState, useTransition } from "react";
import { BarChart3 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { InboxView } from "@/lib/inbox/views";
import {
  OUTCOME_FAMILY_LABELS,
  type InboxOutcomeCard,
} from "@/lib/metrics/inbox-outcome-cards";

import { loadInboxOutcomeCardsAction } from "../outcome-actions";

type OutcomePanelState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      cards: InboxOutcomeCard[];
      unreadableSources: number;
      generatedAt: string;
    };

const STATE_BADGE: Record<
  Exclude<InboxOutcomeCard["state"], "VALUE">,
  string
> = {
  NO_DATA: "No data yet",
  NOT_MEASURABLE: "Not measurable yet",
  UNAVAILABLE: "Could not be read",
};

function groupCardsByFamily(
  cards: InboxOutcomeCard[],
): Array<{ family: InboxOutcomeCard["family"]; cards: InboxOutcomeCard[] }> {
  const groups: Array<{
    family: InboxOutcomeCard["family"];
    cards: InboxOutcomeCard[];
  }> = [];
  for (const card of cards) {
    const group = groups.find((entry) => entry.family === card.family);
    if (group) group.cards.push(card);
    else groups.push({ family: card.family, cards: [card] });
  }
  return groups;
}

/**
 * A panel of outcome cards, opened from the Inbox rail. What a person sees was already filtered by their role on the server. A
 * count's button opens the conversation list that count is made from, so the number and the rows can be checked against each other.
 */
export function InboxOutcomeMetricsDialog({
  onOpenQueueView,
}: {
  onOpenQueueView: (view: InboxView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<OutcomePanelState>({ status: "idle" });
  const [, startTransition] = useTransition();

  function loadOutcomeCards() {
    setState({ status: "loading" });
    startTransition(async () => {
      try {
        const result = await loadInboxOutcomeCardsAction();
        setState(
          result.ok
            ? {
                status: "ready",
                cards: result.cards,
                unreadableSources: result.unreadableSources,
                generatedAt: result.generatedAt,
              }
            : { status: "error", message: result.error },
        );
      } catch {
        setState({
          status: "error",
          message: "The outcomes could not be loaded. Try again.",
        });
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) loadOutcomeCards();
      }}
    >
      <DialogTrigger
        render={
          <SidebarMenuButton
            type="button"
            tooltip="Inbox outcomes"
            aria-label="Inbox outcomes"
          />
        }
      >
        <BarChart3 aria-hidden="true" />
        <span>Outcomes</span>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto p-4 sm:max-w-3xl sm:p-6">
        <DialogHeader>
          <DialogTitle>Inbox outcomes</DialogTitle>
          <DialogDescription>
            Counts come straight from your agency&apos;s conversations. Choose
            &ldquo;Open these conversations&rdquo; to see the exact chats behind
            a number. You only see the figures your role allows.
          </DialogDescription>
        </DialogHeader>

        {state.status === "loading" || state.status === "idle" ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading outcomes…
          </p>
        ) : null}

        {state.status === "error" ? (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm">
            <p>{state.message}</p>
            <Button
              type="button"
              variant="outline_without_border"
              size="sm"
              onClick={loadOutcomeCards}
            >
              Try again
            </Button>
          </div>
        ) : null}

        {state.status === "ready" && state.cards.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            There are no outcomes for your role to show.
          </p>
        ) : null}

        {state.status === "ready" && state.unreadableSources > 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            Some figures could not be read just now and are marked below. They
            are not zero.
          </p>
        ) : null}

        {state.status === "ready"
          ? groupCardsByFamily(state.cards).map((group) => (
              <section
                key={group.family}
                aria-labelledby={`inbox-outcome-family-${group.family}`}
                className="flex flex-col gap-2"
              >
                <h3
                  id={`inbox-outcome-family-${group.family}`}
                  className="text-sm font-semibold"
                >
                  {OUTCOME_FAMILY_LABELS[group.family]}
                </h3>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {group.cards.map((card) => (
                    <li
                      key={card.key}
                      className="flex flex-col gap-1.5 rounded-md border p-3"
                      data-outcome-key={card.key}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium">
                          {card.label}
                        </span>
                        {card.state !== "VALUE" ? (
                          <Badge variant="outline">
                            {STATE_BADGE[card.state]}
                          </Badge>
                        ) : null}
                      </div>
                      {card.state === "VALUE" ? (
                        <p
                          className="text-2xl font-semibold tabular-nums"
                          aria-label={`${card.label}: ${card.displayValue}`}
                        >
                          {card.displayValue}
                        </p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {card.definition}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {card.basis}
                      </p>
                      {card.note ? (
                        <p className="text-xs">{card.note}</p>
                      ) : null}
                      {card.state === "VALUE" && card.drillDownView ? (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="h-auto self-start p-0"
                          onClick={() => {
                            const view = card.drillDownView;
                            if (!view) return;
                            setOpen(false);
                            onOpenQueueView(view);
                          }}
                        >
                          {card.drillDownLabel}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))
          : null}

        {state.status === "ready" ? (
          <p className="text-xs text-muted-foreground">
            Updated {new Date(state.generatedAt).toLocaleString()}.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
