"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { CheckCircle2, Loader2, PackageCheck } from "lucide-react";
import React, { useState } from "react";

import { pricePerPerson } from "@/lib/data/leads";
import type { LeadPackageRow } from "@/lib/types/leads";
import { convertLeadToBookingAction } from "../actions";
import { useLeads } from "../leads-store";
import type { LeadListItem } from "../types";
import { formatExactLKR, ROOM_PREFERENCE_LABELS } from "../utils";
import { TONE_TEXT } from "@/lib/ui/tone";
import { cn } from "@/lib/utils";

interface ConvertToBookingDialogProps {
  lead: LeadListItem | null;
  onClose: () => void;
  onConverted: (bookingReference: string) => void;
}

const DEPOSIT_RATE = 0.2;

/**
 * "Ready to create booking" — shown only once a lead has selected a group.
 * Delegates the actual seat hold, pilgrim placeholders and document/payment
 * copying to `createGroupBooking` via the `convertLeadToBookingAction` Server
 * Action; this dialog just confirms the numbers and shows the outcome.
 */
const ConvertToBookingDialog = ({ lead, onClose, onConverted }: ConvertToBookingDialogProps) => {
  const { store } = useLeads();
  if (!lead || !lead.selectedDepartureGroupId) return null;
  return (
    <ConvertForm
      key={lead.id}
      lead={lead}
      packages={store.packages}
      onClose={onClose}
      onConverted={onConverted}
    />
  );
};

function ConvertForm({
  lead,
  packages,
  onClose,
  onConverted,
}: {
  lead: LeadListItem;
  packages: LeadPackageRow[];
  onClose: () => void;
  onConverted: (bookingReference: string) => void;
}) {
  const [converting, setConverting] = useState(false);

  const pricePerHead = pricePerPerson({ packages }, lead.packageId, lead.journeyType, lead.roomPreference);
  const total = pricePerHead * lead.partySize;
  const deposit = Math.round(pricePerHead * DEPOSIT_RATE) * lead.partySize;
  const roomType = lead.roomPreference === "UNDECIDED" ? "TRIPLE" : lead.roomPreference;

  const confirm = async () => {
    setConverting(true);
    const result = await convertLeadToBookingAction({
      leadId: lead.id,
      departureGroupId: lead.selectedDepartureGroupId!,
      primaryContactName: lead.name,
      primaryContactPhone: lead.mobileRaw,
      adults: lead.adults,
      children: lead.children,
      roomOccupancyPreference: roomType,
      packagePricePerPerson: pricePerHead,
      depositAmount: deposit,
    });
    setConverting(false);

    if (!result.ok) {
      toast.add({ title: "Could not create booking", description: result.error });
      return;
    }

    toast.add({
      title: "Booking created",
      description: `${result.bookingReference} · ${lead.partySize} seat${lead.partySize === 1 ? "" : "s"} held`,
    });
    onConverted(result.bookingReference ?? "");
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="size-4 text-primary" /> Ready to create booking
          </DialogTitle>
          <DialogDescription>
            {lead.name} · {lead.reference}
          </DialogDescription>
        </DialogHeader>

        <Card className="p-3 gap-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Traveller count</span>
            <span className="font-medium text-foreground">{lead.partySize}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Room preference</span>
            <span className="font-medium text-foreground">{ROOM_PREFERENCE_LABELS[lead.roomPreference]}</span>
          </div>
          <div className="flex items-center justify-between text-sm pt-2 border-t border-border/40">
            <span className="text-muted-foreground">Total</span>
            <span className="font-bold text-foreground font-number">{formatExactLKR(total)}</span>
          </div>
          <div className={cn("flex items-center justify-between text-sm", TONE_TEXT.success)}>
            <span>Deposit due</span>
            <span className="font-semibold font-number">{formatExactLKR(deposit)}</span>
          </div>
        </Card>

        <DialogFooter className="gap-2 border-t pt-3 border-border/40">
          <Button variant="outline" onClick={onClose} className="text-xs font-semibold" disabled={converting}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={converting} className="text-xs font-semibold">
            {converting ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
            Create Booking &amp; Hold {lead.partySize} Seat{lead.partySize === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ConvertToBookingDialog;
