"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  buildIntelligenceRailView,
  type InboxIntelligenceData,
  type RailDeterministicFacts,
} from "@/lib/inbox/intelligence/rail-view";

import ConversationInterventionCard from "./conversation-intervention-card";
import ConversationOfferCard from "./conversation-offer-card";
import IntelligenceEvidencePopover from "./intelligence-evidence-popover";
import { TriageReviewControl } from "./triage-review-control";
import { InboxTranslationControl } from "./inbox-translation-control";

/** Shown while Copilot's reading is still loading: the rail's own skeleton, so the rest of the panel never waits for it. */
export function ConversationIntelligenceRailSkeleton() {
  return (
    <div
      className="space-y-2"
      role="status"
      aria-label="Loading Copilot's reading"
    >
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}

/**
 * What Copilot understood about this conversation: what the customer wants, how urgent, how they feel, and any flags —
 * each with a "Why?" that shows the message it was read from. Composed ABOVE the lead block in the context panel and
 * never replaces it. It says honestly when a reading is pending, keyword-based, out of date or failed, and it always
 * shows the facts that need no model. Renders nothing when the agency does not use Copilot's triage.
 */
export default function ConversationIntelligenceRail({
  data,
  deterministic,
  conversationId = null,
  canUseOffer = false,
  loadError = null,
  onRetry,
  part = "all",
}: {
  /** `null` while loading. */
  data: InboxIntelligenceData | null;
  /** The conversation the review and offer cards act on; without it neither is shown. */
  conversationId?: string | null;
  /** May this person act on the offer (draft, quote)? Reviews are shown to everyone who can open the Inbox. */
  canUseOffer?: boolean;
  deterministic: RailDeterministicFacts;
  loadError?: string | null;
  onRetry?: () => void;
  /**
   * The panel shows the rail in two places: "risk" is only the human-review cards, kept at the very top so an urgent flag is
   * never pushed down; "reading" is everything else, placed after who the customer is. "all" shows both together.
   */
  part?: "all" | "risk" | "reading";
}) {
  if (loadError && !data) {
    if (part === "risk") return null;
    return (
      <section aria-label="Copilot's reading" className="space-y-2">
        <p role="alert" className="text-xs text-muted-foreground">
          {loadError}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            Try again
          </button>
        )}
      </section>
    );
  }
  if (!data)
    return part === "risk" ? null : <ConversationIntelligenceRailSkeleton />;

  const view = buildIntelligenceRailView(data, deterministic);
  if (!view) return null;

  if (part === "risk") {
    return conversationId && view.interventions.length > 0 ? (
      <ConversationInterventionCard
        reviews={view.interventions}
        conversationId={conversationId}
      />
    ) : null;
  }

  return (
    <section aria-label="Copilot's reading" className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{view.headline}</p>
          {view.sourceLabel && (
            <Badge variant="outline" className="mt-1">
              {view.sourceLabel}
            </Badge>
          )}
          {view.note && (
            <p className="mt-1 text-xs text-muted-foreground">{view.note}</p>
          )}
          {conversationId && data.intelligence?.digest && (
            <InboxTranslationControl
              conversationId={conversationId}
              label="Translate conversation summary"
            />
          )}
        </div>
      </div>

      {part === "all" && conversationId && (
        <ConversationInterventionCard
          reviews={view.interventions}
          conversationId={conversationId}
        />
      )}

      {conversationId &&
        canUseOffer &&
        data.intelligence?.intentCode &&
        data.intelligence.computedAt && (
          <TriageReviewControl
            conversationId={conversationId}
            predictedIntent={data.intelligence.intentCode}
            predictionComputedAt={data.intelligence.computedAt}
          />
        )}

      {view.facts.length > 0 && (
        <Card className="gap-0 divide-y bg-transparent! p-0 shadow-none!">
          {view.facts.map((fact) => (
            <div
              key={fact.key}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{fact.label}</p>
                <p className="wrap-break-word text-sm">{fact.value}</p>
                {fact.confidencePercent !== null && (
                  <p className="text-xs text-muted-foreground">
                    {fact.lowConfidence
                      ? `Only ${fact.confidencePercent}% sure. Check before relying on it.`
                      : `${fact.confidencePercent}% sure`}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {fact.attention && (
                  <Badge variant="destructive">Needs attention</Badge>
                )}
                {fact.evidence && (
                  <IntelligenceEvidencePopover
                    factLabel={fact.label}
                    evidence={[fact.evidence]}
                  />
                )}
              </div>
            </div>
          ))}
        </Card>
      )}

      {view.travelDetails.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Travel details
          </p>
          <Card className="gap-0 divide-y bg-transparent! p-0 shadow-none!">
            {view.travelDetails.map((detail) => (
              <div
                key={detail.key}
                className="flex items-center justify-between gap-2 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    {detail.label}
                  </p>
                  <p className="wrap-break-word text-sm">{detail.value}</p>
                  {detail.sourceLabel && (
                    <Badge variant="outline" className="mt-1">
                      {detail.sourceLabel}
                    </Badge>
                  )}
                </div>
                <IntelligenceEvidencePopover
                  factLabel={detail.label}
                  evidence={detail.evidence}
                />
              </div>
            ))}
          </Card>
        </div>
      )}

      {view.offer && conversationId && canUseOffer && (
        <ConversationOfferCard
          offer={view.offer}
          conversationId={conversationId}
        />
      )}

      {view.signals.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Flags</p>
          {view.signals.map((signal) => (
            <div
              key={signal.code}
              className="flex items-center justify-between gap-2"
            >
              <Badge
                variant="destructive"
                className="h-auto whitespace-normal py-1 text-left"
              >
                {signal.label}
              </Badge>
              <IntelligenceEvidencePopover
                factLabel={signal.label}
                evidence={signal.evidence}
              />
            </div>
          ))}
        </div>
      )}

      {view.deterministic.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          {view.deterministic.map((row) => (
            <div key={row.label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{row.label}</dt>
              <dd className="wrap-break-word text-sm">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
