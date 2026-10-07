"use client";

/**
 * Build Best Offer — runs OfferMatchingService on the server and shows one
 * recommended Package + Departure Group, why it fits and its trade-offs.
 * "Use This Offer" records the choice on the lead; it never reserves seats
 * or creates a booking.
 */

import { Loader2 } from "lucide-react";
import React, { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import {
  OCCUPANCY_LABELS,
  formatDateRange,
  formatShortDate,
  travellersLabel,
} from "@/lib/copilot/sales/format";
import { formatMoney } from "@/lib/copilot/sales/money";
import type { OfferMatch, TravelIntent } from "@/lib/copilot/sales/types";
import { TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

import {
  buildOffersAction,
  selectOfferAction,
  type BuildOffersResult,
} from "../../copilot-actions";
import { useLeads } from "../../leads-store";
import type { LeadListItem } from "../../types";
import { BulletList, SectionLabel, StrategyBlock } from "./offer-parts";

type Ready = Extract<BuildOffersResult, { ok: true }>;

interface BuildOfferSheetProps {
  lead: LeadListItem;
  workingIntent: TravelIntent | null;
  hasSavedIntent: boolean;
  onClose: () => void;
  onSelected: () => void;
  onAnalyse: () => void;
  onCompare: () => void;
  onCreateQuote: (offerId: string) => void;
  onDraftReply: (offerId: string) => void;
  onViewAllGroups: () => void;
  onAdjustPreferences: () => void;
}

export default function BuildOfferSheet({
  lead,
  workingIntent,
  hasSavedIntent,
  onClose,
  onSelected,
  onAnalyse,
  onCompare,
  onCreateQuote,
  onDraftReply,
  onViewAllGroups,
  onAdjustPreferences,
}: BuildOfferSheetProps) {
  const { can, addNote } = useLeads();
  const [phase, setPhase] = useState<"prompt" | "loading" | "ready" | "error">(
    workingIntent || hasSavedIntent ? "loading" : "prompt",
  );
  const [data, setData] = useState<Ready | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showStrategy, setShowStrategy] = useState(false);
  const [applyRoom, setApplyRoom] = useState(false);
  const [selecting, setSelecting] = useState(false);

  useEffect(() => {
    if (phase !== "loading") return;
    let cancelled = false;
    buildOffersAction({
      leadId: lead.id,
      mode: "BUILD",
      intentOverride: workingIntent,
    }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setData(result);
        setPhase("ready");
      } else {
        setError(result.error);
        setPhase("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [phase, lead.id, workingIntent]);

  const offer = data?.result.offers[0] ?? null;

  const chooseOffer = async (target: OfferMatch) => {
    setSelecting(true);
    const result = await selectOfferAction({
      leadId: lead.id,
      offerId: target.id,
      applyRoomType: applyRoom,
      intentOverride: workingIntent,
    });
    setSelecting(false);
    if (!result.ok) {
      toast.add({ title: "Could not select offer", description: result.error });
      return;
    }
    toast.add({
      title: "Offer selected",
      description: `${result.groupName} — no seats reserved.`,
    });
    onSelected();
    onClose();
  };

  const recordWaitlistInterest = async () => {
    if (!data?.result.noMatch) return;
    const options = data.result.noMatch.waitlistOptions.map(
      (option) =>
        `${option.groupName} (${formatShortDate(option.departureDate)})`,
    );
    const result = await addNote(
      lead.id,
      `Waitlist interest — ${data.result.noMatch.reason}${options.length > 0 ? ` Waitlist open on: ${options.join(", ")}.` : ""}`,
    );
    if (!result.ok) {
      toast.add({
        title: "Could not record interest",
        description: result.error,
      });
      return;
    }
    toast.add({ title: "Waitlist interest recorded" });
    onClose();
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="data-[side=right]:sm:max-w-lg w-full">
        <SheetHeader className="gap-1">
          <SheetTitle>Build Best Offer</SheetTitle>
          <p className="text-sm text-muted-foreground">
            {lead.name} · {lead.reference}
          </p>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6 overflow-y-auto custom-scroll">
          {phase === "prompt" && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-foreground">
                Analyse the enquiry first or continue using current lead
                details.
              </p>
              <div className="flex flex-wrap gap-2">
                {can.applyCopilotChanges && (
                  <Button variant="outline" onClick={onAnalyse}>
                    Analyse Enquiry
                  </Button>
                )}
                <Button onClick={() => setPhase("loading")}>
                  Continue with Lead Details
                </Button>
              </div>
            </div>
          )}

          {phase === "loading" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Manasik Copilot is
              comparing live departure groups…
            </p>
          )}

          {phase === "error" && (
            <div className="flex flex-col gap-2">
              <p className={cn("text-sm", TONE_TEXT.danger)}>{error}</p>
              <Button
                variant="outline"
                className="self-start"
                onClick={() => setPhase("loading")}
              >
                Try again
              </Button>
            </div>
          )}

          {phase === "ready" && data && !offer && data.result.noMatch && (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-semibold text-foreground">
                No viable offer found.
              </p>
              <div className="flex flex-col gap-1">
                <SectionLabel>Reason</SectionLabel>
                <p className="text-sm text-foreground">
                  {data.result.noMatch.reason}
                </p>
              </div>
              <BulletList
                title="Waitlist open"
                items={data.result.noMatch.waitlistOptions.map(
                  (option) =>
                    `${option.groupName} · ${formatDateRange(option.departureDate, option.returnDate)}`,
                )}
              />
              <div className="flex flex-wrap gap-2">
                {can.findGroups && (
                  <Button variant="outline" onClick={onViewAllGroups}>
                    View All Groups
                  </Button>
                )}
                {can.applyCopilotChanges && (
                  <Button variant="outline" onClick={onAdjustPreferences}>
                    Adjust Preferences
                  </Button>
                )}
                {can.addNote && (
                  <Button onClick={recordWaitlistInterest}>
                    Add to Waitlist Interest
                  </Button>
                )}
              </div>
            </div>
          )}

          {phase === "ready" && data && offer && (
            <OfferView
              offer={offer}
              data={data}
              lead={lead}
              applyRoom={applyRoom}
              onApplyRoomChange={setApplyRoom}
              showStrategy={showStrategy}
              onToggleStrategy={() => setShowStrategy((value) => !value)}
              actions={
                <div className="flex flex-wrap gap-2">
                  {can.applyCopilotChanges && (
                    <Button
                      onClick={() => chooseOffer(offer)}
                      disabled={selecting}
                    >
                      {selecting && <Loader2 className="animate-spin" />}
                      Use This Offer
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={onCompare}
                    disabled={data.result.offers.length < 2}
                  >
                    Compare Alternatives
                  </Button>
                  {can.createQuoteDraft && (
                    <Button
                      variant="outline"
                      onClick={() => onCreateQuote(offer.id)}
                    >
                      Create Quote
                    </Button>
                  )}
                  {can.draftCustomerReply && (
                    <Button
                      variant="outline"
                      onClick={() => onDraftReply(offer.id)}
                    >
                      Draft Customer Reply
                    </Button>
                  )}
                </div>
              }
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function OfferView({
  offer,
  data,
  lead,
  applyRoom,
  onApplyRoomChange,
  showStrategy,
  onToggleStrategy,
  actions,
}: {
  offer: OfferMatch;
  data: Ready;
  lead: LeadListItem;
  applyRoom: boolean;
  onApplyRoomChange: (value: boolean) => void;
  showStrategy: boolean;
  onToggleStrategy: () => void;
  actions: React.ReactNode;
}) {
  const money = (value: number) => formatMoney(value, offer.currency);
  const payers = offer.adults + offer.children;
  const simplePricing = offer.children === 0 && offer.infants === 0;
  const roomDiffers =
    offer.roomType !== undefined && offer.roomType !== lead.roomPreference;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-md border border-border/60 p-3">
        <SectionLabel>Recommended offer</SectionLabel>
        <div>
          <p className="text-base font-semibold text-foreground">
            {offer.groupName}
          </p>
          <p className="text-sm text-foreground">
            {formatDateRange(
              String(offer.departureDate),
              String(offer.returnDate),
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {offer.packageName} · {offer.availableSeats} seats available
          </p>
        </div>

        <div className="flex flex-col gap-0.5">
          <SectionLabel>Suggested configuration</SectionLabel>
          <p className="text-sm text-foreground">
            {travellersLabel(offer.adults, offer.children, offer.infants)}
            {offer.roomType ? ` · ${OCCUPANCY_LABELS[offer.roomType]}` : ""}
            {offer.roomTypeAssumed && (
              <span className="text-muted-foreground">
                {" "}
                (not yet confirmed)
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-col gap-0.5">
          <SectionLabel>Price</SectionLabel>
          <p className="text-sm text-foreground tabular-nums">
            {simplePricing
              ? `${money(offer.pricePerPerson)} × ${payers}`
              : `${money(offer.pricePerPerson)} per adult`}
          </p>
          <p className="text-sm font-semibold text-foreground tabular-nums">
            Total: {money(offer.totalPrice)}
          </p>
        </div>

        {offer.depositPerPerson !== undefined &&
          offer.totalDeposit !== undefined && (
            <div className="flex flex-col gap-0.5">
              <SectionLabel>Deposit</SectionLabel>
              <p className="text-sm text-foreground tabular-nums">
                {money(offer.depositPerPerson)} × {payers}
              </p>
              <p className="text-sm font-semibold text-foreground tabular-nums">
                Total deposit: {money(offer.totalDeposit)}
              </p>
            </div>
          )}

        <BulletList title="Why it fits" items={offer.matchReasons} />
        <BulletList title="Trade-off" items={offer.tradeoffs} />
        <BulletList title="Still to confirm" items={offer.missingInformation} />

        {roomDiffers && offer.roomType && (
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={applyRoom}
              onCheckedChange={(checked) => onApplyRoomChange(checked === true)}
            />
            Also set the lead’s room preference to{" "}
            {OCCUPANCY_LABELS[offer.roomType]}
          </label>
        )}

        {actions}
      </div>

      {data.strategy && (
        <div className="flex flex-col gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={onToggleStrategy}
          >
            {showStrategy ? "Hide Sales Strategy" : "View Sales Strategy"}
          </Button>
          {showStrategy && <StrategyBlock strategy={data.strategy} />}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        {data.usedIntent
          ? "Matched on the applied travel intent"
          : "Matched on current lead details"}{" "}
        · {data.result.offers.length} viable option
        {data.result.offers.length === 1 ? "" : "s"} · Seats are only reserved
        once a booking is created.
      </p>
    </div>
  );
}
