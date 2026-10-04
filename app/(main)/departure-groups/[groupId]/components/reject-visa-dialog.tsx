"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { rejectVisaSchema } from "@/lib/validations/departure-groups";
import { AlertTriangle, Loader2, TriangleAlert } from "lucide-react";
import React, { useState, useTransition } from "react";

import { rejectVisaAction } from "../../actions";
import type { DepartureGroupManifestRow } from "../../types";

interface RejectVisaDialogProps {
  row: DepartureGroupManifestRow | null;
  departureGroupId: string;
  open: boolean;
  onClose: () => void;
}

/**
 * Records a refused visa.
 *
 * There was previously no way to enter this at all — `REJECTED` was a state the
 * badges rendered, the subtabs filtered on, and no code path could produce. A
 * refusal is the most expensive event in the visa process, so the one question
 * that decides what happens next is asked explicitly: can the file be corrected
 * and lodged again, or is this seat not travelling?
 */
const RejectVisaDialog = ({
  row,
  departureGroupId,
  open,
  onClose,
}: RejectVisaDialogProps) => {
  const [isPending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [canReapply, setCanReapply] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The dialog stays mounted between opens (so it can animate), so the form
  // has to reset each time it opens rather than only on first mount.
  useResetOnOpen(open, row?.id ?? "", () => {
    setReason("");
    setCanReapply(true);
    setError(null);
  });

  const submit = () => {
    setError(null);
    if (!row) return;

    const payload = {
      id: row.id,
      departureGroupId,
      reason: reason.trim(),
      canReapply,
    };

    const check = rejectVisaSchema.safeParse(payload);
    if (!check.success) {
      setError(check.error.issues[0]?.message ?? "That refusal is not valid.");
      return;
    }

    startTransition(async () => {
      const result = await rejectVisaAction(check.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.add({
        title: "Refusal recorded",
        description: canReapply
          ? `${result.fullName} moved to rework — the documents queue will pick it up.`
          : `${result.fullName}'s seat cannot travel. Cancel or move the booking.`,
      });
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md!">
        <DialogHeader>
          <DialogTitle>Record a visa refusal</DialogTitle>
          <DialogDescription>
            {row?.fullName} · {row?.bookingReference}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="refusal-reason"
              className="text-xs font-medium text-foreground"
            >
              Reason given by the consulate
            </label>
            <Textarea
              id="refusal-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Photograph did not meet the specification."
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-foreground">
              What happens next
            </span>
            <label className="flex items-start gap-2.5 rounded-md border border-border/50 p-2.5 cursor-pointer">
              <input
                type="radio"
                name="reapply"
                className="mt-1"
                checked={canReapply}
                onChange={() => setCanReapply(true)}
              />
              <span className="text-xs">
                <span className="text-foreground">Can be corrected</span>
                <span className="block text-muted-foreground">
                  Moves to rework so the documents can be fixed and lodged again.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 rounded-md border border-border/50 p-2.5 cursor-pointer">
              <input
                type="radio"
                name="reapply"
                className="mt-1"
                checked={!canReapply}
                onChange={() => setCanReapply(false)}
              />
              <span className="text-xs">
                <span className="text-foreground">Final refusal</span>
                <span className="block text-muted-foreground">
                  This seat cannot travel. The group shows a critical blocker
                  until the booking is cancelled or moved.
                </span>
              </span>
            </label>
          </div>

          {!canReapply && (
            <div className="flex items-start gap-2.5 rounded-md bg-destructive/10 p-3">
              <AlertTriangle className="size-4 shrink-0 text-destructive mt-0.5" />
              <p className="text-xs text-destructive">
                Recording a final refusal does not release the seat or raise a
                refund — cancel the booking to do that, so the money decision
                stays deliberate.
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-sm bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={submit}
            disabled={!row || reason.trim().length < 3 || isPending}
          >
            {isPending && <Loader2 className="animate-spin" />}
            Record refusal
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RejectVisaDialog;
