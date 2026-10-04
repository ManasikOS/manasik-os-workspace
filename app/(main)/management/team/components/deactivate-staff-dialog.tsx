"use client";

import { Loader2, ShieldOff } from "lucide-react";
import React, { useState } from "react";

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
import { useResetOnOpen } from "@/hooks/use-reset-on-open";

import { deactivateStaffAction } from "../actions";

export interface DeactivateStaffMemberRef {
  id: string;
  fullName: string;
}

interface DeactivateStaffDialogProps {
  member: DeactivateStaffMemberRef | null;
  onClose: () => void;
}

/**
 * Never deletes — sets `status = DEACTIVATED`, revokes sessions where
 * possible, and leaves the person's Departure Group assignments intact so a
 * group never silently loses its owner (see the Team build plan, D15).
 */
export default function DeactivateStaffDialog({ member, onClose }: DeactivateStaffDialogProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(member !== null, member?.id ?? "", () => {
    setReason("");
    setError(null);
  });

  if (!member) return null;

  const submit = async () => {
    setSubmitting(true);
    const result = await deactivateStaffAction({ staffId: member.id, reason: reason || undefined });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not deactivate this account.");
      return;
    }
    toast.add({ title: "Access deactivated", description: `${member.fullName} can no longer sign in.` });
    onClose();
  };

  return (
    <Dialog open={member !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm gap-4">
        <DialogHeader className="gap-2">
          <div className="flex items-center gap-2 text-foreground font-bold text-base">
            <ShieldOff className="size-5 text-destructive" />
            <DialogTitle>Deactivate Access</DialogTitle>
          </div>
          <DialogDescription>
            {member.fullName} will lose access immediately. Their Departure Group assignments and
            history stay on record — this can be reversed from Deactivated Accounts at any time.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">Reason (optional)</label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Left the agency." />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="animate-spin" />} Deactivate Access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
