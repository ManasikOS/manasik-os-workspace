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
import { InputGroup, InputGroupTextarea } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Ban } from "lucide-react";
import React, { useState } from "react";

import type { LeadListItem, LeadLostReason } from "../types";
import { LOST_REASON_LABELS } from "../utils";

interface MarkLostDialogProps {
  /** One lead, or a bulk selection. `null` closes the dialog. */
  leads: LeadListItem[] | null;
  onClose: () => void;
  onConfirm: (
    leads: LeadListItem[],
    reason: LeadLostReason,
    note: string,
  ) => void;
}

/**
 * Marking a lead lost is the one stage change that cannot be undone by simply
 * picking another chip — it clears the follow-up and drops the lead out of the
 * working pipeline — so it asks for a reason first. Without one there is no way
 * to tell later whether the agency is losing on price or on response time.
 */
const MarkLostDialog = ({ leads, onClose, onConfirm }: MarkLostDialogProps) => {
  if (!leads || leads.length === 0) return null;
  // Keyed on the selection, so reopening for a different lead starts blank
  // through a remount rather than a reset effect.
  return (
    <MarkLostForm
      key={leads.map((lead) => lead.id).join("|")}
      leads={leads}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
};

function MarkLostForm({
  leads,
  onClose,
  onConfirm,
}: {
  leads: LeadListItem[];
  onClose: () => void;
  onConfirm: (
    leads: LeadListItem[],
    reason: LeadLostReason,
    note: string,
  ) => void;
}) {
  const [reason, setReason] = useState<LeadLostReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const single = leads.length === 1 ? leads[0] : null;

  const confirm = () => {
    if (!reason) {
      setError("Select a reason before marking the lead lost.");
      return;
    }
    onConfirm(leads, reason, note);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md border border-destructive/20">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Ban className="size-5" />
            {single ? "Mark lead as lost?" : `Mark ${leads.length} leads as lost?`}
          </DialogTitle>
          <DialogDescription>
            {single
              ? `${single.name} (${single.reference}) will drop out of the working pipeline and its follow-up will be cleared.`
              : "These leads will drop out of the working pipeline and their follow-ups will be cleared."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="mark-lost-reason"
              className="text-xs font-medium text-foreground"
            >
              Reason <span className="text-destructive">*</span>
            </label>
            <Select
              value={reason}
              onValueChange={(value) => {
                setReason(value as LeadLostReason);
                setError(null);
              }}
            >
              <SelectTrigger id="mark-lost-reason" className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="" className="text-xs">
                  — Select a reason —
                </SelectItem>
                {(
                  Object.entries(LOST_REASON_LABELS) as [LeadLostReason, string][]
                ).map(([value, label]) => (
                  <SelectItem key={value} value={value} className="text-xs">
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="mark-lost-note"
              className="text-xs font-medium text-foreground"
            >
              Note (optional)
            </label>
            <InputGroup className="h-20">
              <InputGroupTextarea
                id="mark-lost-note"
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="e.g. Quoted LKR 1.2M; competitor offered 1.05M for the same dates."
                className="text-xs p-2.5"
              />
            </InputGroup>
          </div>

          {error && (
            <p
              role="alert"
              className="text-[11px] text-destructive font-medium flex items-center gap-1"
            >
              <AlertCircle className="size-3" />
              {error}
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 border-t pt-3 border-border/40">
          <Button variant="outline" onClick={onClose} className="text-xs font-semibold">
            Keep in pipeline
          </Button>
          <Button
            variant="destructive"
            onClick={confirm}
            className="text-xs font-semibold"
          >
            Mark as lost
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default MarkLostDialog;
