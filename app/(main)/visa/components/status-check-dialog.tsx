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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useResetOnOpen } from "@/hooks/use-reset-on-open";

import { recordStatusCheckAction } from "../actions";

interface StatusCheckDialogProps {
  journeyIds: string[];
  itemsLabel: string;
  open: boolean;
  onClose: () => void;
}

/** Records that staff checked an application's status — never a government
 *  portal call. Manual reference + evidence + "checked on" timestamp is the
 *  supported pattern until an official integration exists. */
const StatusCheckDialog = ({ journeyIds, itemsLabel, open, onClose }: StatusCheckDialogProps) => {
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState("");

  useResetOnOpen(open, journeyIds.join(","), () => setNote(""));

  const submit = () => {
    startTransition(async () => {
      const result = await recordStatusCheckAction({ journeyIds, note: note.trim() || null });
      if (!result.ok) {
        toast.add({ title: "Could not record", description: result.error });
        return;
      }
      toast.add({ title: `Status check recorded for ${journeyIds.length} application(s)` });
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm gap-4">
        <DialogHeader>
          <DialogTitle>Record status check</DialogTitle>
          <DialogDescription>{itemsLabel}</DialogDescription>
        </DialogHeader>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="What did you find? (optional)" />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default StatusCheckDialog;
