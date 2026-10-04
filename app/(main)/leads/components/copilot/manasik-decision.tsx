"use client";

/**
 * Manasik Decision — the Lead Drawer's compact entry point to the Sales
 * Intelligence Engine. Placed below Journey Interest, above Ownership.
 *
 * Deliberately quiet: a heading and four buttons. Nothing is recommended
 * until a staff member asks. The only automatic element is one slim alert,
 * and only when lead data and live Departure Group data genuinely disagree.
 */

import { X } from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { OCCUPANCY_LABELS, formatShortDate } from "@/lib/copilot/sales/format";
import type { CopilotSuggestion, ReplyLanguage, ReplyPurpose, TravelIntent } from "@/lib/copilot/sales/types";

import { dismissCopilotAlertAction, getCopilotAlertAction } from "../../copilot-actions";
import { useLeads } from "../../leads-store";
import type { LeadListItem } from "../../types";
import AnalyseEnquiryDialog from "./analyse-enquiry-dialog";
import AskManasikDialog from "./ask-manasik-dialog";
import BuildOfferSheet from "./build-offer-sheet";
import CompareOptionsDialog from "./compare-options-dialog";
import DraftReplyDialog from "./draft-reply-dialog";
import QuoteBuilderSheet from "./quote-builder-sheet";

type Panel =
  | { kind: "analyse"; adjust: boolean }
  | { kind: "build" }
  | { kind: "compare" }
  | { kind: "ask" }
  | { kind: "draft"; offerId: string | null; purpose: ReplyPurpose; language?: ReplyLanguage; reference?: string }
  | { kind: "quote"; offerId: string | null };

interface ManasikDecisionProps {
  lead: LeadListItem;
  onViewAllGroups: (lead: LeadListItem) => void;
}

export default function ManasikDecision({ lead, onViewAllGroups }: ManasikDecisionProps) {
  const { can, store } = useLeads();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [panel, setPanel] = useState<Panel | null>(null);
  // An intent staff analysed but has not applied yet — used for matching.
  const [workingIntent, setWorkingIntent] = useState<TravelIntent | null>(null);
  const [alert, setAlert] = useState<{ key: string; suggestion: CopilotSuggestion | null } | null>(null);

  const context = store.copilotContexts.find((row) => row.lead_id === lead.id) ?? null;
  const savedIntent = context?.travel_intent ?? null;
  const hasSavedIntent = savedIntent !== null;
  const selectedOffer =
    context?.selected_offer && context.selected_offer.departureGroupId === lead.selectedDepartureGroupId
      ? context.selected_offer
      : null;

  const refresh = () => startTransition(() => router.refresh());
  const close = () => setPanel(null);

  // One slim alert, only when there is a selected group or an applied intent
  // to cross-check against live group data.
  const alertKey = `${lead.id}:${lead.updatedAt}:${lead.selectedDepartureGroupId ?? ""}:${context?.updated_at ?? ""}`;
  const shouldCheck = Boolean(lead.selectedDepartureGroupId) || hasSavedIntent;
  useEffect(() => {
    if (!shouldCheck) return;
    let cancelled = false;
    getCopilotAlertAction(lead.id)
      .then((suggestion) => {
        if (!cancelled) setAlert({ key: alertKey, suggestion });
      })
      .catch(() => {
        // An alert is optional; a failed check simply shows nothing.
      });
    return () => {
      cancelled = true;
    };
  }, [lead.id, alertKey, shouldCheck]);
  const suggestion = shouldCheck && alert?.key === alertKey ? alert.suggestion : null;

  const dismiss = async (target: CopilotSuggestion) => {
    const result = await dismissCopilotAlertAction({ leadId: lead.id, type: target.type, fingerprint: target.id });
    if (!result.ok) {
      toast.add({ title: "Could not dismiss", description: result.error });
      return;
    }
    setAlert({ key: alertKey, suggestion: null });
    refresh();
  };

  const runSuggestion = (target: CopilotSuggestion) => {
    if (target.actionType === "COMPARE_OPTIONS") setPanel({ kind: "compare" });
    else if (target.actionType === "ADJUST_PREFERENCES") setPanel({ kind: "analyse", adjust: true });
    else setPanel({ kind: "build" });
  };

  return (
    <Card className="p-3 gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Manasik Decision</h3>

      {suggestion && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-primary/15 bg-primary/[0.03] px-2.5 py-1.5"
        >
          <p className="flex-1 text-xs text-foreground">{suggestion.message}</p>
          <Button size="xs" variant="secondary" onClick={() => runSuggestion(suggestion)}>
            {suggestion.actionLabel}
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label="Dismiss alert" onClick={() => dismiss(suggestion)}>
            <X className="size-3.5" />
          </Button>
        </div>
      )}

      {selectedOffer && (
        <p className="text-xs text-muted-foreground">
          Offer: {selectedOffer.groupName}
          {selectedOffer.roomType ? ` · ${OCCUPANCY_LABELS[selectedOffer.roomType]}` : ""} · departs{" "}
          {formatShortDate(selectedOffer.departureDate)}
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {can.applyCopilotChanges && (
          <Button size="sm" variant="outline" onClick={() => setPanel({ kind: "analyse", adjust: false })}>
            Analyse Enquiry
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setPanel({ kind: "build" })}>
          Build Offer
        </Button>
        <Button size="sm" variant="outline" onClick={() => setPanel({ kind: "compare" })}>
          Compare Options
        </Button>
        <Button size="sm" variant="outline" onClick={() => setPanel({ kind: "ask" })}>
          Ask Manasik
        </Button>
      </div>

      {panel?.kind === "analyse" && (
        <AnalyseEnquiryDialog
          lead={lead}
          initialIntent={panel.adjust ? (workingIntent ?? savedIntent) : null}
          startEditing={panel.adjust}
          onClose={close}
          onApplied={() => {
            setWorkingIntent(null);
            refresh();
          }}
          onFindBestGroup={(intent) => {
            setWorkingIntent(intent);
            setPanel({ kind: "build" });
          }}
        />
      )}

      {panel?.kind === "build" && (
        <BuildOfferSheet
          lead={lead}
          workingIntent={workingIntent}
          hasSavedIntent={hasSavedIntent}
          onClose={close}
          onSelected={refresh}
          onAnalyse={() => setPanel({ kind: "analyse", adjust: false })}
          onCompare={() => setPanel({ kind: "compare" })}
          onCreateQuote={(offerId) => setPanel({ kind: "quote", offerId })}
          onDraftReply={(offerId) => setPanel({ kind: "draft", offerId, purpose: "OFFER_RECOMMENDATION" })}
          onAdjustPreferences={() => setPanel({ kind: "analyse", adjust: true })}
          onViewAllGroups={() => {
            close();
            onViewAllGroups(lead);
          }}
        />
      )}

      {panel?.kind === "compare" && (
        <CompareOptionsDialog
          lead={lead}
          workingIntent={workingIntent}
          onClose={close}
          onSelected={refresh}
          onCreateQuote={(offerId) => setPanel({ kind: "quote", offerId })}
          onDraftComparison={(offerId) => setPanel({ kind: "draft", offerId, purpose: "COMPARISON" })}
        />
      )}

      {panel?.kind === "ask" && (
        <AskManasikDialog
          lead={lead}
          onClose={close}
          onUseInReply={(answer) => setPanel({ kind: "draft", offerId: null, purpose: "GENERAL", reference: answer })}
          onBuildOffer={() => setPanel({ kind: "build" })}
          onCreateQuote={(offerId) => setPanel({ kind: "quote", offerId })}
          onDraftReply={(language) => setPanel({ kind: "draft", offerId: null, purpose: "OFFER_RECOMMENDATION", language })}
        />
      )}

      {panel?.kind === "draft" && (
        <DraftReplyDialog
          lead={lead}
          offerId={panel.offerId}
          workingIntent={workingIntent}
          initialPurpose={panel.purpose}
          initialLanguage={panel.language}
          reference={panel.reference ?? null}
          onClose={close}
          onSaved={refresh}
        />
      )}

      {panel?.kind === "quote" && (
        <QuoteBuilderSheet lead={lead} offerId={panel.offerId} onClose={close} onSaved={refresh} />
      )}
    </Card>
  );
}
