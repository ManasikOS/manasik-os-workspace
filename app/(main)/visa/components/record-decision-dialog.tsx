"use client";

import { Loader2 } from "lucide-react";
import React, { useState, useTransition } from "react";

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";

import { VISA_ISSUE_TYPE_LABELS } from "@/lib/access/visa-access";
import { recordRejectionAction } from "../actions";
import type { VisaListItem } from "../types";

interface RecordDecisionDialogProps {
  item: VisaListItem | null;
  open: boolean;
  onClose: () => void;
}

/** Records a refusal — the single most expensive event in the visa process.
 *  `canReapply` is worded as its consequence, not left as a bare checkbox. */
const RecordDecisionDialog = ({ item, open, onClose }: RecordDecisionDialogProps) => {
  const [isPending, startTransition] = useTransition();
  const [issueType, setIssueType] = useState("OTHER");
  const [reason, setReason] = useState("");
  const [canReapply, setCanReapply] = useState(true);

  useResetOnOpen(open, item?.journeyId ?? "", () => {
    setIssueType("OTHER");
    setReason("");
    setCanReapply(true);
  });

  const submit = () => {
    if (!item || !reason.trim()) return;
    startTransition(async () => {
      const result = await recordRejectionAction({
        id: item.journeyId,
        departureGroupId: item.groupId,
        reason: reason.trim(),
        issueType,
        canReapply,
      });
      if (!result.ok) {
        toast.add({ title: "Could not record", description: result.error });
        return;
      }
      toast.add({ title: canReapply ? "Sent back for rework" : "Application rejected" });
      onClose();
    });
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md gap-4">
        <DialogHeader>
          <DialogTitle>Record visa decision</DialogTitle>
          <DialogDescription>
            {item.fullName} · {item.groupName}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-foreground">Issue type</label>
          <Select value={issueType} onValueChange={(value) => setIssueType(value as string)}>
            <SelectTrigger className="w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(VISA_ISSUE_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value} className="text-xs">
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason given by the consulate / authority" />

        <div className="flex flex-col gap-2 rounded-md border border-border/60 p-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" checked={canReapply} onChange={() => setCanReapply(true)} className="mt-1" />
            <span>
              <span className="font-medium text-foreground">Can be corrected and lodged again</span>
              <br />
              <span className="text-xs text-muted-foreground">Moves to Rework Required — the file returns to the queue once fixed.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" checked={!canReapply} onChange={() => setCanReapply(false)} className="mt-1" />
            <span>
              <span className="font-medium text-foreground">This seat cannot travel</span>
              <br />
              <span className="text-xs text-muted-foreground">Terminal rejection — cancel or move the booking.</span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={isPending || !reason.trim()}>
            {isPending && <Loader2 className="animate-spin" />} Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RecordDecisionDialog;
