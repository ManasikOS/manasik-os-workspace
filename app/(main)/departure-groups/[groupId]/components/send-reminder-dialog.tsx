"use client";

import { useResetOnOpen } from "@/hooks/use-reset-on-open";
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
import {
  capabilitiesFor,
  type StaffRole,
} from "@/lib/access/departure-groups-access";
import { cn } from "@/lib/utils";
import { bookingReminderSchema } from "@/lib/validations/departure-groups";
import {
  Check,
  Copy,
  Info,
  Loader2,
  Mail,
  MessageSquare,
  Send,
  TriangleAlert,
} from "lucide-react";
import React, { useMemo, useState, useTransition } from "react";

import { sendBookingReminderAction } from "../../actions";
import type {
  DepartureGroupBooking,
  DepartureGroupListItem,
  DepartureGroupManifestRow,
  GroupActivityLog,
} from "../../types";
import {
  formatDate,
  formatExactCurrency,
  relativeTimestamp,
} from "../../utils";
import { Card } from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import SectionHeading from "@/components/section-heading";

import { displayActorName } from "@/lib/agent/identity";
export type ReminderKind = "PAYMENT" | "DOCUMENT";
type Channel = "WHATSAPP" | "SMS" | "EMAIL";

interface SendReminderDialogProps {
  /** Which reminder to compose. Null keeps the dialog closed. */
  kind: ReminderKind | null;
  booking: DepartureGroupBooking | null;
  /** Travellers on this booking (manifest rows filtered by booking id). */
  travellers: DepartureGroupManifestRow[];
  group: DepartureGroupListItem;
  /** The group's trail, read to show when this booking was last chased. */
  activity: GroupActivityLog[];
  role: StaffRole;
  currency?: string;
  open: boolean;
  onClose: () => void;
}

const CHANNELS: { value: Channel; label: string; icon: React.ReactNode }[] = [
  {
    value: "WHATSAPP",
    label: "WhatsApp",
    icon: <MessageSquare className="size-3.5" />,
  },
  { value: "SMS", label: "SMS", icon: <Send className="size-3.5" /> },
  { value: "EMAIL", label: "Email", icon: <Mail className="size-3.5" /> },
];

const ACTION_TYPE: Record<ReminderKind, string> = {
  PAYMENT: "PAYMENT_REMINDER_SENT",
  DOCUMENT: "DOCUMENT_REMINDER_SENT",
};

/**
 * Composes a payment or document reminder for a booking.
 *
 * Nothing is transmitted: no messaging gateway is wired into this codebase, so
 * the dialog is honest about it — the draft is the operator's to send, and what
 * the system keeps is the record that the family was chased, on which date,
 * through which channel. That record is what the "last chased" line above the
 * draft reads back, so the next person does not chase them twice in a day.
 */
const SendReminderDialog = ({
  kind,
  booking,
  travellers,
  group,
  activity,
  role,
  currency = "LKR",
  open,
  onClose,
}: SendReminderDialogProps) => {
  const can = capabilitiesFor(role);
  const [isPending, startTransition] = useTransition();

  const [channel, setChannel] = useState<Channel>("WHATSAPP");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const outstandingTravellers = useMemo(
    () =>
      travellers.filter(
        (row) => row.documentsCompleted < row.documentsRequired,
      ),
    [travellers],
  );

  /** The draft the operator starts from; their edits are kept from then on. */
  const draft = useMemo(() => {
    if (!booking || !kind) return "";

    const opening = `السلام عليكم ورحمة الله وبركاته ${booking.primaryContactName},\n\nA gentle reminder from Royal Fathima Travels regarding your booking ${booking.bookingReference} for ${group.groupName}, departing ${formatDate(group.departureDate)}.`;

    if (kind === "PAYMENT") {
      const amount = can.viewFinance
        ? ` An amount of ${formatExactCurrency(booking.outstandingBalance, currency)} is still outstanding${
            booking.nextDueAt ? `, due by ${formatDate(booking.nextDueAt)}` : ""
          }.`
        : " There is still a balance outstanding on your booking.";
      return `${opening}\n\n${amount} Please contact us to arrange your payment so your seats stay confirmed. \nجزاك الله خيرا`;
    }

    const lines = outstandingTravellers
      .map(
        (row) =>
          `- ${row.fullName}: ${row.documentsCompleted} of ${row.documentsRequired} documents received`,
      )
      .join("\n");
    return `${opening} \n\n The following documents are still needed:\n${lines}\n\nPlease send the remaining documents so we can proceed with the visa applications.\nجزاك الله خيرا`;
  }, [booking, kind, group, can.viewFinance, currency, outstandingTravellers]);

  const [message, setMessage] = useState(draft);
  // The dialog stays mounted between opens (so it can animate), so `touched`
  // is reset on each open below — the draft is the starting value exactly
  // once per booking/kind, and the operator's edits aren't overwritten
  // while the dialog is open.
  const [touched, setTouched] = useState(false);
  const body = touched ? message : draft;

  // Keyed on booking *and* kind: the same dialog composes both the payment and
  // the document chase, and switching kind has to redraft the message.
  useResetOnOpen(open, `${booking?.id ?? ""}:${kind ?? ""}`, () => {
    setChannel("WHATSAPP");
    setCopied(false);
    setError(null);
    setMessage(draft);
    setTouched(false);
  });

  const lastReminder = useMemo(() => {
    if (!booking || !kind) return null;
    return (
      activity.find(
        (entry) =>
          entry.actionType === ACTION_TYPE[kind] &&
          entry.entityId === booking.id,
      ) ?? null
    );
  }, [activity, booking, kind]);

  const isPayment = kind === "PAYMENT";
  // Finance figures are zeroed upstream for roles without access, so "nothing
  // to chase" can only be asserted for a role that can actually see the balance.
  const nothingToChase = isPayment
    ? can.viewFinance && (booking?.outstandingBalance ?? 0) <= 0
    : travellers.length > 0 && outstandingTravellers.length === 0;

  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not reach the clipboard — select the draft and copy it.");
    }
  };

  const submit = () => {
    setError(null);

    if (!booking || !kind) return;

    const payload = {
      bookingId: booking.id,
      departureGroupId: booking.departureGroupId,
      kind,
      channel,
      message: body.trim(),
      recipientName: booking.primaryContactName,
      recipientPhone: booking.primaryContactPhone,
    };

    const check = bookingReminderSchema.safeParse(payload);
    if (!check.success) {
      setError(check.error.issues[0]?.message ?? "That reminder is not valid.");
      return;
    }

    startTransition(async () => {
      const result = await sendBookingReminderAction(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      toast.add({
        title: isPayment
          ? "Payment reminder logged"
          : "Document reminder logged",
        description: `${result.bookingReference}: ${
          CHANNELS.find((entry) => entry.value === result.channel)?.label ??
          result.channel
        } reminder recorded for ${result.recipientName} (${
          result.recipientPhone
        }). Send the copied draft from your device — nothing was transmitted.`,
      });
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isPayment ? "Send Payment Reminder" : "Send Document Reminder"}
          </DialogTitle>
          <DialogDescription>
            {booking?.bookingReference} · {booking?.primaryContactName} ·{" "}
            {booking?.primaryContactPhone}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 max-h-[70vh] overflow-y-auto custom-scroll">
          {nothingToChase ? (
            <p className="text-sm text-muted-foreground">
              {isPayment
                ? "This booking is paid in full — there is nothing to chase."
                : "Every traveller on this booking has completed their documents."}
            </p>
          ) : (
            <>
              <div className="rounded-md bg-muted/40 px-3 py-2.5 flex flex-col gap-1 text-xs">
                {isPayment ? (
                  can.viewFinance &&
                  booking && (
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">
                        Outstanding balance
                      </span>
                      <span className="font-number font-semibold text-destructive">
                        {formatExactCurrency(
                          booking.outstandingBalance,
                          currency,
                        )}
                      </span>
                    </div>
                  )
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">
                      Travellers with documents outstanding
                    </span>
                    <span className="font-number font-semibold text-foreground">
                      {outstandingTravellers.length} of {travellers.length}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">
                    Last {isPayment ? "payment" : "document"} reminder
                  </span>
                  <span className="text-foreground">
                    {lastReminder
                      ? `${relativeTimestamp(lastReminder.createdAt)} by ${displayActorName(lastReminder.actorName)}`
                      : "Never"}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <SectionHeading title="Channel" />
                <div className="grid grid-cols-3 gap-2">
                  {CHANNELS.map((entry) => (
                    <Card
                      key={entry.value}
                      onClick={() => setChannel(entry.value)}
                      className={cn(
                        "flex flex-row gap-2 px-3 py-2 rounded-sm! items-center justify-center shadow-sm! hover:cursor-pointer",
                        channel === entry.value &&
                          "bg-primary/10! text-primary!",
                      )}
                    >
                      {entry.icon}
                      {entry.label}
                    </Card>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2"></div>
                <InputGroup>
                  <InputGroupAddon
                    align={"block-start"}
                    className="justify-between flex w-full flex-row"
                  >
                    <InputGroupText className="justify-between w-full">
                      <p>Message</p>
                      {/* Copying is the whole point of the flow — nothing is
                          transmitted, so the operator sends this themselves. */}
                      {/* <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={copyDraft}
                        className={cn(copied && "text-emerald-600")}
                      >
                        {copied ? <Check /> : <Copy />}
                        {copied ? "Copied" : "Copy draft"}
                      </Button> */}
                    </InputGroupText>
                  </InputGroupAddon>
                  <InputGroupTextarea
                    value={body}
                    onChange={(event) => {
                      setTouched(true);
                      setMessage(event.target.value);
                      setError(null);
                    }}
                    rows={7}
                    className="text-xs"
                  />
                </InputGroup>
              </div>

              <div className="flex items-start gap-2 rounded-sm bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
                <Info className="size-3.5 mt-0.5 shrink-0" />
                <span>
                  No messaging gateway is connected yet, so nothing is sent from
                  here. Copy the draft and send it from your own{" "}
                  {CHANNELS.find((entry) => entry.value === channel)?.label} —
                  logging it records the follow-up on this group&apos;s activity
                  trail.
                </span>
              </div>
            </>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={isPending || nothingToChase || body.trim().length < 10}
            onClick={submit}
          >
            {isPending && <Loader2 className="animate-spin" />}
            Log Reminder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SendReminderDialog;
