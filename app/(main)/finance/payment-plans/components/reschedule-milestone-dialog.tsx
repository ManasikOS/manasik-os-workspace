"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";

import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import type { FinanceMilestoneRow } from "@/lib/types/finance";
import { formatExactCurrency } from "@/app/(main)/finance/payments/utils";
import { changeMilestoneDueDateAction } from "@/app/(main)/finance/payments/actions";

interface RescheduleMilestoneDialogProps {
  milestone: FinanceMilestoneRow | null;
  onClose: () => void;
}

/**
 * Changes one instalment's due date. Never waives an amount or moves money —
 * `changeMilestoneDueDate()` in `lib/data/finance-repository.ts` only ever
 * updates `due_at`, keeping the previous value and a required reason on the
 * row for audit (`due_at_previous` / `due_at_change_reason`).
 */
export default function RescheduleMilestoneDialog({
  milestone,
  onClose,
}: RescheduleMilestoneDialogProps) {
  const [dueAt, setDueAt] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(milestone !== null, milestone?.id ?? "", () => {
    setDueAt(milestone?.due_at ? milestone.due_at.slice(0, 10) : "");
    setReason("");
    setError(null);
  });

  if (!milestone) return null;

  const submit = async () => {
    if (!dueAt) {
      setError("Choose the new due date.");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required to change a due date.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await changeMilestoneDueDateAction({
      milestoneId: milestone.id,
      dueAt: new Date(dueAt).toISOString(),
      reason: reason.trim(),
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not change this due date.");
      return;
    }
    toast.add({ title: "Due date changed", description: milestone.label });
    onClose();
  };

  return (
    <Dialog open={milestone !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md! gap-4">
        <DialogHeader>
          <DialogTitle>Change Due Date</DialogTitle>
          <DialogDescription>
            {milestone.label} · {formatExactCurrency(milestone.amount, milestone.currency)} ·{" "}
            {milestone.booking_reference} ({milestone.primary_contact_name})
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <InputGroup>
            <InputGroupAddon align="block-start"><InputGroupText>New due date *</InputGroupText></InputGroupAddon>
            <InputGroupInput type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </InputGroup>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Reason *</label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this instalment moving?"
              rows={3}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Change Due Date"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
