"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SuccessPulse } from "@/components/ui/success-pulse";
import { CollectionRecord } from "@/lib/types/dashboard";
import { Send, MessageSquare, Mail } from "lucide-react";

interface PaymentReminderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: CollectionRecord | null;
}

export default function PaymentReminderDialog({
  open,
  onOpenChange,
  record,
}: PaymentReminderDialogProps) {
  const [channel, setChannel] = useState<"whatsapp" | "sms" | "email">(
    "whatsapp",
  );
  const [isSent, setIsSent] = useState(false);

  if (!record) return null;

  const defaultMessage = `Assalamu Alaikum ${record.pilgrimName}, this is a gentle reminder from Royal Fathima Travels (Safar CRM) regarding your pending payment of ${record.amount} for ${record.groupName} (${record.statusLabel}). Please contact us to complete your payment. Jazakallah Khair.`;

  const handleSend = () => {
    setIsSent(true);
    setTimeout(() => {
      setIsSent(false);
      onOpenChange(false);
    }, 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            Send Payment Reminder
          </DialogTitle>
          <DialogDescription className="text-xs">
            Review and confirm the reminder notification draft before sending to{" "}
            <span className="font-semibold text-foreground">
              {record.pilgrimName}
            </span>
            .
          </DialogDescription>
        </DialogHeader>

        {isSent ? (
          <div className="py-6 flex flex-col items-center justify-center gap-3 text-center">
            <SuccessPulse />
            <h4 className="font-semibold text-sm text-foreground">
              Reminder Sent Successfully
            </h4>
            <p className="text-xs text-muted-foreground">
              Sent via {channel.toUpperCase()} to {record.phone}.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 py-2">
            <div className="p-3 rounded-lg bg-muted/40 border border-border text-xs flex flex-col gap-1">
              <div className="flex justify-between text-muted-foreground">
                <span>
                  Pilgrim:{" "}
                  <strong className="text-foreground">
                    {record.pilgrimName}
                  </strong>
                </span>
                <span>
                  Phone:{" "}
                  <strong className="text-foreground font-number">
                    {record.phone}
                  </strong>
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground mt-1">
                <span>
                  Amount:{" "}
                  <strong className="text-foreground font-number">
                    {record.amount}
                  </strong>
                </span>
                <span className="text-destructive font-semibold">
                  {record.statusLabel}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-foreground">
                Reminder Channel
              </label>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  type="button"
                  variant={channel === "whatsapp" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setChannel("whatsapp")}
                  className="h-8 text-xs gap-1.5"
                >
                  {/* eslint-disable-next-line no-restricted-syntax -- WhatsApp's own brand mark, not a status color */}
                  <MessageSquare className="size-3.5 text-emerald-400" />
                  WhatsApp
                </Button>
                <Button
                  type="button"
                  variant={channel === "sms" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setChannel("sms")}
                  className="h-8 text-xs gap-1.5"
                >
                  <Send className="size-3.5" />
                  SMS
                </Button>
                <Button
                  type="button"
                  variant={channel === "email" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setChannel("email")}
                  className="h-8 text-xs gap-1.5"
                >
                  <Mail className="size-3.5" />
                  Email
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-foreground">
                Message Draft
              </label>
              <textarea
                readOnly
                rows={4}
                value={defaultMessage}
                className="w-full text-xs p-2.5 rounded-lg border border-border bg-muted/30 focus:outline-none text-foreground font-sans resize-none"
              />
            </div>
          </div>
        )}

        {!isSent && (
          <div>
            <Button
              type="button"
              variant="bg_primary_gradient"
              size="sm"
              onClick={handleSend}
              className="text-xs font-semibold gap-1.5"
            >
              <Send className="size-3.5" />
              Confirm & Send Reminder
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
