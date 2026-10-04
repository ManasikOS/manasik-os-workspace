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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { CheckCircle2, XCircle } from "lucide-react";
import React, { useState } from "react";

import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import type { FinanceRefundRequestRow } from "@/lib/types/finance";
import { TONE_TEXT } from "@/lib/ui/tone";
import { decideRefundAction } from "../actions";
import { formatExactCurrency } from "../utils";

interface DecideRefundDialogProps {
  request: { refund: FinanceRefundRequestRow; approve: boolean } | null;
  onClose: () => void;
}

/** Approves or rejects a pending refund request — never moves money itself. */
export default function DecideRefundDialog({ request, onClose }: DecideRefundDialogProps) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(request !== null, request ? `${request.refund.id}-${request.approve}` : "", () => {
    setNote("");
    setError(null);
  });

  if (!request) return null;
  const { refund, approve } = request;

  const submit = async () => {
    if (!approve && !note.trim()) {
      setError("A reason is required to reject a refund request.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await decideRefundAction({
      refundRequestId: refund.id,
      approve,
      decisionNote: note.trim() || undefined,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not decide this refund request.");
      return;
    }
    toast.add({ title: approve ? "Refund approved" : "Refund rejected" });
    onClose();
  };

  return (
    <Dialog open={request !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md! gap-4">
        <DialogHeader className="gap-2">
          <div className="flex items-center gap-2 text-foreground font-bold text-base">
            {approve ? (
              <CheckCircle2 className={`size-5 ${TONE_TEXT.success}`} />
            ) : (
              <XCircle className="size-5 text-destructive" />
            )}
            <DialogTitle>{approve ? "Approve Refund" : "Reject Refund"}</DialogTitle>
          </div>
          <DialogDescription>
            {refund.reference} · {formatExactCurrency(refund.amount, refund.currency)} for{" "}
            {refund.primary_contact_name} ({refund.booking_reference})
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {approve ? "Note (optional)" : "Reason *"}
          </label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={approve ? "Optional context" : "Why is this refund being rejected?"}
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={approve ? "default" : "destructive"} onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : approve ? "Approve Refund" : "Reject Refund"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
