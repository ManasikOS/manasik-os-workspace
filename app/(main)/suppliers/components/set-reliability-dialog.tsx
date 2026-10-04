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
import { ToneBadge } from "@/components/ui/tone-badge";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";
import { ShieldCheck } from "lucide-react";
import React, { useState } from "react";

import { RELIABILITY_LABELS } from "@/lib/data/suppliers-copy";
import { reliabilityTone } from "@/lib/data/suppliers";
import { setReliabilityAction } from "../actions";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";

const RELIABILITY_OPTIONS = Object.keys(RELIABILITY_LABELS);

export interface SetReliabilitySupplierRef {
  id: string;
  name: string;
  reliability: string;
}

interface SetReliabilityDialogProps {
  supplier: SetReliabilitySupplierRef | null;
  /** Defaults to `supplier !== null` — pass explicitly when the supplier ref is always present (the profile page). */
  open?: boolean;
  onClose: () => void;
}

/**
 * Staff-controlled reliability state — never computed. Same posture the spec
 * insists on: "do not build a complex AI score initially."
 */
export default function SetReliabilityDialog({
  supplier,
  open,
  onClose,
}: SetReliabilityDialogProps) {
  const isOpen = open ?? supplier !== null;
  const [reliability, setReliability] = useState("RELIABLE");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useResetOnOpen(isOpen, supplier?.id ?? "", () => {
    setReliability(supplier?.reliability ?? "RELIABLE");
    setReason("");
    setError(null);
  });

  if (!supplier) return null;

  const submit = async () => {
    setSubmitting(true);
    const result = await setReliabilityAction({
      supplierId: supplier.id,
      reliability,
      reason,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Could not update reliability.");
      return;
    }
    toast.add({
      title: "Reliability updated",
      description: `${supplier.name} marked ${RELIABILITY_LABELS[reliability]}.`,
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md! gap-4">
        <DialogHeader className="gap-2">
          <div className="flex items-center gap-2 text-foreground font-bold text-base">
            {/* <ShieldCheck className="size-5 text-primary" /> */}
            <DialogTitle>Set Reliability</DialogTitle>
          </div>
          <DialogDescription>
            {supplier.name} — based on staff judgement, not automatically
            calculated.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {RELIABILITY_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setReliability(option)}
              >
                <ToneBadge
                  tone={
                    reliability === option ? reliabilityTone(option) : "neutral"
                  }
                  label={RELIABILITY_LABELS[option]}
                  className={reliability === option ? "" : "opacity-60"}
                />
              </button>
            ))}
          </div>
          <InputGroup>
            <InputGroupAddon align={"block-start"}>
              <InputGroupText> Reason (optional)</InputGroupText>
            </InputGroupAddon>
            <InputGroupTextarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Two late confirmations this month."
            />
          </InputGroup>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
