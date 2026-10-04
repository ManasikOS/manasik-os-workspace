"use client";

import { useTransition } from "react";
import { ArrowUpRight, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { ToneBadge } from "@/components/ui/tone-badge";
import type { Urgency } from "@/lib/inbox/intelligence/contracts";
import type { NextBestAction } from "@/lib/inbox/next-best-action";

import {
  createQuoteFromConversation,
  openDepartureGroupFromConversation,
} from "../actions";
import { announceComposerSuggestRequest } from "./composer-draft-event";
import { ConversationConvertMenu } from "./conversation-convert-menu";
import { useInboxRefresh } from "./inbox-refresh-context";

const URGENCY_PRESENTATION: Record<
  Urgency,
  { label: string; tone: "neutral" | "info" | "warning" | "danger" }
> = {
  LOW: { label: "Low urgency", tone: "neutral" },
  NORMAL: { label: "Normal urgency", tone: "info" },
  HIGH: { label: "High urgency", tone: "warning" },
  CRITICAL: { label: "Critical urgency", tone: "danger" },
};

/**
 * The single deterministic recommendation for the open conversation.
 * Every destination is an existing guarded workflow; this card never sends,
 * confirms, or creates consequential work by itself.
 */
export function RecommendedNextActionCard({
  action,
  conversationId,
  canUseCopilot,
  canConvertConversation,
}: {
  action: NextBestAction;
  conversationId: string;
  canUseCopilot: boolean;
  canConvertConversation: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const refreshInbox = useInboxRefresh();
  const urgency = URGENCY_PRESENTATION[action.urgency];
  const permissionBlocker =
    action.destination.kind === "COMPOSER_DRAFT" && !canUseCopilot
      ? "Your role cannot use Copilot to prepare a reply."
      : action.destination.kind === "CONVERSION_REVIEW" &&
          !canConvertConversation
        ? "Your role cannot create tasks or cases from conversations."
        : null;
  const blocker = action.availability.available
    ? permissionBlocker
    : action.availability.blocker;
  const available = blocker === null;

  function runRecommendedAction() {
    if (!available) return;
    if (action.destination.kind === "COMPOSER_DRAFT") {
      announceComposerSuggestRequest({ conversationId });
      return;
    }
    startTransition(async () => {
      if (action.destination.kind === "QUOTE_DRAFT") {
        const result = await createQuoteFromConversation({ conversationId });
        toast.add({
          title: result.ok
            ? "Draft quote created"
            : "Could not create the quote",
          description: result.ok
            ? `${result.reference} is saved as a draft. Nothing was sent.`
            : result.error,
        });
        if (result.ok) refreshInbox();
        return;
      }
      if (action.destination.kind === "OFFER_REVIEW") {
        const result = await openDepartureGroupFromConversation({
          conversationId,
        });
        if (!result.ok) {
          toast.add({
            title: "Could not open the departure",
            description: result.error,
          });
          return;
        }
        window.open(result.href, "_blank", "noopener");
      }
    });
  }

  return (
    <Card
      className="gap-3 border-primary/3! bg-primary/5 p-4"
      data-reason-code={action.reasonCode}
      aria-labelledby="recommended-next-action-heading"
    >
      <div className=" items-start justify-between gap-3">
        <div className="flex  justify-between">
          <p
            id="recommended-next-action-heading"
            className="text-xs font-medium text-muted-foreground"
          >
            Recommended next action
          </p>
          <ToneBadge
            tone={urgency.tone}
            label={urgency.label}
            className="h-6 shrink-0 px-2 py-0"
          />
        </div>
        <p className="wrap-break-word text-sm mt-1 font-semibold">
          {action.label}
        </p>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {action.reason}
      </p>

      {blocker && (
        <p role="status" className="text-xs font-medium text-foreground">
          {blocker}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {action.destination.kind === "CONVERSION_REVIEW" && available ? (
          <ConversationConvertMenu
            conversationId={conversationId}
            variant="recommendation"
            suggested={{
              kind: action.destination.conversionKind,
              label: action.label,
            }}
          />
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={!available || isPending}
            title="You review everything before it is sent or created."
            onClick={runRecommendedAction}
            data-inbox-shortcut-trigger={
              action.destination.kind === "QUOTE_DRAFT"
                ? "START_QUOTE"
                : undefined
            }
            aria-keyshortcuts={
              action.destination.kind === "QUOTE_DRAFT" ? "q" : undefined
            }
          >
            {action.destination.kind === "COMPOSER_DRAFT" ? (
              <Sparkles className="size-3.5" aria-hidden="true" />
            ) : (
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            )}
            {isPending ? "Opening…" : action.label}
          </Button>
        )}
      </div>
    </Card>
  );
}
