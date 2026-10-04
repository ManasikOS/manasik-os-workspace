"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { capabilitiesForFinance } from "@/lib/access/finance-access";
import type { StaffRole } from "@/lib/access/departure-groups-access";
import { cn } from "@/lib/utils";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { FileText, Loader2, MessageSquare } from "lucide-react";
import { useProgressRouter as useRouter } from "@/hooks/use-progress-router";
import React, { useEffect, useMemo, useState, useTransition } from "react";

import {
  createInvoiceAction,
  issueInvoiceAction,
  sendInvoiceAction,
} from "../../../finance/payments/actions";
import { getInvoiceLetterheadAction, type InvoiceLetterhead } from "../../actions";
import {
  buildInvoiceLineItems,
  invoiceLineItemsTotal,
  toInvoiceLineItemInputs,
} from "../../booking-invoice";
import { buildInvoicePdf } from "../../invoice-pdf";
import type {
  DepartureGroupAccommodation,
  DepartureGroupBooking,
  DepartureGroupFlight,
  DepartureGroupListItem,
  DepartureGroupManifestRow,
  DepartureGroupPackageSnapshot,
  DepartureGroupTransport,
  ServiceAddon,
} from "../../types";
import { timestampedFilename } from "../../csv";
import { formatExactCurrency } from "../../utils";
import { TONE_TEXT } from "@/lib/ui/tone";

interface InvoicePreviewDialogProps {
  booking: DepartureGroupBooking | null;
  travellers: DepartureGroupManifestRow[];
  group: DepartureGroupListItem;
  role: StaffRole;
  currency: string;
  open: boolean;
  onClose: () => void;
  accommodations: DepartureGroupAccommodation[];
  flights: DepartureGroupFlight[];
  transports: DepartureGroupTransport[];
  serviceAddons: ServiceAddon[];
  itinerary: DepartureGroupPackageSnapshot["itinerary"];
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Digits only, and only if there are enough of them to plausibly be a phone number. */
function whatsappDigits(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 8 ? digits : null;
}

/**
 * Turns a booking's live, approved charges into a real invoice: creates and
 * issues it through the existing Finance invoice tables
 * (`createInvoiceAction` / `issueInvoiceAction` — this dialog is the first
 * caller either has had), then builds and downloads a PDF from the same
 * line items so the screen and the document a customer receives can never
 * disagree.
 */
const InvoicePreviewDialog = ({
  booking,
  travellers,
  group,
  role,
  currency,
  open,
  onClose,
  accommodations,
  flights,
  transports,
  serviceAddons,
  itinerary,
}: InvoicePreviewDialogProps) => {
  const router = useRouter();
  const can = capabilitiesForFinance(role);
  const [isPending, startTransition] = useTransition();
  const [letterhead, setLetterhead] = useState<InvoiceLetterhead | null>(null);
  const [generated, setGenerated] = useState<{ id: string; number: string } | null>(null);

  useResetOnOpen(open, booking?.id ?? "", () => {
    setGenerated(null);
  });

  // The agency letterhead doesn't vary per booking, so it's fetched once
  // and kept — no need to null it out and re-fetch on every open.
  useEffect(() => {
    if (!open || letterhead) return;
    let cancelled = false;
    getInvoiceLetterheadAction().then((result) => {
      if (!cancelled) setLetterhead(result);
    });
    return () => {
      cancelled = true;
    };
  }, [open, letterhead]);

  const context = useMemo(
    () => ({ accommodations, flights, transports, addons: serviceAddons, itinerary }),
    [accommodations, flights, transports, serviceAddons, itinerary],
  );

  const lineItems = useMemo(
    () => buildInvoiceLineItems(travellers, context),
    [travellers, context],
  );
  const subtotal = invoiceLineItemsTotal(lineItems);

  const generate = () => {
    if (!booking || !letterhead) return;
    startTransition(async () => {
      const createResult = await createInvoiceAction({
        bookingId: booking.id,
        invoiceType: "BOOKING",
        amount: subtotal,
        currency,
        dueAt: booking.nextDueAt ?? undefined,
        lineItems: toInvoiceLineItemInputs(lineItems),
      });
      if (!createResult.ok || !createResult.invoiceId || !createResult.invoiceNumber) {
        toast.add({ title: "Could not create invoice", description: createResult.error });
        return;
      }

      const issueResult = await issueInvoiceAction(createResult.invoiceId);
      if (!issueResult.ok) {
        toast.add({
          title: "Invoice created but not issued",
          description: issueResult.error,
        });
        // Do not present a draft as a completed invoice or generate a
        // customer-facing PDF until the server has confirmed issuance.
        // The draft remains available under Finance → Invoices for review.
        return;
      }

      try {
        const pdfBlob = await buildInvoicePdf({
          letterhead,
          invoiceNumber: createResult.invoiceNumber,
          issuedAt: new Date().toISOString(),
          dueAt: booking.nextDueAt,
          currency,
          bookingReference: booking.bookingReference,
          primaryContactName: booking.primaryContactName,
          primaryContactPhone: booking.primaryContactPhone,
          groupLabel: `${group.groupName} (${group.groupCode})`,
          departureDate: group.departureDate,
          travellerCount: booking.travellerCount,
          lineItems,
          amountPaid: booking.amountPaid,
        });
        downloadBlob(pdfBlob, timestampedFilename(createResult.invoiceNumber, "pdf"));
      } catch {
        toast.add({
          title: "Invoice saved, but the PDF failed to build",
          description: "You can still find it under Finance → Invoices.",
        });
      }

      toast.add({
        title: "Invoice generated",
        description: `${createResult.invoiceNumber} · ${formatExactCurrency(subtotal, currency)}`,
      });
      setGenerated({ id: createResult.invoiceId, number: createResult.invoiceNumber });
      router.refresh();
    });
  };

  const sendWhatsapp = () => {
    if (!booking || !generated) return;
    const digits = whatsappDigits(booking.primaryContactPhone);
    startTransition(async () => {
      const result = await sendInvoiceAction({ invoiceId: generated.id, channel: "WHATSAPP" });
      if (!result.ok) {
        toast.add({ title: "Could not record as sent", description: result.error });
        return;
      }
      if (digits) {
        const text = encodeURIComponent(
          `Invoice ${generated.number} for ${group.groupName} — ${formatExactCurrency(subtotal, currency)}. The PDF is attached separately.`,
        );
        window.open(`https://wa.me/${digits}?text=${text}`, "_blank", "noopener,noreferrer");
      }
      toast.add({ title: "Marked as sent via WhatsApp" });
    });
  };

  if (!booking) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl! max-h-[85vh] overflow-y-auto custom-scroll">
        <DialogHeader>
          <DialogTitle>Generate Invoice</DialogTitle>
          <DialogDescription>
            {booking.bookingReference} · {booking.primaryContactName}
          </DialogDescription>
        </DialogHeader>

        {lineItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing to invoice yet — every charge on this booking is either voided or still
            awaiting approval.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <Card className="p-3 min-h-fit flex flex-col divide-y divide-border/20">
              {lineItems.map((item, i) => (
                <div key={i} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{item.travellerName}</p>
                    <p className="text-sm text-foreground truncate">{item.title}</p>
                    {item.details.map((line, j) => (
                      <p key={j} className="text-[11px] text-muted-foreground">
                        {line}
                      </p>
                    ))}
                  </div>
                  <span
                    className={cn(
                      "text-sm font-number shrink-0",
                      item.unitAmount < 0
                        ? TONE_TEXT.success
                        : "text-foreground",
                    )}
                  >
                    {formatExactCurrency(item.quantity * item.unitAmount, currency)}
                  </span>
                </div>
              ))}
            </Card>

            <div className="flex items-center justify-between px-1">
              <span className="text-sm font-medium text-foreground">Subtotal</span>
              <span className="text-base font-semibold text-foreground font-number">
                {formatExactCurrency(subtotal, currency)}
              </span>
            </div>

            {generated && (
              <Card className="p-3 min-h-fit bg-primary/5 text-xs text-foreground">
                {generated.number} created and issued.
              </Card>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {generated ? "Close" : "Cancel"}
          </Button>
          {generated ? (
            <Button
              variant="outline_without_border"
              disabled={isPending}
              onClick={sendWhatsapp}
            >
              {isPending ? <Loader2 className="animate-spin" /> : <MessageSquare />}
              Send via WhatsApp
            </Button>
          ) : (
            can.createInvoices && (
              <Button
                disabled={isPending || !letterhead || lineItems.length === 0}
                onClick={generate}
              >
                {isPending ? <Loader2 className="animate-spin" /> : <FileText />}
                Generate &amp; Download
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default InvoicePreviewDialog;
