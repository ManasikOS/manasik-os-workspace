"use client";

/**
 * Compare Options — up to three viable Package + Departure Group options,
 * side by side, with the engine's recommendation and the reason for it.
 */

import { Loader2 } from "lucide-react";
import React, { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { ToneBadge } from "@/components/ui/tone-badge";
import { OCCUPANCY_LABELS, formatDateRange } from "@/lib/copilot/sales/format";
import { formatMoney } from "@/lib/copilot/sales/money";
import type { OfferMatch, TravelIntent } from "@/lib/copilot/sales/types";
import { TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

import { buildOffersAction, selectOfferAction, type BuildOffersResult } from "../../copilot-actions";
import { useLeads } from "../../leads-store";
import type { LeadListItem } from "../../types";
import { SectionLabel } from "./offer-parts";

interface CompareOptionsDialogProps {
  lead: LeadListItem;
  workingIntent: TravelIntent | null;
  onClose: () => void;
  onSelected: () => void;
  onCreateQuote: (offerId: string) => void;
  onDraftComparison: (offerId: string | null) => void;
}

const ROWS: { label: string; value: (offer: OfferMatch) => string }[] = [
  { label: "Travel dates", value: (o) => formatDateRange(String(o.departureDate), String(o.returnDate)) },
  { label: "Duration", value: (o) => `${o.durationDays} days` },
  { label: "Available seats", value: (o) => String(o.availableSeats) },
  { label: "Room type", value: (o) => (o.roomType ? `${OCCUPANCY_LABELS[o.roomType]}${o.roomTypeAssumed ? " *" : ""}` : "—") },
  { label: "Price / person", value: (o) => formatMoney(o.pricePerPerson, o.currency) },
  { label: "Total price", value: (o) => formatMoney(o.totalPrice, o.currency) },
  { label: "Deposit", value: (o) => (o.totalDeposit !== undefined ? formatMoney(o.totalDeposit, o.currency) : "—") },
  { label: "Payment plan", value: (o) => o.paymentPlanSummary },
  { label: "Hotel standard", value: (o) => o.hotelStandard ?? "Not stated" },
  { label: "Transport", value: (o) => o.transportStandard ?? "Not stated" },
  { label: "Major inclusions", value: (o) => o.majorInclusions.slice(0, 3).join(", ") || "—" },
  { label: "Key trade-off", value: (o) => o.tradeoffs[0] ?? "None" },
];

export default function CompareOptionsDialog({
  lead,
  workingIntent,
  onClose,
  onSelected,
  onCreateQuote,
  onDraftComparison,
}: CompareOptionsDialogProps) {
  const { can } = useLeads();
  const [data, setData] = useState<BuildOffersResult | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    buildOffersAction({ leadId: lead.id, mode: "COMPARE", intentOverride: workingIntent }).then((result) => {
      if (!cancelled) setData(result);
    });
    return () => {
      cancelled = true;
    };
  }, [lead.id, workingIntent]);

  const offers = data?.ok ? data.result.offers.slice(0, 3) : [];
  const recommended = offers[0] ?? null;

  const select = async (offer: OfferMatch) => {
    setSelecting(offer.id);
    const result = await selectOfferAction({ leadId: lead.id, offerId: offer.id, applyRoomType: false, intentOverride: workingIntent });
    setSelecting(null);
    if (!result.ok) {
      toast.add({ title: "Could not select option", description: result.error });
      return;
    }
    toast.add({ title: "Option selected", description: `${result.groupName} — no seats reserved.` });
    onSelected();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Compare Options</DialogTitle>
          <DialogDescription>
            {lead.name} · {lead.reference}
          </DialogDescription>
        </DialogHeader>

        {!data && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Checking live departure groups…
          </p>
        )}
        {data && !data.ok && <p className={cn("text-sm", TONE_TEXT.danger)}>{data.error}</p>}
        {data?.ok && offers.length === 0 && (
          <p className="text-sm text-foreground">{data.result.noMatch?.reason ?? "No viable options to compare."}</p>
        )}

        {offers.length > 0 && (
          <div className="flex flex-col gap-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60">
                    <th className="py-2 pr-3 text-left text-xs font-medium text-muted-foreground align-bottom">Package / Group</th>
                    {offers.map((offer) => (
                      <th key={offer.id} className="py-2 px-3 text-left align-bottom min-w-44">
                        {offer.isRecommended && <ToneBadge tone="success" label="Recommended" className="mb-1" />}
                        <p className="font-semibold text-foreground">{offer.packageName}</p>
                        <p className="text-xs font-normal text-muted-foreground">{offer.groupName}</p>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => (
                    <tr key={row.label} className="border-b border-border/30">
                      <td className="py-1.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">{row.label}</td>
                      {offers.map((offer) => (
                        <td key={offer.id} className="py-1.5 px-3 text-foreground font-number">
                          {row.value(offer)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {can.applyCopilotChanges && (
                    <tr>
                      <td />
                      {offers.map((offer) => (
                        <td key={offer.id} className="pt-2 px-3">
                          <Button size="sm" variant="outline" onClick={() => select(offer)} disabled={selecting !== null}>
                            {selecting === offer.id && <Loader2 className="animate-spin" />}
                            Select Option
                          </Button>
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {offers.some((offer) => offer.roomTypeAssumed) && (
              <p className="text-[11px] text-muted-foreground">* Room type assumed — confirm with the customer.</p>
            )}

            {recommended && data?.ok && (
              <div className="flex flex-col gap-1">
                <SectionLabel>Manasik recommendation</SectionLabel>
                <p className="text-sm font-medium text-foreground">{recommended.packageName}</p>
                {data.result.recommendationReason && (
                  <p className="text-sm text-muted-foreground">{data.result.recommendationReason}</p>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {can.createQuoteDraft && recommended && (
            <Button variant="outline" onClick={() => onCreateQuote(recommended.id)}>
              Create Quote
            </Button>
          )}
          {can.draftCustomerReply && offers.length > 0 && (
            <Button onClick={() => onDraftComparison(recommended?.id ?? null)}>Draft Comparison Reply</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
