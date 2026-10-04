"use client";

import { packageById, pricePerPerson } from "@/lib/data/leads";
import { TrendingUp, Users } from "lucide-react";
import React from "react";

import type {
  LeadJourneyType,
  LeadPackageRow,
  LeadRoomPreference,
} from "../../types";
import {
  JOURNEY_TYPE_LABELS,
  ROOM_PREFERENCE_LABELS,
  formatCurrencyLKR,
  partySizeLabel,
} from "../../utils";
import { TONE_CLASS, TONE_STAT_CARD, TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

interface OpportunityPreviewCardProps {
  packages: LeadPackageRow[];
  journeyType: LeadJourneyType;
  packageId: string | null;
  roomPreference: LeadRoomPreference;
  adults: number;
  childrenCount: number;
}

/**
 * Live estimate of what the enquiry is worth, using the same
 * `pricePerPerson` the created lead will be valued with — so the number the
 * operator sees here is the number that lands in the table.
 */
export default function OpportunityPreviewCard({
  packages,
  journeyType,
  packageId,
  roomPreference,
  adults,
  childrenCount,
}: OpportunityPreviewCardProps) {
  const travellers = adults + childrenCount;
  if (travellers <= 0) return null;

  const unitPrice = pricePerPerson(
    { packages },
    packageId,
    journeyType,
    roomPreference,
  );
  const estimatedValue = unitPrice * travellers;
  const selected = packageById({ packages }, packageId);

  return (
    <Card
      className={cn(
        " mb-3 flex-row border-none p-3 text-xs text-foreground backdrop-blur-md flex items-center justify-between gap-3",
        TONE_STAT_CARD.success,
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={cn(
            "size-8 rounded-full flex items-center justify-center shrink-0",
            TONE_CLASS.success,
          )}
          aria-hidden
        >
          <TrendingUp className="size-4" />
        </div>
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={cn(
                "font-semibold text-xs uppercase tracking-wide shrink-0",
                TONE_TEXT.success,
              )}
            >
              Estimated opportunity
            </span>
            <span className="text-[11px] text-muted-foreground truncate">
              (
              {selected
                ? `${selected.name} · ${ROOM_PREFERENCE_LABELS[roomPreference]}`
                : `${JOURNEY_TYPE_LABELS[journeyType]} baseline`}
              )
            </span>
          </div>
          <span className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
            <Users className={cn("size-3 shrink-0", TONE_TEXT.success)} />
            {travellers} traveller{travellers === 1 ? "" : "s"} (
            {partySizeLabel(adults, childrenCount)}) ×{" "}
            {formatCurrencyLKR(unitPrice)}/pax
          </span>
        </div>
      </div>

      <div className="flex flex-col items-end shrink-0">
        <span
          className={cn(
            "text-base font-extrabold font-number",
            TONE_TEXT.success,
          )}
        >
          {formatCurrencyLKR(estimatedValue)}
        </span>
        <span
          className={cn(
            "text-[10px] font-semibold uppercase tracking-wider",
            TONE_TEXT.success,
          )}
        >
          Pipeline value
        </span>
      </div>
    </Card>
  );
}
