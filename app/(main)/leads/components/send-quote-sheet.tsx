"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { FileText, Loader2, Mail, MessageSquare } from "lucide-react";
import React, { useState } from "react";

import { pricePerPerson } from "@/lib/data/leads";
import type { LeadPackageRow } from "@/lib/types/leads";
import { sendQuoteAction } from "../actions";
import { useLeads } from "../leads-store";
import type { LeadListItem } from "../types";
import { formatExactLKR, ROOM_PREFERENCE_LABELS, whatsappLink } from "../utils";
import { TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

interface SendQuoteSheetProps {
  lead: LeadListItem | null;
  onClose: () => void;
  onSent: () => void;
}

const DEPOSIT_RATE = 0.2;

/**
 * Composes a quote from the lead's package + room preference + traveller
 * count, prices it at today's package rate, and stores the result as a
 * pricing *snapshot* on `lead_quotes` — a later repricing of the package must
 * not silently rewrite a quote a customer already received.
 */
const SendQuoteSheet = ({ lead, onClose, onSent }: SendQuoteSheetProps) => {
  const { store } = useLeads();
  if (!lead) return null;
  return (
    <SendQuoteForm
      key={lead.id}
      lead={lead}
      packages={store.packages}
      onClose={onClose}
      onSent={onSent}
    />
  );
};

function SendQuoteForm({
  lead,
  packages,
  onClose,
  onSent,
}: {
  lead: LeadListItem;
  packages: LeadPackageRow[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [sending, setSending] = useState<"WHATSAPP" | "EMAIL" | "PDF" | null>(
    null,
  );

  const pkg = packages.find((entry) => entry.id === lead.packageId) ?? null;
  const roomPricePerPerson = pricePerPerson(
    { packages },
    lead.packageId,
    lead.journeyType,
    lead.roomPreference,
  );
  const total = roomPricePerPerson * lead.partySize;
  const depositPerPerson = Math.round(roomPricePerPerson * DEPOSIT_RATE);
  const deposit = depositPerPerson * lead.partySize;

  const groupLabel = lead.selectedDepartureGroupId
    ? "Selected departure group"
    : null;

  const send = async (via: "WHATSAPP" | "EMAIL" | "PDF") => {
    setSending(via);
    const result = await sendQuoteAction({
      leadId: lead.id,
      packageId: lead.packageId,
      departureGroupId: lead.selectedDepartureGroupId,
      roomPreference: lead.roomPreference,
      adults: lead.adults,
      children: lead.children,
      roomPricePerPerson,
      depositPerPerson,
      currency: pkg?.currency ?? "LKR",
      packageName: lead.packageName,
      groupLabel,
      groupDates: null,
      sentVia: via,
    });
    setSending(null);

    if (!result.ok) {
      toast.add({ title: "Could not send quote", description: result.error });
      return;
    }

    if (via === "WHATSAPP") {
      const text = encodeURIComponent(
        `Assalamu alaikum ${lead.name},\n\n${lead.packageName}\n${lead.adults} adult(s)${
          lead.children > 0 ? `, ${lead.children} child(ren)` : ""
        } · ${ROOM_PREFERENCE_LABELS[lead.roomPreference]}\nTotal: ${formatExactLKR(total)}\nDeposit due: ${formatExactLKR(deposit)}\nValid until: ${
          result.validUntil
            ? new Date(result.validUntil).toLocaleDateString()
            : ""
        }\n\nQuote ${result.reference}`,
      );
      window.open(
        `${whatsappLink(lead.mobileRaw)}?text=${text}`,
        "_blank",
        "noopener,noreferrer",
      );
    }

    toast.add({
      title: `Quote ${result.reference} sent`,
      description: `${lead.name} · ${formatExactLKR(total)}`,
    });
    onSent();
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="data-[side=right]:sm:max-w-md w-full">
        <SheetHeader className="gap-1">
          <SheetTitle className="flex items-center gap-2">
            <FileText className="size-4 text-primary" /> Send quote
          </SheetTitle>
          <p className="text-sm text-muted-foreground">
            {lead.name} · {lead.reference}
          </p>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          <Card className="p-4 gap-2">
            <p className="text-sm font-semibold text-foreground">
              {lead.packageName}
            </p>
            {groupLabel && (
              <p className="text-xs text-muted-foreground">{groupLabel}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {lead.adults} adult{lead.adults === 1 ? "" : "s"}
              {lead.children > 0
                ? `, ${lead.children} child${lead.children === 1 ? "" : "ren"}`
                : ""}{" "}
              · {ROOM_PREFERENCE_LABELS[lead.roomPreference]}
            </p>
            <div className="flex items-baseline justify-between mt-2 pt-2 border-t border-border/40">
              <span className="text-xs text-muted-foreground">
                {formatExactLKR(roomPricePerPerson)} × {lead.partySize}
              </span>
              <span className="text-lg font-bold text-foreground tabular-nums">
                {formatExactLKR(total)}
              </span>
            </div>
            <div
              className={cn(
                "flex items-baseline justify-between",
                TONE_TEXT.success,
              )}
            >
              <span className="text-xs">Booking deposit</span>
              <span className="text-sm font-semibold tabular-nums">
                {formatExactLKR(deposit)}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Valid for 7 days from today.
            </p>
          </Card>

          <div className="flex flex-col gap-2">
            <Button
              disabled={sending !== null}
              onClick={() => send("WHATSAPP")}
              className="justify-start"
            >
              {sending === "WHATSAPP" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <MessageSquare />
              )}
              Send by WhatsApp
            </Button>
            <Button
              variant="outline"
              disabled={sending !== null || !lead.email}
              onClick={() => send("EMAIL")}
              className="justify-start"
            >
              {sending === "EMAIL" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Mail />
              )}
              Send by Email{!lead.email ? " (no email on file)" : ""}
            </Button>
            <Button
              variant="outline"
              disabled={sending !== null}
              onClick={() => send("PDF")}
              className="justify-start"
            >
              {sending === "PDF" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <FileText />
              )}
              Record as sent (download/print separately)
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default SendQuoteSheet;
